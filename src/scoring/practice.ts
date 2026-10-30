import { encodeWav } from '../audio/mix'
import type { PitchFrame, ReferenceMelody } from './types'

/** 自制 C 大调上行练习：2秒准备、每音1秒、末尾1秒休止。不是既有歌曲原唱。 */
export function createScalePractice(): { audio: Blob; reference: ReferenceMelody; duration: number } {
  const sampleRate = 16000
  const duration = 11
  const midi = [60, 62, 64, 65, 67, 69, 71, 72]
  const samples = new Float32Array(duration * sampleRate)
  const frames: PitchFrame[] = []
  for (let index = 0; index < duration * 20; index++) {
    const timeSeconds = index * 0.05
    const note = Math.floor(timeSeconds) - 2
    frames.push({ timeSeconds, frequencyHz: note >= 0 && note < midi.length ? 440 * 2 ** ((midi[note] - 69) / 12) : null, confidence: note >= 0 && note < midi.length ? 1 : 0 })
  }
  for (let index = 2 * sampleRate; index < 10 * sampleRate; index++) {
    const seconds = index / sampleRate
    const frequency = 440 * 2 ** ((midi[Math.floor(seconds) - 2] - 69) / 12)
    const phase = seconds % 1
    const envelope = Math.min(1, phase / 0.015, (1 - phase) / 0.015)
    samples[index] = envelope * (0.18 * Math.sin(2 * Math.PI * frequency * seconds) + 0.04 * Math.sin(4 * Math.PI * frequency * seconds))
  }
  return {
    audio: encodeWav([samples], sampleRate), duration,
    reference: { id: 'qingchang-c-major-v1', title: '自制 C 大调音阶参考', offsetSeconds: 0, hopSeconds: 0.05, frames, source: { kind: 'f0-json' } },
  }
}
