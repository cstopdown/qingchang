import type { PitchFrame, RealtimeMetrics, ReferenceMelody } from './types'

type Cell = { cost: number; compared: number; matched: number; cents: number; inTune: number; timing: number }
const origin: Cell = { cost: 0, compared: 0, matched: 0, cents: 0, inTune: 0, timing: 0 }

/** 固定歌曲起点的增量 DTW；两行有限带宽状态，不存全曲距离矩阵。 */
export class OnlineAlignment {
  private previous = new Map<number, Cell>()
  private beforePrevious = new Map<number, Cell>()
  private voicedPrefix: number[] = [0]
  private latest: RealtimeMetrics
  private firstReferenceIndex = -1

  constructor(private reference: ReferenceMelody) {
    for (const frame of reference.frames) this.voicedPrefix.push(this.voicedPrefix.at(-1)! + Number(frame.frequencyHz !== null))
    this.latest = this.metrics(origin, 0)
  }

  push(frame: PitchFrame): RealtimeMetrics {
    const next = new Map<number, Cell>()
    const relativeTime = frame.timeSeconds - this.reference.offsetSeconds
    if (relativeTime < -1e-6) return this.latest
    const center = Math.round(relativeTime / this.reference.hopSeconds)
    // 录音首窗已包含固定延迟校正；只在首个进入参考时间范围的窗建立一次入口。
    // 即使该窗无声也建立入口，漏唱仍须计入覆盖率。
    if (this.firstReferenceIndex === -1) {
      this.firstReferenceIndex = Math.min(this.reference.frames.length, center)
      this.previous.set(this.firstReferenceIndex - 1, origin)
    }
    const start = Math.max(0, center - 8)
    const end = Math.min(this.reference.frames.length - 1, center + 8)
    for (let index = start; index <= end; index++) {
      const ref = this.reference.frames[index]
      const timeDelta = frame.timeSeconds - (ref.timeSeconds + this.reference.offsetSeconds)
      if (Math.abs(timeDelta) > 0.400001) continue
      const bothVoiced = frame.frequencyHz !== null && ref.frequencyHz !== null
      const cents = bothVoiced ? 1200 * Math.log2(frame.frequencyHz! / ref.frequencyHz!) : 0
      const pitchCost = bothVoiced ? Math.min(Math.abs(cents) / 100, 12) : frame.frequencyHz === ref.frequencyHz ? 0 : 3
      const candidates = [
        { cell: this.previous.get(index - 1), penalty: 0 },
        { cell: this.previous.get(index - 2), penalty: 2 },
        { cell: this.beforePrevious.get(index - 1), penalty: 2 },
      ]
      let best: Cell | undefined
      for (const { cell, penalty } of candidates) {
        if (!cell) continue // 带宽外的 DP 状态不可达。
        const cost = cell.cost + pitchCost + 0.15 * Math.abs(timeDelta) / 0.05 + penalty
        if (best && best.cost <= cost) continue
        best = {
          cost, compared: cell.compared + Number(bothVoiced), matched: cell.matched + Number(bothVoiced),
          cents: cell.cents + Math.abs(cents), inTune: cell.inTune + Number(bothVoiced && Math.abs(cents) <= 50),
          timing: cell.timing + (bothVoiced ? timeDelta * 1000 : 0),
        }
      }
      if (best) next.set(index, best)
    }
    // 参考起点之前只显示音高，起点后的带宽内从固定首帧建立路径。
    if (next.size === 0) {
      // 到达参考末尾后保留最终结果；连续网格内的不可达状态属于算法错误。
      if (relativeTime > this.reference.frames.at(-1)!.timeSeconds) return this.latest
      throw new Error('在线 DTW 时间网格内没有可达路径')
    }
    let bestIndex = -1
    let best!: Cell
    for (const [index, cell] of next) {
      if (bestIndex === -1 || cell.cost < best.cost) { bestIndex = index; best = cell }
    }
    this.beforePrevious = this.previous
    this.previous = next
    const expectedThrough = Math.max(relativeTime, this.reference.frames[bestIndex].timeSeconds)
    const expectedIndex = Math.min(this.reference.frames.length, Math.max(0, Math.floor(expectedThrough / 0.05 + 1e-6) + 1))
    this.latest = this.metrics(best, this.voicedPrefix[expectedIndex] - this.voicedPrefix[this.firstReferenceIndex])
    return this.latest
  }

  private metrics(cell: Cell, expected: number): RealtimeMetrics {
    return {
      referenceId: this.reference.id, comparedFrames: cell.compared, expectedVoicedFrames: expected,
      matchedVoicedFrames: cell.matched,
      meanAbsoluteCents: cell.compared === 0 ? null : cell.cents / cell.compared,
      within50CentsRatio: cell.compared === 0 ? null : cell.inTune / cell.compared,
      timingOffsetMs: cell.compared === 0 ? null : cell.timing / cell.compared,
      coverageRatio: expected === 0 ? 0 : cell.matched / expected,
    }
  }
}
