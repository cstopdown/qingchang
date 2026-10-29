import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MIXER_SETTINGS, encodeWav, renderMix } from '../src/audio/mix'
import { detectPitch } from '../src/audio/pitch'
import { VOCAL_TONE_PRESETS } from '../src/audio/effects'

describe('完整音频输出', () => {
  it('将 A4 人声与伴奏导出为有效 WAV，四种真实音色保留预期频段响应', async () => {
    const sampleRate = 48000
    const vocal = Float32Array.from({ length: sampleRate }, (_, frame) => 0.2 * Math.sin(2 * Math.PI * 440 * frame / sampleRate))
    const left = new Float32Array(sampleRate).fill(0.1)
    const right = new Float32Array(sampleRate).fill(-0.1)
    const pitch = detectPitch(vocal.subarray(0, 2048), sampleRate)!
    expect(pitch.note).toBe('A4')
    expect(pitch.frequency).toBeCloseTo(440, 0)
    expect(Math.abs(pitch.cents)).toBeLessThanOrEqual(1)
    expect(detectPitch(new Float32Array(2048), sampleRate)).toBeNull()

    const mixed = renderMix([left, right], vocal, sampleRate, {
      ...DEFAULT_MIXER_SETTINGS, musicVolume: 0.5, vocalVolume: 0.8, reverb: 0,
    })
    expect(mixed[0][51]).toBeCloseTo(0.05 + vocal[51] * 0.8, 6)
    expect(mixed[1][51]).toBeCloseTo(-0.05 + vocal[51] * 0.8, 6)
    const wav = encodeWav(mixed, sampleRate)
    const bytes = await wav.arrayBuffer()
    const view = new DataView(bytes)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(sampleRate)
    expect(view.getUint32(40, true)).toBe(sampleRate * 4)
    expect(bytes.byteLength).toBe(44 + sampleRate * 4)
    expect(view.getInt16(44 + 51 * 4, true)).toBeCloseTo(Math.round(mixed[0][51] * 32767), 0)

    const response: Record<string, number> = {}
    for (const preset of VOCAL_TONE_PRESETS) {
      for (const frequency of [100, 1000, 8000]) {
        const tone = Float32Array.from({ length: sampleRate }, (_, frame) => 0.1 * Math.sin(2 * Math.PI * frequency * frame / sampleRate))
        const output = renderMix([new Float32Array(sampleRate)], tone, sampleRate, {
          ...DEFAULT_MIXER_SETTINGS, musicVolume: 0, vocalVolume: 1, reverb: 0, vocalTone: preset.id,
        })
        if (preset.id === 'natural') expect(output[0]).toEqual(tone)
        const renderedWav = new DataView(await encodeWav(output, sampleRate).arrayBuffer())
        let energy = 0
        // 排除滤波器开始时的短暂瞬态，比较最终 WAV 的稳态频响。
        for (let frame = sampleRate / 4; frame < sampleRate; frame++) {
          const value = renderedWav.getInt16(44 + frame * 4, true) / 32768
          energy += value * value
        }
        response[`${preset.id}:${frequency}`] = Math.sqrt(energy / (sampleRate * 0.75))
      }
    }
    expect(response['warm:100']).toBeGreaterThan(response['natural:100'] * 1.3)
    expect(response['warm:8000']).toBeLessThan(response['natural:8000'] * 0.8)
    expect(response['bright:8000']).toBeGreaterThan(response['natural:8000'] * 1.3)
    expect(response['radio:100']).toBeLessThan(response['natural:100'] * 0.15)
    expect(response['radio:8000']).toBeLessThan(response['natural:8000'] * 0.2)
    expect(response['radio:1000']).toBeGreaterThan(response['natural:1000'] * 0.9)
  })

  it('在同一完整时间轴补偿正负输入延迟，混响产生衰减尾音并对最终 WAV 限幅', async () => {
    const sampleRate = 1000
    const vocal = new Float32Array(1000)
    vocal[200] = 1
    const music = [new Float32Array(1000).fill(0.25)]
    const settings = { ...DEFAULT_MIXER_SETTINGS, musicVolume: 0.4, vocalVolume: 0.6, reverb: 0 }
    const earlier = renderMix(music, vocal, sampleRate, { ...settings, latencyMs: 100 })
    const later = renderMix(music, vocal, sampleRate, { ...settings, latencyMs: -100 })
    expect(earlier[0][100]).toBeCloseTo(0.7, 6)
    expect(earlier[0][200]).toBeCloseTo(0.1, 6)
    expect(later[0][300]).toBeCloseTo(0.7, 6)
    expect(later[0][200]).toBeCloseTo(0.1, 6)
    expect(earlier[0].length).toBe(vocal.length)
    expect(later[0].length).toBe(vocal.length)

    const wet = renderMix(music, vocal, sampleRate, { ...settings, reverb: 1 })
    expect(wet[0][231]).toBeGreaterThan(0.1)
    expect(wet[1][237]).toBeGreaterThan(0.1)
    expect(wet[0][262] - 0.1).toBeLessThan(wet[0][231] - 0.1)
    const clipped = new DataView(await encodeWav([new Float32Array([2, -2])], sampleRate).arrayBuffer())
    expect(clipped.getInt16(44, true)).toBe(32767)
    expect(clipped.getInt16(46, true)).toBe(-32768)
  })

  it('PCM 工作器排除起唱前等待，按绝对帧采集完整歌曲和手动结束的录音', () => {
    // 以公开 Worklet 消息协议运行真实处理器，输入模拟音频渲染块。
    const source = readFileSync(new URL('../public/audio-worklets/pcm-recorder.js', import.meta.url), 'utf8')
    type Message = { type: 'chunk'; offset: number; samples: Float32Array } | { type: 'complete'; frames: number }
    type Processor = {
      port: { onmessage: (event: { data: { type: 'stop'; endFrame: number } }) => void }
      process: (inputs: Float32Array[][]) => boolean
    }
    let Recorder!: new (options: { processorOptions: { startFrame: number; endFrame: number } }) => Processor
    const messages: Message[] = []
    const scope = {
      currentFrame: 0,
      AudioWorkletProcessor: class { port = { postMessage: (message: Message) => messages.push(message), onmessage: null } },
      registerProcessor: (_name: string, processor: typeof Recorder) => { Recorder = processor },
      Float32Array,
    }
    runInNewContext(source, scope)
    for (const stopAt of [700, 410]) {
      messages.length = 0
      const recorder = new Recorder({ processorOptions: { startFrame: 300, endFrame: 700 } })
      for (let frame = 0; frame < 768; frame += 128) {
        scope.currentFrame = frame
        if (frame === 384 && stopAt === 410) recorder.port.onmessage({ data: { type: 'stop', endFrame: stopAt } })
        const left = Float32Array.from({ length: 128 }, (_, index) => (frame + index) / 1000)
        const right = Float32Array.from(left, (sample) => sample * 0.5)
        if (!recorder.process([[left, right]])) break
      }
      const captured = new Float32Array(stopAt - 300)
      for (const message of messages) if (message.type === 'chunk') captured.set(message.samples, message.offset)
      expect(messages.at(-1)).toEqual({ type: 'complete', frames: stopAt - 300 })
      expect(captured[0]).toBeCloseTo(0.3 * 0.75, 6)
      expect(captured.at(-1)).toBeCloseTo((stopAt - 1) / 1000 * 0.75, 6)
    }
  })
})
