export interface PitchFrame {
  timeSeconds: number
  frequencyHz: number | null
  confidence: number
}

export interface ReferenceMelody {
  id: string
  title: string
  offsetSeconds: number
  hopSeconds: 0.05
  frames: PitchFrame[]
  source:
    | { kind: 'vocal'; audio: Blob; modelId: string }
    | { kind: 'f0-json' }
}

export interface RealtimeMetrics {
  referenceId: string
  comparedFrames: number
  expectedVoicedFrames: number
  matchedVoicedFrames: number
  meanAbsoluteCents: number | null
  within50CentsRatio: number | null
  timingOffsetMs: number | null
  coverageRatio: number
}

export interface RealtimeAnalysis {
  modelStatus: 'idle' | 'loading' | 'ready' | 'error'
  modelId: string
  pitch: PitchFrame | null
  metrics: RealtimeMetrics | null
  error: string | null
}

export interface RealtimeScore {
  metrics: RealtimeMetrics
  modelId: string
  referenceId: string
  referenceTitle: string
  latencyMs: number
}
