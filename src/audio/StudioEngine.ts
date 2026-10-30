import { createId } from '../core/id'
import type { MixerSettings, Pitch, Recording, StudioStatus, Track } from '../core/types'
import { DEFAULT_MIXER_SETTINGS, encodeWav, renderMix } from './mix'
import { PitchScoringClient, MODEL_ID } from '../scoring/client'
import type { RealtimeAnalysis, ReferenceMelody, RealtimeScore } from '../scoring/types'
import { createRealtimeToneChain, VOCAL_TONE_PRESETS, type RealtimeToneChain } from './effects'

export interface StudioSnapshot {
  track: Track | null
  status: StudioStatus
  position: number
  duration: number
  level: number
  pitch: Pitch | null
  settings: MixerSettings
  error: string | null
  notice: string | null
  pendingRecording: Recording | null
  previewStatus: 'off' | 'starting' | 'on'
  realtime: RealtimeAnalysis
}

interface MicrophoneInput {
  stream: MediaStream
  analyser: AnalyserNode
  tone: RealtimeToneChain
  vocalGain: GainNode
  monitorGate: GainNode
  reverbGain: GainNode
  nodes: AudioNode[]
}

interface RecordingSession {
  track: Track
  backing: AudioBuffer
  input: MicrophoneInput
  source: AudioBufferSourceNode
  worklet: AudioWorkletNode
  musicGain: GainNode
  nodes: AudioNode[]
  pcm: Float32Array
  startFrame: number
  endFrame: number
  done: Promise<number>
  resolveDone: (frames: number) => void
  finishing: Promise<void> | null
  cancelled: boolean
  receivedFrames: number
  released: boolean
  interruptionReason: string | null
  scorer: PitchScoringClient
  latencyMs: number
  reference: ReferenceMelody | undefined
}

/** 仅在浏览器 I/O 边界转换错误；内部音频图与 PCM 格式使用固定契约。 */
function describeInputError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '麦克风权限未获准，请在系统或浏览器设置中允许访问后重试。'
    }
    if (error.name === 'NotFoundError') return '没有找到麦克风，请连接录音设备后重试。'
    if (error.name === 'NotReadableError') return '麦克风暂时无法使用，请关闭占用设备的应用后重试。'
  }
  return error instanceof Error ? error.message : '录音设备启动失败，请检查麦克风和音频输出。'
}

function loadSettings(): { settings: MixerSettings; error: string | null } {
  try {
    const text = localStorage.getItem('qingchang-mixer')
    if (text === null) return { settings: { ...DEFAULT_MIXER_SETTINGS }, error: null }
    const data: unknown = JSON.parse(text)
    if (typeof data !== 'object' || data === null) throw new Error('混音设置必须为对象')
    const fields = data as Record<string, unknown>
    for (const [field, minimum, maximum] of [
      ['musicVolume', 0, 1], ['vocalVolume', 0, 1], ['reverb', 0, 1], ['latencyMs', -500, 500],
    ] as const) {
      const value = fields[field]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`混音设置 ${field} 超出范围`)
      }
    }
    if (typeof fields.monitoring !== 'boolean' || typeof fields.lyricOffsetMs !== 'number' || !Number.isFinite(fields.lyricOffsetMs)) {
      throw new Error('混音设置监听开关或歌词偏移格式错误')
    }
    // 首期缓存没有 vocalTone；只在这一个存储边界迁移，并保留已有参数。
    const migrating = !('vocalTone' in fields)
    if (migrating) fields.vocalTone = 'natural'
    if (!VOCAL_TONE_PRESETS.some((preset) => preset.id === fields.vocalTone)) throw new Error('混音音色设置无效')
    const settings = data as MixerSettings
    if (migrating) {
      try {
        localStorage.setItem('qingchang-mixer', JSON.stringify(settings))
      } catch (error) {
        console.error('混音设置迁移保存失败', error)
        return { settings, error: '已有混音设置已载入，但无法保存音色升级设置。' }
      }
    }
    return { settings, error: null }
  } catch (error) {
    console.error('混音设置读取失败', error)
    return { settings: { ...DEFAULT_MIXER_SETTINGS }, error: '无法读取保存的混音设置，已采用默认设置。' }
  }
}

