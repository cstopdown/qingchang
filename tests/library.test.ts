import { readFile } from 'node:fs/promises'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test('曲库与录音完整持久化，刷新后保留收藏且不会恢复已删除演示曲', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  let resourcesUnavailable = true
  const fetchDemo = vi.fn(async (url: string) => {
    if (resourcesUnavailable) return new Response(null, { status: 503 })
    const filename = url.split('/').at(-1)
    const audio = await readFile(new URL(`../public/demos/${filename}`, import.meta.url))
    return new Response(audio, { headers: { 'Content-Type': 'audio/wav' } })
  })
  vi.stubGlobal('fetch', fetchDemo)
  const library = await import('../src/data/library')
  await expect(library.initializeLibrary()).rejects.toThrow('无法载入原创演示伴奏')
  resourcesUnavailable = false
  await Promise.all([library.initializeLibrary(), library.initializeLibrary(), library.listTracks()])
  const seeded = await library.listTracks()
  expect(seeded).toHaveLength(3)
  expect(fetchDemo).toHaveBeenCalledTimes(6)
  const favorite = { ...seeded[0], favorite: true }
  await library.saveTrack(favorite)
  await library.deleteTrack(seeded[1].id)
  const recording = {
    id: 'recording-one',
    trackId: favorite.id,
    trackTitle: favorite.title,
    title: '我的完整练唱',
    createdAt: Date.now(),
    duration: favorite.duration,
    audio: favorite.audio,
  }
  await library.saveRecording(recording)

  vi.resetModules()
  const refreshed = await import('../src/data/library')
  await refreshed.initializeLibrary()
  const tracks = await refreshed.listTracks()
  expect(tracks).toHaveLength(2)
  expect(tracks.find(track => track.id === favorite.id)?.favorite).toBe(true)
  expect(tracks.some(track => track.id === seeded[1].id)).toBe(false)
  expect(fetchDemo).toHaveBeenCalledTimes(6)
  const recordings = await refreshed.listRecordings()
  expect(recordings).toHaveLength(1)
  expect(recordings[0].title).toBe(recording.title)
  expect(await recordings[0].audio.arrayBuffer()).toEqual(await recording.audio.arrayBuffer())
  await refreshed.deleteRecording(recording.id)

  vi.resetModules()
  const reopened = await import('../src/data/library')
  expect(await reopened.listRecordings()).toEqual([])
  expect(await reopened.listTracks()).toHaveLength(2)
})
