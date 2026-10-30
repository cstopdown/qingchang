import * as tf from '@tensorflow/tfjs-core'
import { loadLayersModel, type LayersModel } from '@tensorflow/tfjs-layers'
import { setWasmPaths, setThreadsCount } from '@tensorflow/tfjs-backend-wasm'
import type { PitchFrame } from './types'

export { MODEL_ID, HOP_SECONDS } from './constants'

export async function initializeCrepe(wasmPath: string, source: string | tf.io.IOHandler): Promise<CrepeModel> {
  setWasmPaths(wasmPath)
  setThreadsCount(1)
  if (!await tf.setBackend('wasm')) throw new Error('CREPE 的 WASM 推理后端无法启动')
  await tf.ready()
  return new CrepeModel(await loadLayersModel(source))
}

export class CrepeModel {
  constructor(private model: LayersModel) {}

  async predict(samples: Float32Array, timeSeconds: number): Promise<PitchFrame> {
    let energy = 0
    let mean = 0
    for (const value of samples) { energy += value * value; mean += value }
    if (Math.sqrt(energy / samples.length) < 0.008) return { timeSeconds, frequencyHz: null, confidence: 0 }
    mean /= samples.length
    let variance = 0
    for (const value of samples) variance += (value - mean) ** 2
    const deviation = Math.max(Math.sqrt(variance / samples.length), 1e-8)
    const normalized = Float32Array.from(samples, value => (value - mean) / deviation)
    const activation = tf.tidy(() => this.model.predict(tf.tensor2d(normalized, [1, 1024])) as tf.Tensor)
    const values = await activation.data()
    activation.dispose()
    let center = 0
    for (let index = 1; index < values.length; index++) if (values[index] > values[center]) center = index
    const confidence = values[center]
    let weight = 0
    let cents = 0
    for (let index = Math.max(0, center - 4); index < Math.min(360, center + 5); index++) {
      weight += values[index]
      cents += values[index] * (1997.3794084376191 + 20 * index)
    }
    return { timeSeconds, frequencyHz: confidence >= 0.5 ? 10 * 2 ** (cents / weight / 1200) : null, confidence }
  }

  dispose(): void { this.model.dispose() }
}