export class StudioEngine {
  private snapshot: StudioSnapshot = {
    track: null,
    status: 'empty',
    position: 0,
    duration: 0,
    level: 0,
    pitch: null,
    settings: { ...DEFAULT_MIXER_SETTINGS },
    error: null,
    notice: null,
    pendingRecording: null,
    previewStatus: 'off',
    realtime: { modelStatus: 'idle', modelId: MODEL_ID, pitch: null, metrics: null, error: null },
  }
  private listeners = new Set<() => void>()
  private context: AudioContext | null = null
  private workletLoaded: Promise<void> | null = null
  private backing: AudioBuffer | null = null
  private playbackSource: AudioBufferSourceNode | null = null
  private playbackGain: GainNode | null = null
  private recording: RecordingSession | null = null
  private preview: MicrophoneInput | null = null
  private startingStream: { stream: MediaStream; purpose: 'preview' | 'recording' } | null = null
  private previewVersion = 0
  private playbackStartedAt = 0
  private playbackOffset = 0
  private transportVersion = 0
  private loadVersion = 0
  private animationFrame = 0
  private lastMeterAt = 0
  private scorer: PitchScoringClient | null = null
  private previewWorklet: AudioWorkletNode | null = null

  constructor(private onRecordingComplete: (recording: Recording) => Promise<void>) {
    this.snapshot = { ...this.snapshot, ...loadSettings() }
  }

