/** 独立 PCM16 单声道夹具，避免用生产编码器生成它自己的测试输入。 */
export function makeToneWav(seconds: number, sampleRate = 24000, frequency = 220, amplitude = 0.1): Buffer {
  const frames = Math.round(sampleRate * seconds)
  const bytes = Buffer.alloc(44 + frames * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(frames * 2, 40)
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * frequency * frame / sampleRate)), 44 + frame * 2)
  }
  return bytes
}
