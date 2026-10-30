import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { StudioEngine } from '../audio/StudioEngine'
import type { Recording } from '../core/types'
import { subscribeAppPause } from '../platform/bridge'

export function useStudio(onRecordingComplete: (recording: Recording) => Promise<void>) {
  const callback = useRef(onRecordingComplete)
  callback.current = onRecordingComplete
  const [engine] = useState(() => new StudioEngine((recording) => callback.current(recording)))
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  useEffect(() => {
    let active = true
    let unsubscribePause: (() => void) | undefined
    const hidden = () => {
      if (document.hidden) void engine.interrupt('应用进入后台，音频已中断')
    }
    document.addEventListener('visibilitychange', hidden)
    void subscribeAppPause(() => {
      if (active) void engine.interrupt('应用进入后台，音频已中断')
    }).then((unsubscribe) => {
      if (active) unsubscribePause = unsubscribe
      else unsubscribe()
    })
    return () => {
      active = false
      document.removeEventListener('visibilitychange', hidden)
      unsubscribePause?.()
      engine.dispose()
    }
  }, [engine])
  return {
    ...snapshot,
    selectTrack: engine.selectTrack,
    setReferenceMelody: engine.setReferenceMelody,
    togglePlayback: engine.togglePlayback,
    seek: engine.seek,
    startRecording: engine.startRecording,
    stopRecording: engine.stopRecording,
    interrupt: engine.interrupt,
    startPreview: engine.startPreview,
    stopPreview: engine.stopPreview,
    retrySaveRecording: engine.retrySaveRecording,
    discardPendingRecording: engine.discardPendingRecording,
    stop: engine.stop,
    updateSettings: engine.updateSettings,
    clearError: engine.clearError,
    clearNotice: engine.clearNotice,
  }
}
