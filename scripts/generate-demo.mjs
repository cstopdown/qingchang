import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// 直接合成原创和声与节奏；不使用任何外部录音、采样或歌曲旋律。
const sampleRate = 24_000
const outputDirectory = fileURLToPath(new URL('../public/demos/', import.meta.url))
const tau = Math.PI * 2
const songs = [
  { file: 'evening.wav', title: '晚风练习曲', bpm: 80, bars: 12, root: 48, chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, 2, 7, 9]], style: 'soft' },
  { file: 'planet.wav', title: '小小星球', bpm: 100, bars: 16, root: 50, chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], style: 'bright' },
  { file: 'sunny.wav', title: '晴天慢拍', bpm: 75, bars: 12, root: 53, chords: [[0, 4, 7, 9], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]], style: 'warm' },
]

function frequency(note) {
  return 440 * 2 ** ((note - 69) / 12)
}

function addNote(samples, start, duration, note, gain, voice) {
  const startIndex = Math.round(start * sampleRate)
  const length = Math.round(duration * sampleRate)
  const hz = frequency(note)
  for (let index = 0; index < length && startIndex + index < samples.length; index++) {
    const time = index / sampleRate
    const attack = Math.min(1, time / 0.012)
    const release = Math.min(1, (duration - time) / 0.08)
    const phase = tau * hz * time
    const body = voice === 'bass'
      ? Math.sin(phase) + 0.2 * Math.sin(phase * 2)
      : voice === 'soft'
        ? Math.sin(phase) + 0.18 * Math.sin(phase * 3)
        : voice === 'bright'
          ? Math.sin(phase) + 0.35 * Math.sin(phase * 2) + 0.12 * Math.sin(phase * 4)
          : Math.sin(phase) + 0.25 * Math.sin(phase * 2) + 0.1 * Math.sin(phase * 3)
    const decay = Math.exp(-time * (voice === 'bass' ? 3 : voice === 'bright' ? 5 : 2))
    samples[startIndex + index] += body * gain * attack * release * decay
  }
}

function addDrum(samples, start, kind, gain, seed) {
  const startIndex = Math.round(start * sampleRate)
  const duration = kind === 'kick' ? 0.24 : kind === 'snare' ? 0.12 : 0.055
  let random = seed >>> 0
  for (let index = 0; index < Math.round(duration * sampleRate) && startIndex + index < samples.length; index++) {
    const time = index / sampleRate
    random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0
    const noise = random / 2 ** 31 - 1
    const sound = kind === 'kick'
      ? Math.sin(tau * (48 * time + 2.5 * (1 - Math.exp(-time * 30)))) * Math.exp(-time * 22)
      : kind === 'snare'
        ? (noise * 0.7 + Math.sin(tau * 180 * time) * 0.3) * Math.exp(-time * 35)
        : noise * Math.exp(-time * 95) * Math.sin(tau * 6_000 * time)
    samples[startIndex + index] += sound * gain
  }
}

function createSong(song) {
  const beat = 60 / song.bpm
  const duration = song.bars * 4 * beat
  const samples = new Float64Array(Math.round(duration * sampleRate))
  for (let bar = 0; bar < song.bars; bar++) {
    const chord = song.chords[bar % song.chords.length]
    const barStart = bar * 4 * beat
    for (const interval of chord) addNote(samples, barStart, beat * 3.8, song.root + interval + 12, 0.07, song.style)
    for (let tick = 0; tick < 8; tick++) {
      const shuffle = song.style === 'warm' && tick % 2 === 1 ? beat * 0.09 : 0
      const time = barStart + tick * beat / 2 + shuffle
      const pitch = song.root + chord[tick % chord.length] + 24
      addNote(samples, time, beat * 0.85, pitch, song.style === 'bright' ? 0.1 : 0.055, song.style)
      addDrum(samples, time, 'hat', song.style === 'bright' ? 0.045 : 0.025, bar * 31 + tick + 1)
    }
    for (let tick = 0; tick < 4; tick++) {
      const time = barStart + tick * beat
      addNote(samples, time, beat * 0.9, song.root + chord[tick % 2 === 0 ? 0 : 2] - 12, 0.16, 'bass')
      addDrum(samples, time, tick % 2 === 0 ? 'kick' : 'snare', tick % 2 === 0 ? 0.18 : 0.07, 200 + bar * 4 + tick)
    }
  }
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  const pcm = Buffer.alloc(samples.length * 2)
  let energy = 0
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate
    const fade = Math.min(1, time / 0.08, (duration - time) / 0.8)
    const sample = samples[index] / peak * 0.82 * fade
    energy += sample * sample
    pcm.writeInt16LE(Math.round(sample * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return { audio: Buffer.concat([header, pcm]), duration, rms: Math.sqrt(energy / samples.length) }
}

await mkdir(outputDirectory, { recursive: true })
for (const song of songs) {
  const { audio, duration, rms } = createSong(song)
  await writeFile(new URL(`../public/demos/${song.file}`, import.meta.url), audio)
  console.log(`${song.title}：${duration.toFixed(1)} 秒，${sampleRate} Hz，RMS ${rms.toFixed(4)}，${audio.length} 字节`)
}
