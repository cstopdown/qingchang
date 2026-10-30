import { initializeCrepe, type CrepeModel } from './crepe'
import { PitchWindows } from './frames'
import { OnlineAlignment } from './alignment'
import type { ScoringRequest, ScoringResponse } from './protocol'
import type { PitchFrame, RealtimeMetrics } from './types'

const scope = self as unknown as { onmessage: (event: MessageEvent<ScoringRequest>) => void; postMessage: (message: ScoringResponse) => void }
let model: CrepeModel
let windows: PitchWindows
let alignment: OnlineAlignment | null = null
let latencySeconds = 0
let collected: PitchFrame[] | null = null
let metrics: RealtimeMetrics | null = null
let queue = Promise.resolve()

async function predict(frames: ReturnType<PitchWindows['push']>): Promise<PitchFrame[]> {
  const result: PitchFrame[] = []
  for (const frame of frames) {
    const pitch = await model.predict(frame.samples, frame.timeSeconds - latencySeconds)
    result.push(pitch)
    collected?.push(pitch)
    if (alignment) metrics = alignment.push(pitch)
  }
  return result
}

async function receive(data: ScoringRequest): Promise<void> {
  if (data.type === 'initialize') {
    model = await initializeCrepe(`${data.baseUrl}tfjs-wasm/`, `${data.baseUrl}crepe-tiny/model.json`)
    windows = new PitchWindows(data.sampleRate)
    alignment = data.reference ? new OnlineAlignment(data.reference) : null
    latencySeconds = data.latencyMs / 1000
    collected = data.collectFrames ? [] : null
    await model.predict(Float32Array.from({ length: 1024 }, (_, index) => 0.2 * Math.sin(2 * Math.PI * 440 * index / 16000)), 0)
    scope.postMessage({ type: 'ready' })
  } else if (data.type === 'pcm') {
    const frames = await predict(windows.push(data.samples))
    scope.postMessage({ type: 'frames', frames, metrics })
  } else {
    await predict(windows.finish())
    scope.postMessage({ type: 'complete', frames: collected ?? [], metrics })
  }
}

scope.onmessage = ({ data }) => {
  queue = queue.then(() => receive(data)).catch((error: unknown) => {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  })
}
