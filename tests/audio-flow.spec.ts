import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Chrome 内置假麦克风有静音间隔；使用连续 A4 输入让非静音验收可复现。
const microphoneFixture = join(tmpdir(), 'qingchang-test-microphone.wav')
const fixtureSampleRate = 48000
const fixtureFrames = fixtureSampleRate * 2
const fixture = Buffer.alloc(44 + fixtureFrames * 2)
fixture.write('RIFF', 0)
fixture.writeUInt32LE(fixture.length - 8, 4)
fixture.write('WAVEfmt ', 8)
fixture.writeUInt32LE(16, 16)
fixture.writeUInt16LE(1, 20)
fixture.writeUInt16LE(1, 22)
fixture.writeUInt32LE(fixtureSampleRate, 24)
fixture.writeUInt32LE(fixtureSampleRate * 2, 28)
fixture.writeUInt16LE(2, 32)
fixture.writeUInt16LE(16, 34)
fixture.write('data', 36)
fixture.writeUInt32LE(fixtureFrames * 2, 40)
for (let frame = 0; frame < fixtureFrames; frame++) {
  fixture.writeInt16LE(Math.round(0.2 * 32767 * Math.sin(2 * Math.PI * 440 * frame / fixtureSampleRate)), 44 + frame * 2)
}
writeFileSync(microphoneFixture, fixture)

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-audio-capture=${microphoneFixture}`],
  },
})

test('真实浏览器完成麦克风返听预览、音色录制与保存，并验证滤镜一致和资源释放', async ({ page, context }) => {
  await context.grantPermissions(['microphone'])
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/StudioEngine.ts'
    const mixPath = '/src/audio/mix.ts'
    const effectsPath = '/src/audio/effects.ts'
    const { StudioEngine } = await import(/* @vite-ignore */ enginePath)
    const { encodeWav, renderMix, DEFAULT_MIXER_SETTINGS } = await import(/* @vite-ignore */ mixPath)
    const { createRealtimeToneChain, VOCAL_TONE_PRESETS } = await import(/* @vite-ignore */ effectsPath)
    const streams: MediaStream[] = []
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints)
      streams.push(stream)
      return stream
    }
    const sampleRate = 48000
    const samples = Float32Array.from({ length: sampleRate * 1.25 }, (_, frame) => 0.12 * Math.sin(2 * Math.PI * 220 * frame / sampleRate))
    const recorded: { duration: number; wav: Blob; vocalWav: Blob }[] = []
    let failNextSave = false
    // 使用已发布首版的真实缓存结构，验证一次性补 natural 并保留用户参数。
    const { vocalTone: _newField, ...oldSettings } = { ...DEFAULT_MIXER_SETTINGS, latencyMs: 17, musicVolume: 0.43 }
    localStorage.setItem('qingchang-mixer', JSON.stringify(oldSettings))
    const engine = new StudioEngine(async (recording: { duration: number; audio: Blob; vocalAudio: Blob }) => {
      if (failNextSave) { failNextSave = false; throw new Error('测试：存储写入失败') }
      recorded.push({ duration: recording.duration, wav: recording.audio, vocalWav: recording.vocalAudio })
    })
    const migratedSettings = engine.getSnapshot().settings
    const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    const waitReady = () => new Promise<void>((resolve) => {
      if (engine.getSnapshot().status === 'ready') return resolve()
      const unsubscribe = engine.subscribe(() => {
        if (engine.getSnapshot().status === 'ready') { unsubscribe(); resolve() }
      })
    })
    const track = {
      id: 'audio-browser-test', title: '测试伴奏', artist: '测试', duration: 1.25,
      cover: 'amber', origin: 'local', lyrics: '[00:00]测试', createdAt: Date.now(), favorite: false,
      audio: encodeWav([samples], sampleRate),
    }

    engine.updateSettings({ monitoring: false })
    await engine.startPreview()
    await wait(280)
    const preview = { status: engine.getSnapshot().previewStatus, level: engine.getSnapshot().level, note: engine.getSnapshot().pitch?.note }
    engine.updateSettings({ monitoring: true, vocalTone: 'warm' })
    await wait(100)
    engine.stopPreview()
    const previewReleased = streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))
    await engine.selectTrack(track)
    await engine.togglePlayback()
    await wait(160)
    const playingPosition = engine.getSnapshot().position
    engine.seek(0.4)
    await engine.togglePlayback()
    const paused = { status: engine.getSnapshot().status, position: engine.getSnapshot().position }
    engine.stop()
    const stoppedPosition = engine.getSnapshot().position

    // 第一遍只导出真实假设备输入，保证非静音不是来自伴奏。
    engine.updateSettings({ musicVolume: 0, vocalVolume: 1, reverb: 0, monitoring: false, vocalTone: 'natural', latencyMs: 0 })
    await engine.startPreview()
    const previewBeforeRecording = streams.at(-1)!
    await engine.startRecording()
    const previewToRecordingReleased = engine.getSnapshot().previewStatus === 'off'
      && previewBeforeRecording.getTracks().every((track) => track.readyState === 'ended')
    const recordingStatus = engine.getSnapshot().status
    engine.seek(1)
    await engine.selectTrack({ ...track, id: 'forbidden-during-recording' })
    const recordingTrackId = engine.getSnapshot().track.id
    await wait(520)
    const measuredLevel = engine.getSnapshot().level
    const measuredNote = engine.getSnapshot().pitch?.note
    await engine.stopRecording()
    const firstReleased = streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))

    // 第二遍以电台滤镜自然曲终，最终 WAV 频响应与原声不同。
    engine.updateSettings({ vocalTone: 'radio' })
    await engine.startRecording()
    await waitReady()
    const autoEndedStatus = engine.getSnapshot().status
    const allReleased = streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))

    // 保存失败保留完整作品，禁止覆盖，并能使用相同 Blob 重试保存。
    engine.updateSettings({ musicVolume: 0.5, vocalVolume: 0.5, reverb: 0.25, latencyMs: 30 })
    failNextSave = true
    await engine.startRecording()
    await wait(300)
    await engine.stopRecording()
    const pending = engine.getSnapshot().pendingRecording
    const pendingBytes = pending.audio.size
    await engine.startRecording()
    const pendingBlocksRecording = engine.getSnapshot().status === 'ready' && engine.getSnapshot().pendingRecording.id === pending.id
    await engine.retrySaveRecording()
    const pendingCleared = engine.getSnapshot().pendingRecording === null
    const output = []
    for (const recording of recorded) {
      const view = new DataView(await recording.wav.arrayBuffer())
      const dry = new DataView(await recording.vocalWav.arrayBuffer())
      let energy = 0
      let nonSilent = 0
      for (let index = 44; index < view.byteLength; index += 2) {
        const sample = view.getInt16(index, true) / 32768
        energy += sample * sample
        if (sample !== 0) nonSilent++
      }
      output.push({
        duration: recording.duration,
        channels: view.getUint16(22, true),
        sampleRate: view.getUint32(24, true),
        frames: view.getUint32(40, true) / 4,
        rms: Math.sqrt(energy / ((view.byteLength - 44) / 2)),
        nonSilent,
        dryChannels: dry.getUint16(22, true),
        dryFrames: dry.getUint32(40, true) / 2,
        dryRms: Math.sqrt(Array.from({ length: (dry.byteLength - 44) / 2 }, (_, frame) => (dry.getInt16(44 + frame * 2, true) / 32768) ** 2).reduce((sum, value) => sum + value, 0) / ((dry.byteLength - 44) / 2)),
      })
    }
    // 在权限准备阶段取消后，结果不应产生第三份录音。
    const preparation = engine.startRecording()
    engine.stop()
    await preparation
    const cancelledStatus = engine.getSnapshot().status

    // 同一公开实时滤波链放入标准 OfflineAudioContext，与最终 PCM 导出逐样本比较。
    const agreement = []
    const input = Float32Array.from({ length: 12000 }, (_, frame) => 0.1 * (
      Math.sin(2 * Math.PI * 100 * frame / sampleRate)
      + Math.sin(2 * Math.PI * 1000 * frame / sampleRate)
      + Math.sin(2 * Math.PI * 8000 * frame / sampleRate)
    ))
    for (const preset of VOCAL_TONE_PRESETS) {
      const offline = new OfflineAudioContext(1, input.length, sampleRate)
      const source = offline.createBufferSource()
      source.buffer = offline.createBuffer(1, input.length, sampleRate)
      source.buffer.copyToChannel(input, 0)
      const chainInput = offline.createGain()
      const chainOutput = offline.createGain()
      source.connect(chainInput)
      const tone = createRealtimeToneChain(offline, chainInput, chainOutput, 'natural')
      tone.setTone(preset.id)
      chainOutput.connect(offline.destination)
      source.start()
      const actual = (await offline.startRendering()).getChannelData(0)
      const expected = renderMix([new Float32Array(input.length)], input, sampleRate, {
        ...DEFAULT_MIXER_SETTINGS, musicVolume: 0, vocalVolume: 1, reverb: 0, vocalTone: preset.id,
      })[0]
      let maxError = 0
      for (let frame = 0; frame < input.length; frame++) maxError = Math.max(maxError, Math.abs(actual[frame] - expected[frame]))
      agreement.push({ tone: preset.id, maxError })
      tone.dispose()
    }

    await engine.startPreview()
    const disposalStream = streams.at(-1)!
    engine.dispose()
    const disposeReleasedPreview = disposalStream.getTracks().every((track) => track.readyState === 'ended')
    const restoredEngine = new StudioEngine(async () => {})
    const restoredLatency = restoredEngine.getSnapshot().settings.latencyMs
    restoredEngine.dispose()
    navigator.mediaDevices.getUserMedia = getUserMedia
    return {
      playingPosition, paused, stoppedPosition, recordingStatus, recordingTrackId,
      measuredLevel, measuredNote, firstReleased, autoEndedStatus, allReleased, cancelledStatus, output,
      pendingBytes, pendingBlocksRecording, pendingCleared, restoredLatency,
      preview, previewReleased, previewToRecordingReleased, disposeReleasedPreview, migratedSettings, agreement,
    }
  })
  console.log('音频闭环验收结果', JSON.stringify(result))
  expect(result.playingPosition).toBeGreaterThan(0)
  expect(result.migratedSettings.vocalTone).toBe('natural')
  expect(result.migratedSettings.musicVolume).toBe(0.43)
  expect(result.migratedSettings.latencyMs).toBe(17)
  expect(result.preview.status).toBe('on')
  expect(result.preview.level).toBeGreaterThan(0.1)
  expect(result.preview.note).toBe('A4')
  expect(result.previewReleased).toBe(true)
  expect(result.previewToRecordingReleased).toBe(true)
  expect(result.disposeReleasedPreview).toBe(true)
  for (const preset of result.agreement) expect(preset.maxError).toBeLessThan(0.000001)
  expect(result.paused.status).toBe('ready')
  expect(result.paused.position).toBeGreaterThanOrEqual(0.4)
  expect(result.stoppedPosition).toBe(0)
  expect(result.recordingStatus).toBe('recording')
  expect(result.recordingTrackId).toBe('audio-browser-test')
  expect(result.measuredLevel).toBeGreaterThan(0)
  expect(result.measuredNote).toBe('A4')
  expect(result.firstReleased).toBe(true)
  expect(result.autoEndedStatus).toBe('ready')
  expect(result.allReleased).toBe(true)
  expect(result.cancelledStatus).toBe('ready')
  expect(result.pendingBytes).toBeGreaterThan(44)
  expect(result.pendingBlocksRecording).toBe(true)
  expect(result.pendingCleared).toBe(true)
  expect(result.restoredLatency).toBe(30)
  expect(result.output).toHaveLength(3)
  expect(result.output[0].duration).toBeGreaterThan(0.2)
  expect(result.output[0].duration).toBeLessThan(1.25)
  expect(result.output[1].duration).toBeCloseTo(1.25, 3)
  expect(result.output[1].rms).toBeLessThan(result.output[0].rms * 0.95)
  expect(result.output[1].rms).toBeGreaterThan(result.output[0].rms * 0.5)
  for (const recording of result.output) {
    expect(recording.channels).toBe(2)
    expect(recording.frames / recording.sampleRate).toBeCloseTo(recording.duration, 6)
    expect(recording.rms).toBeGreaterThan(0.002)
    expect(recording.nonSilent).toBeGreaterThan(1000)
    expect(recording.dryChannels).toBe(1)
    expect(recording.dryFrames).toBe(recording.frames)
    expect(recording.dryRms).toBeCloseTo(0.2 / Math.sqrt(2), 2)
  }
})
