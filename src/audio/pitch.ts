import type { Pitch } from '../core/types'

/** YIN 差分与抛物线插值，只报告麦克风实际检测到的基频。 */
export function detectPitch(samples: Float32Array, sampleRate: number): Pitch | null {
  let energy = 0
  for (const sample of samples) energy += sample * sample
  if (Math.sqrt(energy / samples.length) < 0.008) return null

  const window = Math.floor(samples.length / 2)
  const maxLag = Math.min(window - 1, Math.ceil(sampleRate / 65))
  const difference = new Float32Array(maxLag + 1)
  let running = 0
  difference[0] = 1
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0
    for (let index = 0; index < window; index++) {
      const delta = samples[index] - samples[index + lag]
      sum += delta * delta
    }
    running += sum
    difference[lag] = running === 0 ? 1 : (sum * lag) / running
  }

  let lag = Math.ceil(sampleRate / 1200)
  while (lag < maxLag) {
    if (difference[lag] < 0.12) {
      while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) lag++
      const left = difference[lag - 1]
      const center = difference[lag]
      const right = difference[lag + 1]
      const curvature = left - 2 * center + right
      const refined = lag + (curvature === 0 ? 0 : (left - right) / (2 * curvature))
      const frequency = sampleRate / refined
      const midi = Math.round(69 + 12 * Math.log2(frequency / 440))
      const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
      return {
        frequency,
        note: `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`,
        cents: Math.round(1200 * Math.log2(frequency / (440 * 2 ** ((midi - 69) / 12)))),
      }
    }
    lag++
  }
  return null
}
