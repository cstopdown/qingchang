/** 有限窗 sinc 低通重采样；相位和滤波上下文跨 PCM 消息保留。 */
export class PitchWindows {
  private native = new Float32Array(0)
  private nativeStart = 0
  private inputLength = 0
  private nextOutput = 0
  private pending: number[] = Array(512).fill(0)
  private center = 0
  private readonly radius = 24

  constructor(private sampleRate: number) {}

  push(chunk: Float32Array): Array<{ samples: Float32Array; timeSeconds: number }> {
    const joined = new Float32Array(this.native.length + chunk.length)
    joined.set(this.native)
    joined.set(chunk, this.native.length)
    this.native = joined
    this.inputLength += chunk.length
    const cutoff = Math.min(1, 16000 / this.sampleRate) * 0.9
    while (this.nextOutput * this.sampleRate / 16000 + this.radius < this.inputLength) {
      const position = this.nextOutput * this.sampleRate / 16000
      const left = Math.ceil(position - this.radius)
      let weighted = 0
      let weight = 0
      for (let index = left; index <= Math.floor(position + this.radius); index++) {
        const distance = index - position
        const x = Math.PI * cutoff * distance
        const kernel = (x === 0 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos(Math.PI * distance / this.radius))
        weight += kernel
        if (index >= 0) weighted += this.native[index - this.nativeStart] * kernel
      }
      this.pending.push(weighted / weight)
      this.nextOutput++
    }
    const keepFrom = Math.max(0, Math.ceil(this.nextOutput * this.sampleRate / 16000 - this.radius))
    this.native = this.native.slice(keepFrom - this.nativeStart)
    this.nativeStart = keepFrom
    const result = []
    while (this.pending.length >= 1024) {
      result.push({ samples: Float32Array.from(this.pending.slice(0, 1024)), timeSeconds: this.center / 16000 })
      this.pending = this.pending.slice(800)
      this.center += 800
    }
    return result
  }

  finish(): Array<{ samples: Float32Array; timeSeconds: number }> {
    const duration = this.inputLength / this.sampleRate
    return this.push(new Float32Array(Math.ceil(512 * this.sampleRate / 16000) + this.radius * 2))
      .filter(frame => frame.timeSeconds < duration)
  }
}
