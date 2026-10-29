import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { StudioEngine } from '../audio/StudioEngine'
import type { Recording } from '../core/types'

export function useStudio(onRecordingComplete: (recording: Recording) => Promise<void>) {
  const callback = useRef(onRecordingComplete)
  callback.current = onRecordingComplete
  const [engine] = useState(() => new StudioEngine((recording) => callback.current(recording)))
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  useEffect(() => () => engine.dispose(), [engine])
  return {
    ...snapshot,
    selectTrack: engine.selectTrack,
    togglePlayback: engine.togglePlayback,
    seek: engine.seek,
    startRecording: engine.startRecording,
    stopRecording: engine.stopRecording,
    startPreview: engine.startPreview,
    stopPreview: engine.stopPreview,
    retrySaveRecording: engine.retrySaveRecording,
    discardPendingRecording: engine.discardPendingRecording,
    stop: engine.stop,
    updateSettings: engine.updateSettings,
    clearError: engine.clearError,
  }
}
