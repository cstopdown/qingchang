import type { VocalTone } from '../core/types'

interface ToneFilter {
  type: 'highpass' | 'lowpass' | 'lowshelf' | 'highshelf' | 'peaking'
  frequency: number
  Q: number
  gainDb: number
}

interface VocalTonePreset {
  id: VocalTone
  label: string
  description: string
  filters: readonly ToneFilter[]
}

export const VOCAL_TONE_PRESETS: readonly VocalTonePreset[] = [
  { id: 'natural', label: '原声', description: '保留声音本来的质感', filters: [] },
  {
    id: 'warm', label: '温暖', description: '低频更厚实，高频更柔和',
    filters: [
      { type: 'highpass', frequency: 70, Q: Math.SQRT1_2, gainDb: 0 },
      { type: 'lowshelf', frequency: 220, Q: Math.SQRT1_2, gainDb: 4.5 },
      { type: 'highshelf', frequency: 3200, Q: Math.SQRT1_2, gainDb: -3.5 },
    ],
  },
  {
    id: 'bright', label: '明亮', description: '提升清晰度，让咬字更清亮',
    filters: [
      { type: 'highpass', frequency: 100, Q: Math.SQRT1_2, gainDb: 0 },
      { type: 'peaking', frequency: 2500, Q: 0.8, gainDb: 3 },
      { type: 'highshelf', frequency: 5500, Q: Math.SQRT1_2, gainDb: 4 },
    ],
  },
  {
    id: 'radio', label: '电台', description: '收窄频段，营造复古电台感',
    filters: [
      { type: 'highpass', frequency: 350, Q: Math.SQRT1_2, gainDb: 0 },
      { type: 'peaking', frequency: 1500, Q: 0.85, gainDb: 2.5 },
      { type: 'lowpass', frequency: 3200, Q: Math.SQRT1_2, gainDb: 0 },
    ],
  },
]

interface BiquadCoefficients {
  feedforward: [number, number, number]
  feedback: [number, number, number]
}

/** RBJ 双二阶系数；实时 IIRFilter 与离线 PCM 共用这一份定义。 */
function coefficients(filter: ToneFilter, sampleRate: number): BiquadCoefficients {
  const omega = 2 * Math.PI * filter.frequency / sampleRate
  const cosine = Math.cos(omega)
  const alpha = Math.sin(omega) / (2 * filter.Q)
  const amplitude = 10 ** (filter.gainDb / 40)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  switch (filter.type) {
    case 'highpass':
      b0 = (1 + cosine) / 2; b1 = -(1 + cosine); b2 = b0
      a0 = 1 + alpha; a1 = -2 * cosine; a2 = 1 - alpha
      break
    case 'lowpass':
      b0 = (1 - cosine) / 2; b1 = 1 - cosine; b2 = b0
      a0 = 1 + alpha; a1 = -2 * cosine; a2 = 1 - alpha
      break
    case 'peaking':
      b0 = 1 + alpha * amplitude; b1 = -2 * cosine; b2 = 1 - alpha * amplitude
      a0 = 1 + alpha / amplitude; a1 = -2 * cosine; a2 = 1 - alpha / amplitude
      break
    case 'lowshelf': {
      const beta = 2 * Math.sqrt(amplitude) * alpha
      b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + beta)
      b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine)
      b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - beta)
      a0 = (amplitude + 1) + (amplitude - 1) * cosine + beta
      a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosine)
      a2 = (amplitude + 1) + (amplitude - 1) * cosine - beta
      break
    }
    case 'highshelf': {
      const beta = 2 * Math.sqrt(amplitude) * alpha
      b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + beta)
      b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine)
      b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - beta)
      a0 = (amplitude + 1) - (amplitude - 1) * cosine + beta
      a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosine)
      a2 = (amplitude + 1) - (amplitude - 1) * cosine - beta
      break
    }
  }
  return { feedforward: [b0 / a0, b1 / a0, b2 / a0], feedback: [1, a1 / a0, a2 / a0] }
}

function toneCoefficients(tone: VocalTone, sampleRate: number): BiquadCoefficients[] {
  return VOCAL_TONE_PRESETS.find((preset) => preset.id === tone)!.filters.map((filter) => coefficients(filter, sampleRate))
}

/** natural 不经过任何滤波；其他预设逐级处理，不改变长度、采样率或幅度归一化。 */
export function applyVocalTone(samples: Float32Array, sampleRate: number, tone: VocalTone): Float32Array {
  let signal = samples
  for (const { feedforward: [b0, b1, b2], feedback: [, a1, a2] } of toneCoefficients(tone, sampleRate)) {
    const output = new Float32Array(samples.length)
    let z1 = 0, z2 = 0
    for (let frame = 0; frame < signal.length; frame++) {
      const input = signal[frame]
      const value = b0 * input + z1
      z1 = b1 * input - a1 * value + z2
      z2 = b2 * input - a2 * value
      output[frame] = value
    }
    signal = output
  }
  return signal
}

export interface RealtimeToneChain {
  setTone: (tone: VocalTone) => void
  dispose: () => void
}

/** 专用 input 节点只有本链路一个输出，可以在预览和录音期间切换预设。 */
export function createRealtimeToneChain(
  context: BaseAudioContext,
  input: AudioNode,
  output: AudioNode,
  initialTone: VocalTone,
): RealtimeToneChain {
  let currentTone: VocalTone | null = null
  let filters: IIRFilterNode[] = []
  const disconnect = () => {
    input.disconnect()
    for (const filter of filters) filter.disconnect()
    filters = []
  }
  const setTone = (tone: VocalTone) => {
    if (tone === currentTone) return
    disconnect()
    currentTone = tone
    let tail = input
    filters = toneCoefficients(tone, context.sampleRate).map(({ feedforward, feedback }) => {
      const filter = context.createIIRFilter(feedforward, feedback)
      tail.connect(filter)
      tail = filter
      return filter
    })
    tail.connect(output)
  }
  setTone(initialTone)
  return { setTone, dispose: disconnect }
}
