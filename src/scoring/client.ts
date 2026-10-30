import { MODEL_ID } from './constants'
import type { ScoringRequest, ScoringResponse } from './protocol'
import type { PitchFrame, RealtimeMetrics, ReferenceMelody } from './types'

export { MODEL_ID }
export type ScoringUpdate = { frames: PitchFrame[]; metrics: RealtimeMetrics | null }

export class PitchScoringClient {
  private worker = new Worker(new URL('./pitch.worker.ts', import.meta.url), { type: 'module' })
  private resolveReady!: () => void
  private rejectReady!: (reason: Error) => void
  private resolveComplete!: (result: ScoringUpdate) => void
  private rejectComplete!: (reason: Error) => void
  private pendingChunks = 0
  private failed = false
  private startupTimer = setTimeout(() => this.fail('CREPE 模型加载超过 15 秒，评分已停止；录音仍会保存。'), 15000)
  private finishTimer: ReturnType<typeof setTimeout> | undefined
  readonly ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
  private completed = new Promise<ScoringUpdate>((resolve, reject) => { this.resolveComplete = resolve; this.rejectComplete = reject })

  constructor(sampleRate: number, latencyMs: number, reference: ReferenceMelody | undefined, collectFrames: boolean,
    private onUpdate: (update: ScoringUpdate) => void, private onError: (message: string) => void) {
    // finish 之前失败也要有明确的拒绝处理，录音可继续保存。
    void this.completed.catch(() => {})
    this.worker.onmessage = ({ data }: MessageEvent<ScoringResponse>) => {
      if (data.type === 'ready') { clearTimeout(this.startupTimer); this.resolveReady() }
      else if (data.type === 'error') this.fail(data.message)
      else if (data.type === 'complete') { clearTimeout(this.finishTimer); this.resolveComplete(data) }
      else { this.pendingChunks--; this.onUpdate(data) }
    }
    this.worker.onerror = event => { event.preventDefault(); this.fail(event.message) }
    this.post({ type: 'initialize', sampleRate, latencyMs, reference, collectFrames, baseUrl: new URL(import.meta.env.BASE_URL, document.baseURI).href })
  }

  private post(message: ScoringRequest, transfer: Transferable[] = []): void { this.worker.postMessage(message, transfer) }

  push(samples: Float32Array): void {
    if (this.failed) return
    if (this.pendingChunks >= 128) { this.fail('实时音高推理跟不上录音，评分已停止；录音仍会保存。'); return }
    this.pendingChunks++
    this.post({ type: 'pcm', samples }, [samples.buffer as ArrayBuffer])
  }

  finish(timeoutMs = 3000): Promise<ScoringUpdate> {
    if (!this.failed) {
      this.finishTimer = setTimeout(() => this.fail('CREPE 分析未在规定时间内完成。'), timeoutMs)
      this.post({ type: 'finish' })
    }
    return this.completed
  }

  private fail(message: string): void {
    if (this.failed) return
    this.failed = true
    clearTimeout(this.startupTimer)
    clearTimeout(this.finishTimer)
    this.worker.terminate()
    const error = new Error(message)
    this.rejectReady(error)
    this.rejectComplete(error)
    this.onError(message)
  }

  dispose(): void {
    this.failed = true
    clearTimeout(this.startupTimer)
    clearTimeout(this.finishTimer)
    this.worker.terminate()
    const cancellation = new Error('实时分析已结束')
    this.rejectReady(cancellation)
    this.rejectComplete(cancellation)
  }
}
