import type { AiScoreReport } from '../ai/types'

export interface Track {
  id: string
  title: string
  artist: string
  duration: number
  cover: 'amber' | 'mint' | 'rose'
  origin: 'demo' | 'local' | 'url'
  audio: Blob
  lyrics: string
  createdAt: number
  favorite: boolean
}

export interface Recording {
  id: string
  trackId: string
  trackTitle: string
  title: string
  createdAt: number
  duration: number
  audio: Blob
  vocalAudio?: Blob
  aiScore?: AiScoreReport
}

export interface MixerSettings {
  musicVolume: number
  vocalVolume: number
  reverb: number
  monitoring: boolean
  lyricOffsetMs: number
  latencyMs: number
  vocalTone: VocalTone
}

export type VocalTone = 'natural' | 'warm' | 'bright' | 'radio'

export interface LyricLine {
  time: number
  text: string
}

export interface Pitch {
  frequency: number
  note: string
  cents: number
}

export type StudioStatus = 'empty' | 'ready' | 'playing' | 'recording' | 'finishing'