  getSnapshot = (): StudioSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private update(patch: Partial<StudioSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private getContext(): AudioContext {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: 'interactive' })
      context.onstatechange = () => {
        if (context.state !== 'running' && (this.playbackSource || this.preview || this.recording)) {
          void this.interrupt('系统暂停了音频')
        }
      }
      this.context = context
    }
    return this.context
  }

  selectTrack = async (track: Track): Promise<void> => {
    if (this.snapshot.status === 'recording' || this.snapshot.status === 'finishing') return
    const version = ++this.loadVersion
    ++this.transportVersion
    this.stopPlayback()
    this.update({ status: this.snapshot.track ? 'ready' : 'empty', position: 0, error: null, notice: null })
    try {
      const bytes = await track.audio.arrayBuffer()
      if (version !== this.loadVersion) return
      const buffer = await this.getContext().decodeAudioData(bytes)
      if (version !== this.loadVersion) return
      this.backing = buffer
      this.update({ track: { ...track, duration: buffer.duration }, status: 'ready', duration: buffer.duration, realtime: { ...this.snapshot.realtime, metrics: null, pitch: null } })
    } catch (error) {
      if (version !== this.loadVersion) return
      console.error('伴奏解码失败', error)
      const message = '无法播放这份音频，请导入浏览器支持的 MP3、WAV、M4A 或 OGG 文件。'
      this.update({ error: message })
      throw new Error(message, { cause: error })
    }
  }

  setReferenceMelody = (trackId: string, reference: ReferenceMelody | undefined): void => {
    const { track, status, previewStatus } = this.snapshot
    if (track?.id !== trackId || status === 'recording' || status === 'finishing' || previewStatus === 'starting') return
    this.stopPreview()
    this.update({ track: { ...track, referenceMelody: reference },
      realtime: { ...this.snapshot.realtime, metrics: null } })
  }

  private async prepareScoring(sampleRate: number, latencyMs: number, reference: ReferenceMelody | undefined): Promise<PitchScoringClient> {
    this.update({ realtime: { modelStatus: 'loading', modelId: MODEL_ID, pitch: null, metrics: null, error: null } })
    const client = new PitchScoringClient(sampleRate, latencyMs, reference, false, ({ frames, metrics }) => {
      if (this.scorer !== client) return
      const frame = frames.at(-1)
      if (!frame) return
      let pitch: Pitch | null = null
      if (frame.frequencyHz !== null) {
        const midi = Math.round(69 + 12 * Math.log2(frame.frequencyHz / 440))
        const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
        pitch = { frequency: frame.frequencyHz, note: `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`,
          cents: 1200 * Math.log2(frame.frequencyHz / (440 * 2 ** ((midi - 69) / 12))) }
      }
      this.update({ pitch, realtime: { modelStatus: 'ready', modelId: MODEL_ID, pitch: frame, metrics, error: null } })
    }, message => {
      if (this.scorer === client) this.update({ pitch: null, realtime: { ...this.snapshot.realtime, modelStatus: 'error', pitch: null, error: `CREPE 实时分析失败：${message}` } })
    })
    this.scorer = client
    void client.ready.then(() => {
      if (this.scorer === client) this.update({ realtime: { ...this.snapshot.realtime, modelStatus: 'ready' } })
    }).catch((error: unknown) => { console.error('CREPE 初始化失败', error) })
    return client
  }

  private async loadPcmWorklet(context: AudioContext): Promise<void> {
    if (!context.audioWorklet) throw new Error('当前浏览器不支持 AudioWorklet，请升级浏览器。')
    this.workletLoaded ??= context.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-worklets/pcm-recorder.js`)
    await this.workletLoaded
  }

  togglePlayback = async (): Promise<void> => {
    if (this.snapshot.status === 'playing') {
      ++this.transportVersion
      const position = this.currentPosition()
      this.stopPlayback()
      this.update({ status: 'ready', position })
      return
    }
    if (this.snapshot.status !== 'ready') return
    const version = ++this.transportVersion
    try {
      await this.getContext().resume()
      if (version !== this.transportVersion) return
      const offset = this.snapshot.position >= this.snapshot.duration ? 0 : this.snapshot.position
      this.startPlayback(offset)
    } catch (error) {
      console.error('音频播放失败', error)
      this.update({ error: '音频输出启动失败，请检查声音设备后重试。' })
    }
  }

  private startPlayback(offset: number): void {
    const context = this.getContext()
    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = this.backing!
    gain.gain.value = this.snapshot.settings.musicVolume
    source.connect(gain).connect(context.destination)
    this.playbackSource = source
    this.playbackGain = gain
    this.playbackStartedAt = context.currentTime
    this.playbackOffset = offset
    source.onended = () => {
      if (this.playbackSource !== source) return
      this.stopPlayback()
      this.update({ status: 'ready', position: this.snapshot.duration })
    }
    source.start(context.currentTime, offset)
    this.update({ status: 'playing', position: offset, error: null, notice: null })
    this.startAnimation()
  }

  seek = (seconds: number): void => {
    if (this.snapshot.status !== 'playing' && this.snapshot.status !== 'ready') return
    ++this.transportVersion
    const position = Math.max(0, Math.min(seconds, this.snapshot.duration))
    const playing = this.snapshot.status === 'playing'
    this.stopPlayback()
    this.update({ position, status: 'ready' })
    if (playing && position < this.snapshot.duration) this.startPlayback(position)
  }

  startPreview = async (): Promise<void> => {
    if (this.snapshot.previewStatus !== 'off' || this.snapshot.status === 'recording' || this.snapshot.status === 'finishing') return
    const version = ++this.previewVersion
    this.update({ previewStatus: 'starting', error: null, notice: null })
    let stream: MediaStream | null = null
    try {
      const context = this.getContext()
      await context.resume()
      if (version !== this.previewVersion) return
      stream = await this.openMicrophone()
      if (version !== this.previewVersion) {
        this.stopStartingStream(stream)
        return
      }
      this.startingStream = { stream, purpose: 'preview' }
      // 首次授权/输入路由切换可能暂停 iOS 音频；当前仍属于用户主动启动链路。
      await context.resume()
      if (version !== this.previewVersion) {
        this.stopStartingStream(stream)
        return
      }
      await this.loadPcmWorklet(context)
      const scorer = await this.prepareScoring(context.sampleRate, 0, undefined)
      if (version !== this.previewVersion) { scorer.dispose(); this.stopStartingStream(stream); return }
      this.preview = this.createMicrophoneInput(context, stream)
      const worklet = new AudioWorkletNode(context, 'pcm-recorder', { processorOptions: { startFrame: Math.ceil(context.currentTime * context.sampleRate), endFrame: Number.MAX_SAFE_INTEGER } })
      worklet.port.onmessage = ({ data }: MessageEvent<{ type: 'chunk'; samples: Float32Array }>) => { scorer.push(data.samples) }
      worklet.onprocessorerror = () => { void this.interrupt('麦克风处理器运行失败') }
      this.preview.analyser.connect(worklet).connect(context.destination)
      this.previewWorklet = worklet
      this.startingStream = null
      this.update({ previewStatus: 'on' })
      this.startAnimation()
    } catch (error) {
      if (stream) this.stopStartingStream(stream)
      if (version !== this.previewVersion) return
      console.error('麦克风测试启动失败', error)
      this.update({ previewStatus: 'off', error: describeInputError(error), level: 0, pitch: null })
    }
  }

  stopPreview = (): void => {
    ++this.previewVersion
    if (this.snapshot.previewStatus !== 'off') { this.scorer?.dispose(); this.scorer = null }
    if (this.previewWorklet) {
      this.previewWorklet.port.onmessage = null
      this.previewWorklet.port.close()
      this.previewWorklet.disconnect()
      this.previewWorklet = null
    }
    if (this.startingStream?.purpose === 'preview') this.stopStartingStream(this.startingStream.stream)
    if (this.preview) {
      this.releaseInput(this.preview)
      this.preview = null
    }
    this.update({ previewStatus: 'off', level: 0, pitch: null })
    if (this.snapshot.status !== 'playing' && this.snapshot.status !== 'recording') this.stopAnimation()
  }

  private openMicrophone(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境无法访问麦克风，请通过 HTTPS、本机 localhost 或桌面应用打开。')
    }
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
  }

  private stopStartingStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) track.stop()
    if (this.startingStream?.stream === stream) this.startingStream = null
  }

  private createMicrophoneInput(context: AudioContext, stream: MediaStream): MicrophoneInput {
    const settings = this.snapshot.settings
    const microphone = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    const silent = context.createGain()
    silent.gain.value = 0
    microphone.connect(analyser).connect(silent).connect(context.destination)

    const toneInput = context.createGain()
    const vocalGain = context.createGain()
    vocalGain.gain.value = settings.vocalVolume
    microphone.connect(toneInput)
    const tone = createRealtimeToneChain(context, toneInput, vocalGain, settings.vocalTone)
    const monitorGate = context.createGain()
    monitorGate.gain.value = settings.monitoring ? 1 : 0
    const delay = context.createDelay(0.1)
    delay.delayTime.value = 0.043
    const feedback = context.createGain()
    feedback.gain.value = 0.56
    const reverbGain = context.createGain()
    reverbGain.gain.value = settings.reverb * 0.55
    vocalGain.connect(monitorGate).connect(context.destination)
    vocalGain.connect(delay).connect(reverbGain).connect(monitorGate)
    delay.connect(feedback).connect(delay)
    for (const track of stream.getAudioTracks()) {
      track.onended = () => { void this.interrupt('麦克风连接已结束') }
      track.onmute = () => { void this.interrupt('麦克风输入已中断') }
    }
    return {
      stream, analyser, tone, vocalGain, monitorGate, reverbGain,
      nodes: [microphone, analyser, silent, toneInput, vocalGain, monitorGate, delay, feedback, reverbGain],
    }
  }

  private releaseInput(input: MicrophoneInput): void {
    for (const track of input.stream.getAudioTracks()) {
      track.onended = null
      track.onmute = null
    }
    input.tone.dispose()
    for (const node of input.nodes) node.disconnect()
    for (const track of input.stream.getTracks()) track.stop()
  }

  startRecording = async (): Promise<void> => {
    if (this.snapshot.status !== 'ready' && this.snapshot.status !== 'playing') return
    if (this.snapshot.pendingRecording) {
      this.update({ error: '上次录音尚未保存，请先重试保存或导出音频，避免丢失作品。' })
      return
    }
    this.stopPreview()
    const version = ++this.transportVersion
    ++this.loadVersion
    this.stopPlayback()
    this.update({ status: 'finishing', position: 0, error: null, notice: null })
    let stream: MediaStream | null = null
    try {
      const context = this.getContext()
      // resume 在用户手势中先发起，移动浏览器随后仍可正常开始播放。
      await context.resume()
      if (version !== this.transportVersion) return
      stream = await this.openMicrophone()
      if (version !== this.transportVersion) {
        this.stopStartingStream(stream)
        return
      }
      this.startingStream = { stream, purpose: 'recording' }
      await this.loadPcmWorklet(context)
      if (version !== this.transportVersion) {
        this.stopStartingStream(stream)
        return
      }
      await context.resume()
      if (version !== this.transportVersion) {
        this.stopStartingStream(stream)
        return
      }
      const scorer = await this.prepareScoring(context.sampleRate, this.snapshot.settings.latencyMs, this.snapshot.track!.referenceMelody)
      if (version !== this.transportVersion) { scorer.dispose(); this.stopStartingStream(stream); return }
      this.createRecordingSession(context, stream, scorer)
      this.startingStream = null
    } catch (error) {
      if (stream) this.stopStartingStream(stream)
      if (version !== this.transportVersion) return
      console.error('录音启动失败', error)
      this.update({ status: 'ready', error: describeInputError(error), level: 0, pitch: null })
    }
  }

  private createRecordingSession(context: AudioContext, stream: MediaStream, scorer: PitchScoringClient): void {
    const backing = this.backing!
    const settings = this.snapshot.settings
    const startFrame = Math.ceil((context.currentTime + 0.1) * context.sampleRate)
    const endFrame = startFrame + backing.length
    const source = context.createBufferSource()
    source.buffer = backing
    const musicGain = context.createGain()
    musicGain.gain.value = settings.musicVolume
    source.connect(musicGain).connect(context.destination)

    const input = this.createMicrophoneInput(context, stream)
    const worklet = new AudioWorkletNode(context, 'pcm-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { startFrame, endFrame },
    })
    // 静音输出让 Worklet 持续处理，麦克风监听另由显式开关控制。
    const silent = context.createGain()
    silent.gain.value = 0
    input.analyser.connect(worklet).connect(silent).connect(context.destination)

    let resolveDone!: (frames: number) => void
    const done = new Promise<number>((resolve) => { resolveDone = resolve })
    const session: RecordingSession = {
      track: this.snapshot.track!, backing, input, source, worklet, musicGain,
      nodes: [source, musicGain, worklet, silent],
      pcm: new Float32Array(backing.length), startFrame, endFrame, done, resolveDone,
      finishing: null, cancelled: false, receivedFrames: 0, released: false, interruptionReason: null,
      scorer, latencyMs: settings.latencyMs, reference: this.snapshot.track!.referenceMelody,
    }
    worklet.port.onmessage = ({ data }: MessageEvent<
      { type: 'chunk'; offset: number; samples: Float32Array } | { type: 'complete'; frames: number }
    >) => {
      if (data.type === 'chunk') {
        session.pcm.set(data.samples, data.offset)
        session.receivedFrames = data.offset + data.samples.length
        scorer.push(data.samples)
      }
      else {
        resolveDone(data.frames)
        void this.finishRecording(session)
      }
    }
    worklet.onprocessorerror = () => {
      session.cancelled = true
      scorer.dispose()
      resolveDone(0)
      this.releaseSession(session)
      this.recording = null
      this.stopAnimation()
      this.update({ status: 'ready', level: 0, pitch: null, error: '录音处理器运行失败，请停止其他音频任务后重试。' })
    }
    this.recording = session
    this.playbackStartedAt = startFrame / context.sampleRate
    this.playbackOffset = 0
    source.start(this.playbackStartedAt)
    this.update({ status: 'recording', position: 0 })
    this.startAnimation()
  }

  stopRecording = async (): Promise<void> => {
    const session = this.recording
    if (!session) return
    if (!session.finishing) {
      const endFrame = Math.max(session.startFrame, Math.min(session.endFrame, Math.floor(this.context!.currentTime * session.backing.sampleRate)))
      session.worklet.port.postMessage({ type: 'stop', endFrame })
      session.source.stop()
    }
    await this.finishRecording(session)
  }

  interrupt = async (reason = '音频已中断'): Promise<void> => {
    const session = this.recording
    if (session?.released) {
      if (session.finishing) await session.finishing
      return
    }
    const preparing = this.snapshot.status === 'finishing' && !session && !this.snapshot.pendingRecording
    const active = !!(session || this.preview || this.playbackSource || this.startingStream || preparing || this.snapshot.previewStatus === 'starting')
    if (!active) return
    ++this.transportVersion
    if (this.startingStream) this.stopStartingStream(this.startingStream.stream)
    const position = this.playbackSource ? this.currentPosition() : this.snapshot.position
    this.stopPreview()
    this.stopPlayback()
    if (session) {
      session.interruptionReason = reason
      // 被系统挂起的 Worklet 无法再响应 stop；只保留主线程确已收到的连续 PCM。
      this.releaseSession(session)
      session.resolveDone(session.receivedFrames)
      await this.finishRecording(session)
    } else {
      this.update({ status: this.snapshot.track ? 'ready' : 'empty', position, notice: `${reason}。请回到前台后重新开始。` })
    }
  }

  private finishRecording(session: RecordingSession): Promise<void> {
    if (session.finishing) return session.finishing
    this.update({ status: 'finishing' })
    this.stopAnimation()
    session.finishing = (async () => {
      const frames = await session.done
      this.releaseSession(session)
      if (session.cancelled) return
      let realtimeScore: RealtimeScore | undefined
      try {
          const result = await session.scorer.finish()
          if (result.metrics && session.reference) realtimeScore = {
            metrics: result.metrics, modelId: MODEL_ID, referenceId: session.reference.id,
            referenceTitle: session.reference.title, latencyMs: session.latencyMs,
          }
          this.update({ realtime: { ...this.snapshot.realtime, metrics: result.metrics } })
        } catch (error) {
          console.error('实时分析未完成，继续保存原始录音', error)
      } finally {
        session.scorer.dispose()
        if (this.scorer === session.scorer) this.scorer = null
      }
      if (frames === 0) {
        this.recording = null
        this.update({
          status: 'ready', position: 0, level: 0, pitch: null,
          notice: `${session.interruptionReason ?? '录音时间太短'}。尚未收到可保存的声音，请重新开始。`,
        })
        return
      }
      const settings = this.snapshot.settings
      const music = Array.from({ length: session.backing.numberOfChannels }, (_, index) => session.backing.getChannelData(index))
      const mixed = renderMix(music, session.pcm.subarray(0, frames), session.backing.sampleRate, settings)
      const recording: Recording = {
        id: createId(),
        trackId: session.track.id,
        trackTitle: session.track.title,
        title: `${session.track.title} · 我的演唱`,
        createdAt: Date.now(),
        duration: frames / session.backing.sampleRate,
        audio: encodeWav(mixed, session.backing.sampleRate),
        vocalAudio: encodeWav([session.pcm.subarray(0, frames)], session.backing.sampleRate),
        realtimeScore,
      }
      try {
        await this.saveRecording(recording)
      } finally {
        if (this.recording === session) {
          this.recording = null
          this.update({
            status: 'ready', position: recording.duration, level: 0, pitch: null,
            notice: session.interruptionReason
              ? `${session.interruptionReason}。${this.snapshot.pendingRecording ? '部分作品待保存，可重试保存或直接导出。' : `已保存 ${recording.duration.toFixed(1)} 秒部分作品。`}`
              : this.snapshot.notice,
          })
        }
      }
    })()
    return session.finishing
  }

  private async saveRecording(recording: Recording): Promise<void> {
    try {
      await this.onRecordingComplete(recording)
      this.update({ pendingRecording: null, error: null })
    } catch (error) {
      console.error('录音作品保存失败', error)
      this.update({ pendingRecording: recording, error: '录音已生成，但保存作品失败。音频已暂存，可重试保存或直接导出。' })
    }
  }

  retrySaveRecording = async (): Promise<void> => {
    const recording = this.snapshot.pendingRecording
    if (!recording || this.snapshot.status === 'finishing' || this.snapshot.status === 'recording') return
    this.stopPlayback()
    this.update({ status: 'finishing' })
    await this.saveRecording(recording)
    this.update({
      status: this.snapshot.track ? 'ready' : 'empty',
      notice: this.snapshot.pendingRecording ? this.snapshot.notice : '作品已保存。',
    })
  }

  discardPendingRecording = (): void => {
    this.update({ pendingRecording: null, error: null, notice: null })
  }

  updateSettings = (patch: Partial<MixerSettings>): void => {
    const settings = { ...this.snapshot.settings, ...patch }
    this.update({ settings })
    try {
      localStorage.setItem('qingchang-mixer', JSON.stringify(settings))
    } catch (error) {
      console.error('混音设置保存失败', error)
      this.update({ error: '混音参数已生效，但无法保存设置，请检查本机存储权限。' })
    }
    if (this.playbackGain) this.playbackGain.gain.value = settings.musicVolume
    if (this.recording) this.recording.musicGain.gain.value = settings.musicVolume
    const input = this.recording?.input ?? this.preview
    if (input) {
      input.tone.setTone(settings.vocalTone)
      input.vocalGain.gain.value = settings.vocalVolume
      input.monitorGate.gain.value = settings.monitoring ? 1 : 0
      input.reverbGain.gain.value = settings.reverb * 0.55
    }
  }

  clearError = (): void => { this.update({ error: null }) }
  clearNotice = (): void => { this.update({ notice: null }) }

  stop = (): void => {
    this.stopPreview()
    if (this.startingStream) this.stopStartingStream(this.startingStream.stream)
    if (this.recording) {
      void this.stopRecording()
      return
    }
    ++this.transportVersion
    this.stopPlayback()
    this.update({ status: this.snapshot.track ? 'ready' : 'empty', position: 0, level: 0, pitch: null })
  }

  private currentPosition(): number {
    return Math.max(0, Math.min(this.snapshot.duration, this.playbackOffset + this.context!.currentTime - this.playbackStartedAt))
  }

  private stopPlayback(): void {
    if (this.playbackSource) {
      this.playbackSource.onended = null
      this.playbackSource.stop()
      this.playbackSource.disconnect()
      this.playbackSource = null
      this.playbackGain!.disconnect()
      this.playbackGain = null
    }
    if (!this.preview) this.stopAnimation()
  }

  private releaseSession(session: RecordingSession): void {
    if (session.released) return
    session.released = true
    session.source.stop()
    session.worklet.onprocessorerror = null
    session.worklet.port.onmessage = null
    session.worklet.port.close()
    for (const node of session.nodes) node.disconnect()
    this.releaseInput(session.input)
  }

  private startAnimation(): void {
    this.stopAnimation()
    const tick = (now: number) => {
      const patch: Partial<StudioSnapshot> = {}
      if (this.snapshot.status === 'playing' || this.snapshot.status === 'recording') patch.position = this.currentPosition()
      const input = this.recording?.input ?? this.preview
      if (input && now - this.lastMeterAt >= 90) {
        this.lastMeterAt = now
        const samples = new Float32Array(input.analyser.fftSize)
        input.analyser.getFloatTimeDomainData(samples)
        let energy = 0
        for (const sample of samples) energy += sample * sample
        patch.level = Math.min(1, Math.sqrt(energy / samples.length) * 3)
      }
      this.update(patch)
      if (this.snapshot.status === 'playing' || this.snapshot.status === 'recording' || this.preview) {
        this.animationFrame = requestAnimationFrame(tick)
      }
    }
    this.animationFrame = requestAnimationFrame(tick)
  }

  private stopAnimation(): void {
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = 0
  }

  dispose = (): void => {
    this.scorer?.dispose()
    this.scorer = null
    ++this.loadVersion
    ++this.transportVersion
    this.stopPreview()
    if (this.startingStream) this.stopStartingStream(this.startingStream.stream)
    this.stopPlayback()
    if (this.recording) {
      this.recording.cancelled = true
      this.recording.resolveDone(0)
      this.releaseSession(this.recording)
      this.recording = null
    }
    if (this.context) {
      this.context.onstatechange = null
      void this.context.close().catch((error: unknown) => { console.error('音频设备关闭失败', error) })
    }
    this.context = null
    this.workletLoaded = null
  }
}
