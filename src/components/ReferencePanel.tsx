import { useState } from 'react'
import type { Track } from '../core/types'
import type { ReferenceMelody, RealtimeAnalysis, RealtimeMetrics } from '../scoring/types'
import { extractReferenceMelody, parseReferenceMelodyJSON } from '../scoring/reference'

export function Metrics({ metrics }: { metrics: RealtimeMetrics }) {
  return <p>平均音准误差：{metrics.meanAbsoluteCents === null ? '—' : `${metrics.meanAbsoluteCents.toFixed(1)} cent`} · ±50 cent 命中率：{metrics.within50CentsRatio === null ? '—' : `${(metrics.within50CentsRatio * 100).toFixed(1)}%`} · 节奏偏移：{metrics.timingOffsetMs === null ? '—' : `${metrics.timingOffsetMs.toFixed(0)} ms`} · 覆盖率：{(metrics.coverageRatio * 100).toFixed(1)}%</p>
}
export function ReferencePanel({ track, realtime, disabled, onChange }: { track: Track; realtime: RealtimeAnalysis; disabled: boolean; onChange: (reference: ReferenceMelody | undefined) => Promise<void> }) {
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async (file: File, kind: 'vocal' | 'json') => {
    setBusy(true); setError('')
    try { await onChange(kind === 'vocal' ? await extractReferenceMelody(file, track.title, track.referenceMelody?.offsetSeconds ?? offset) : parseReferenceMelodyJSON(await file.text())) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="settings-card reference-panel">
    <h2>参考旋律与实时练唱</h2>
    <p>{track.referenceMelody ? `已绑定：${track.referenceMelody.title}` : '未绑定参考旋律，只显示音高。'}</p>
    <p>CREPE：{({idle:'未启动',loading:'加载中',ready:'就绪',error:'失败'})[realtime.modelStatus]} · 当前音高：{realtime.pitch?.frequencyHz ? `${realtime.pitch.frequencyHz.toFixed(1)} Hz` : '—'}</p>
    {realtime.error && <p role="alert">{realtime.error}；录音仍可保存。</p>}
    {realtime.metrics && <Metrics metrics={realtime.metrics} />}
    <label>参考起点偏移（秒） <input type="number" step="0.05" value={track.referenceMelody?.offsetSeconds ?? offset} disabled={disabled || busy} onChange={e => { const value = Number(e.target.value); setOffset(value); if (track.referenceMelody) void onChange({...track.referenceMelody, offsetSeconds: value}) }} /></label>
    <p><label>绑定参考人声 <input type="file" accept="audio/*" disabled={disabled || busy} onChange={e => { const file = e.target.files?.[0]; if (file) void load(file, 'vocal'); e.target.value = '' }} /></label></p>
    <p><label>导入音高 JSON <input type="file" accept="application/json,.json" disabled={disabled || busy} onChange={e => { const file = e.target.files?.[0]; if (file) void load(file, 'json'); e.target.value = '' }} /></label></p>
    {busy && <p>正在提取参考旋律…</p>}{error && <p role="alert">{error}</p>}
    {track.referenceMelody && <button disabled={disabled || busy} onClick={() => void onChange(undefined)}>清除参考</button>}
  </section>
}
