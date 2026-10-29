import { describe, expect, it } from 'vitest'
import { formatTime, getActiveLyricIndex, parseLrc } from '../src/audio/lyrics'

describe('歌词时间轴', () => {
  it('将多时间标签、元数据和提前量合并为顺序歌词，并随播放和跳转定位', () => {
    const lyrics = parseLrc(`[ti:山海]
[ar:清唱]
[offset:200]
[00:12.50][01:02.500]穿过山海
[00:01.20]等风来
[00:10.000]<00:10.00>晚风<00:10.40>轻轻
[00:15.00]
没有时间轴的备注`)
    expect(lyrics).toEqual([
      { time: 1, text: '等风来' },
      { time: 9.8, text: '晚风轻轻' },
      { time: 12.3, text: '穿过山海' },
      { time: 14.8, text: '' },
      { time: 62.3, text: '穿过山海' },
    ])
    expect(getActiveLyricIndex(lyrics, 0)).toBe(-1)
    expect(getActiveLyricIndex(lyrics, 1)).toBe(0)
    expect(getActiveLyricIndex(lyrics, 12.3)).toBe(2)
    expect(getActiveLyricIndex(lyrics, 10)).toBe(1)
    expect(getActiveLyricIndex(lyrics, 80)).toBe(4)
    expect(getActiveLyricIndex([], 80)).toBe(-1)
    expect(parseLrc('第一行\n第二行')).toEqual([])
    expect(formatTime(125.9)).toBe('2:05')
  })
})
