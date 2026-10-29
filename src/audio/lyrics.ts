import type { LyricLine } from '../core/types'

/** LRC 的正 offset 表示歌词提前显示，时间统一转换为秒。 */
export function parseLrc(text: string): LyricLine[] {
  const offset = Number(text.match(/\[offset:\s*([+-]?\d+)\s*\]/i)?.[1] ?? 0) / 1000
  const lines: LyricLine[] = []
  for (const row of text.split(/\r?\n/)) {
    const timestamps = [...row.matchAll(/\[(\d{1,3}):([0-5]?\d(?:\.\d{1,3})?)\]/g)]
    const lyric = row
      .replace(/\[[^\]]*\]/g, '')
      .replace(/<\d+:\d+(?:\.\d+)?>/g, '')
      .trim()
    for (const timestamp of timestamps) {
      lines.push({ time: Math.max(0, Number(timestamp[1]) * 60 + Number(timestamp[2]) - offset), text: lyric })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

export function getActiveLyricIndex(lines: LyricLine[], seconds: number): number {
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (lines[middle].time <= seconds) low = middle + 1
    else high = middle
  }
  return low - 1
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
