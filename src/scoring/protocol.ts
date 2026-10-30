import type { PitchFrame, RealtimeMetrics, ReferenceMelody } from './types'
export type ScoringRequest =
  | { type: 'initialize'; baseUrl: string; sampleRate: number; latencyMs: number; reference: ReferenceMelody | undefined; collectFrames: boolean }
  | { type: 'pcm'; samples: Float32Array }
  | { type: 'finish' }
export type ScoringResponse =
  | { type: 'ready' }
  | { type: 'frames'; frames: PitchFrame[]; metrics: RealtimeMetrics | null }
  | { type: 'complete'; frames: PitchFrame[]; metrics: RealtimeMetrics | null }
  | { type: 'error'; message: string }
