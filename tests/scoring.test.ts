import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as tf from '@tensorflow/tfjs-core'
import { expect, test } from 'vitest'
import { initializeCrepe } from '../src/scoring/crepe'
import { PitchWindows } from '../src/scoring/frames'
import { OnlineAlignment } from '../src/scoring/alignment'
import type { PitchFrame, ReferenceMelody } from '../src/scoring/types'

test('官方 CREPE WASM 从不同采样率和分块的连续 PCM 还原旋律与静音', async () => {
  const root = new URL('../public/crepe-tiny/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('model.json', root), 'utf8'))
  const weights = Buffer.concat(await Promise.all(manifest.weightsManifest.flatMap((group: { paths: string[] }) => group.paths.map(path => readFile(new URL(path, root))))))
  const model = await initializeCrepe(fileURLToPath(new URL('../public/tfjs-wasm/', import.meta.url)), tf.io.fromMemory({
    modelTopology: manifest.modelTopology, weightSpecs: manifest.weightsManifest.flatMap((group: { weights: unknown[] }) => group.weights),
    weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
  }))
  try {
    for (const sampleRate of [44100, 48000]) {
      const pcm = Float32Array.from({ length: sampleRate * 2 }, (_, index) => {
        const time = index / sampleRate
        if (time >= 1.5) return 0
        const hz = time < 0.75 ? 220 : 440
        return 0.2 * Math.sin(2 * Math.PI * hz * time) + 0.06 * Math.sin(4 * Math.PI * hz * time)
      })
      const runs: PitchFrame[][] = []
      for (const chunkSize of [4096, 937]) {
        const windows = new PitchWindows(sampleRate)
        const frames = []
        for (let start = 0; start < pcm.length; start += chunkSize) frames.push(...windows.push(pcm.slice(start, start + chunkSize)))
        frames.push(...windows.finish())
        const predictions: PitchFrame[] = []
        for (const frame of frames) predictions.push(await model.predict(frame.samples, frame.timeSeconds))
        expect(predictions).toHaveLength(40)
        for (const pitch of predictions) {
          if (pitch.timeSeconds >= 0.1 && pitch.timeSeconds < 0.7) expect(Math.abs(1200 * Math.log2(pitch.frequencyHz! / 220))).toBeLessThan(15)
          if (pitch.timeSeconds >= 0.85 && pitch.timeSeconds < 1.45) expect(Math.abs(1200 * Math.log2(pitch.frequencyHz! / 440))).toBeLessThan(15)
          if (pitch.timeSeconds >= 1.6) expect(pitch.frequencyHz).toBeNull()
        }
        runs.push(predictions)
      }
      expect(runs[0]).toEqual(runs[1])
    }
  } finally { model.dispose() }
}, 20000)

test('在线 DTW 区分同旋律、半音偏移、200ms 错拍与漏唱且无声不造准确率', () => {
  const frames: PitchFrame[] = Array.from({ length: 160 }, (_, index) => ({
    timeSeconds: index * 0.05,
    frequencyHz: index < 20 || index >= 140 ? null : 220 * 2 ** ([0, 4, 7, 2, 9, 5][Math.floor((index - 20) / 20)] / 12),
    confidence: index < 20 || index >= 140 ? 0 : 1,
  }))
  const reference: ReferenceMelody = { id: 'numerical', title: '数值旋律', offsetSeconds: 0, hopSeconds: 0.05, frames, source: { kind: 'f0-json' } }
  const compare = (transform: (frame: PitchFrame, index: number) => PitchFrame) => {
    const alignment = new OnlineAlignment(reference)
    let result
    frames.forEach((frame, index) => { result = alignment.push(transform(frame, index)) })
    return result!
  }
  const same = compare(frame => frame)
  expect(same.meanAbsoluteCents).toBe(0)
  expect(same.within50CentsRatio).toBe(1)
  expect(same.coverageRatio).toBe(1)
  expect(same.timingOffsetMs).toBeCloseTo(0, 5)
  const semitone = compare(frame => ({ ...frame, frequencyHz: frame.frequencyHz === null ? null : frame.frequencyHz * 2 ** (1 / 12) }))
  expect(semitone.meanAbsoluteCents).toBeCloseTo(100, 5)
  expect(semitone.within50CentsRatio).toBe(0)
  const delayed = compare((frame, index) => ({ ...frame, frequencyHz: index < 4 ? null : frames[index - 4].frequencyHz }))
  expect(delayed.meanAbsoluteCents!).toBeLessThan(30)
  expect(delayed.timingOffsetMs!).toBeGreaterThan(130)
  expect(delayed.timingOffsetMs!).toBeLessThan(250)
  const missing = compare((frame, index) => ({ ...frame, frequencyHz: index >= 60 && index < 100 ? null : frame.frequencyHz }))
  expect(missing.coverageRatio).toBeLessThan(0.8)

  // 首窗时刻包含 ±500ms 设备校正，参考也可能从伴奏之前开始。
  // 比较范围从实际可采集的参考位置开始，裁掉的起点不能被算作漏唱。
  for (const offsetSeconds of [-1.25, 0, 0.75]) {
    for (const latencyMs of [-500, 500]) {
      const shiftedReference = { ...reference, offsetSeconds }
      const alignment = new OnlineAlignment(shiftedReference)
      let result
      let firstReferenceIndex = -1
      let lastReferenceIndex = -1
      for (let index = 0; index < frames.length; index++) {
        const timeSeconds = index * 0.05 - latencyMs / 1000
        const referenceIndex = Math.round((timeSeconds - offsetSeconds) / 0.05)
        const frequencyHz = referenceIndex >= 0 && referenceIndex < frames.length ? frames[referenceIndex].frequencyHz : null
        if (referenceIndex >= 0 && referenceIndex < frames.length) {
          if (firstReferenceIndex === -1) firstReferenceIndex = referenceIndex
          lastReferenceIndex = referenceIndex
        }
        result = alignment.push({ timeSeconds, frequencyHz, confidence: frequencyHz === null ? 0 : 1 })
      }
      const expected = frames.slice(firstReferenceIndex, lastReferenceIndex + 1).filter(frame => frame.frequencyHz !== null).length
      expect(result!.expectedVoicedFrames).toBe(expected)
      expect(result!.matchedVoicedFrames).toBe(expected)
      expect(result!.meanAbsoluteCents).toBe(0)
      expect(result!.within50CentsRatio).toBe(1)
      expect(result!.coverageRatio).toBe(1)
      expect(result!.timingOffsetMs).toBeCloseTo(0, 5)
    }
  }

  const silence = compare(frame => ({ ...frame, frequencyHz: null, confidence: 0 }))
  expect(silence.meanAbsoluteCents).toBeNull()
  expect(silence.within50CentsRatio).toBeNull()
  expect(silence.coverageRatio).toBe(0)
})
