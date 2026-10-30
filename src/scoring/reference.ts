import { createId } from '../core/id'
import { PitchScoringClient, MODEL_ID } from './client'
import type { PitchFrame, ReferenceMelody } from './types'

/** 参考 JSON 文件是外部输入：一次解析为固定 50ms 时间网格。 */
export function parseReferenceMelodyJSON(text: string): ReferenceMelody {
  const data = JSON.parse(text) as Record<string, unknown>
  if (data === null || typeof data !== 'object' || data.version !== 1 || typeof data.title !== 'string' || !data.title.trim()
    || typeof data.offsetSeconds !== 'number' || !Number.isFinite(data.offsetSeconds) || data.hopSeconds !== 0.05
    || !Array.isArray(data.frames) || data.frames.length === 0) throw new Error('参考旋律须为 version:1、50ms 网格的音高 JSON。')
  const frames: PitchFrame[] = data.frames.map((value: unknown, index: number) => {
    if (value === null || typeof value !== 'object') throw new Error('参考旋律的音高帧格式错误。')
    const frame = value as Record<string, unknown>
    if (typeof frame.timeSeconds !== 'number' || !Number.isFinite(frame.timeSeconds) || Math.abs(frame.timeSeconds - index * 0.05) > 1e-6
      || !(frame.frequencyHz === null || (typeof frame.frequencyHz === 'number' && Number.isFinite(frame.frequencyHz) && frame.frequencyHz >= 32 && frame.frequencyHz <= 2006))
      || typeof frame.confidence !== 'number' || !Number.isFinite(frame.confidence) || frame.confidence < 0 || frame.confidence > 1) {
      throw new Error(`参考旋律第 ${index + 1} 帧须含连续时间、32–2006Hz 或 null，以及 0–1 置信度。`)
    }
    return { timeSeconds: frame.timeSeconds, frequencyHz: frame.frequencyHz as number | null, confidence: frame.confidence }
  })
  return { id: createId(), title: data.title.trim(), offsetSeconds: data.offsetSeconds, hopSeconds: 0.05, frames, source: { kind: 'f0-json' } }
}

export async function extractReferenceMelody(audio: Blob, title: string, offsetSeconds: number): Promise<ReferenceMelody> {
  if (audio.size === 0 || audio.size > 100 * 1024 * 1024) throw new Error('参考干声须为有内容且不超过 100 MB 的音频。')
  if (!title.trim() || !Number.isFinite(offsetSeconds)) throw new Error('请填写参考名称和有效的起点偏移。')
  const context = new AudioContext()
  let buffer: AudioBuffer
  try { buffer = await context.decodeAudioData(await audio.arrayBuffer()) }
  finally { await context.close() }
  const mono = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let index = 0; index < mono.length; index++) mono[index] += samples[index] / buffer.numberOfChannels
  }
  const client = new PitchScoringClient(buffer.sampleRate, 0, undefined, true, () => {}, () => {})
  try {
    await client.ready
    client.push(mono)
    const { frames } = await client.finish(Math.max(30000, buffer.duration * 1000))
    return { id: createId(), title: title.trim(), offsetSeconds, hopSeconds: 0.05, frames, source: { kind: 'vocal', audio, modelId: MODEL_ID } }
  } finally { client.dispose() }
}
