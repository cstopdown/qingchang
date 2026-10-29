/** AudioContext 的绝对帧编号同时确定伴奏起点和麦克风采集窗口。 */
class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.startFrame = options.processorOptions.startFrame
    this.endFrame = options.processorOptions.endFrame
    this.chunk = new Float32Array(4096)
    this.chunkLength = 0
    this.offset = 0
    this.port.onmessage = ({ data }) => {
      if (data.type === 'stop') this.endFrame = Math.min(this.endFrame, data.endFrame)
    }
  }

  flush() {
    if (this.chunkLength === 0) return
    const samples = this.chunk.slice(0, this.chunkLength)
    this.port.postMessage({ type: 'chunk', offset: this.offset, samples }, [samples.buffer])
    this.offset += this.chunkLength
    this.chunkLength = 0
  }

  process(inputs) {
    const input = inputs[0]
    for (let index = 0; index < 128; index++) {
      const frame = currentFrame + index
      if (frame < this.startFrame || frame >= this.endFrame) continue
      let sample = 0
      for (const channel of input) sample += channel[index] / input.length
      this.chunk[this.chunkLength++] = sample
      if (this.chunkLength === this.chunk.length) this.flush()
    }
    if (currentFrame + 128 >= this.endFrame) {
      this.flush()
      this.port.postMessage({ type: 'complete', frames: Math.max(0, this.endFrame - this.startFrame) })
      return false
    }
    return true
  }
}

registerProcessor('pcm-recorder', PcmRecorder)
