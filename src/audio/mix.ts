import type { MixerSettings } from '../core/types'
import { applyVocalTone } from './effects'

export const DEFAULT_MIXER_SETTINGS: MixerSettings = {
  musicVolume: 0.72,
  vocalVolume: 0.85,
  reverb: 0.18,
  monitoring: false,
  lyricOffsetMs: 0,
  latencyMs: 0,
  vocalTone: 'natural',
}

/** 正 latencyMs 将录到的人声提前，用于补偿麦克风输入延迟。 */
export function renderMix(
  music: readonly Float32Array[],
  vocal: Float32Array,
  sampleRate: number,
  settings: MixerSettings,
): [Float32Array, Float32Array] {
  const frames = vocal.length
  const result: [Float32Array, Float32Array] = [new Float32Array(frames), new Float32Array(frames)]
  const shift = Math.round((settings.latencyMs * sampleRate) / 1000)
  const processedVocal = applyVocalTone(vocal, sampleRate, settings.vocalTone)
  for (let channel = 0; channel < 2; channel++) {
    const backing = music[Math.min(channel, music.length - 1)]
    const delays = (channel === 0 ? [0.031, 0.047, 0.071] : [0.037, 0.053, 0.079])
      .map((seconds) => new Float32Array(Math.max(1, Math.round(seconds * sampleRate))))
    for (let frame = 0; frame < frames; frame++) {
      const vocalFrame = frame + shift
      const dry = vocalFrame >= 0 && vocalFrame < frames ? processedVocal[vocalFrame] : 0
      let wet = 0
      for (const delay of delays) {
        const index = frame % delay.length
        const echo = delay[index]
        delay[index] = dry + echo * 0.56
        wet += echo / delays.length
      }
      result[channel][frame] = backing[frame] * settings.musicVolume
        + (dry + wet * settings.reverb * 0.55) * settings.vocalVolume
    }
  }
  return result
}

/** 交错 PCM16 WAV；最终量化时限幅，采样率和时间轴保持不变。 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Blob {
  const frames = channels[0].length
  const channelCount = channels.length
  const bytes = frames * channelCount * 2
  const buffer = new ArrayBuffer(44 + bytes)
  const view = new DataView(buffer)
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, bytes + 36, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * 2, true)
  view.setUint16(32, channelCount * 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, bytes, true)
  let offset = 44
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const value = Math.max(-1, Math.min(1, channel[frame]))
      view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      offset += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
