import type { Recording, Track } from '../core/types'
import { DEMO_TRACKS } from './demos'

const DATABASE_NAME = 'qingchang-library'
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const AUDIO_EXTENSION = /\.(mp3|wav|wave|flac|ogg|opus|m4a|aac|aif|aiff|webm|mp4)$/i

let databasePromise: Promise<IDBDatabase> | undefined
let initializationPromise: Promise<void> | undefined

function database(): Promise<IDBDatabase> {
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('tracks', { keyPath: 'id' })
      request.result.createObjectStore('recordings', { keyPath: 'id' })
      request.result.createObjectStore('meta', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error: unknown) => {
    databasePromise = undefined
    throw error
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new DOMException('存储事务已取消。', 'AbortError'))
  })
}

async function seedLibrary(): Promise<void> {
  const db = await database()
  const check = db.transaction('meta', 'readonly')
  const [initialized] = await Promise.all([
    requestResult(check.objectStore('meta').get('initialized')),
    transactionDone(check),
  ])
  if (initialized) return

  const now = Date.now()
  const tracks = await Promise.all(DEMO_TRACKS.map(async (demo, index): Promise<Track> => {
    const response = await fetch(`${import.meta.env.BASE_URL}demos/${demo.file}`)
    if (!response.ok) throw new Error(`无法载入原创演示伴奏：${demo.title}`)
    const audio = await response.blob()
    return {
      id: demo.id,
      title: demo.title,
      artist: '轻唱原创 · 练唱示范',
      duration: demo.duration,
      cover: demo.cover,
      origin: 'demo',
      audio,
      lyrics: demo.lyrics,
      createdAt: now - index,
      favorite: false,
    }
  }))

  // 检查和写入处于同一事务，防止多个窗口同时首次启动时覆盖用户操作。
  const transaction = db.transaction(['tracks', 'meta'], 'readwrite')
  const completed = transactionDone(transaction)
  const marker = transaction.objectStore('meta').get('initialized')
  marker.onsuccess = () => {
    if (marker.result) return
    for (const track of tracks) transaction.objectStore('tracks').put(track)
    transaction.objectStore('meta').put({ id: 'initialized', createdAt: now })
  }
  await completed
}

export function initializeLibrary(): Promise<void> {
  initializationPromise ??= seedLibrary().catch((error: unknown) => {
    initializationPromise = undefined
    throw error
  })
  return initializationPromise
}

async function readAll<T>(store: 'tracks' | 'recordings'): Promise<T[]> {
  await initializeLibrary()
  const transaction = (await database()).transaction(store, 'readonly')
  const [items] = await Promise.all([
    requestResult<T[]>(transaction.objectStore(store).getAll()),
    transactionDone(transaction),
  ])
  return items
}

async function write(store: 'tracks' | 'recordings', value: Track | Recording): Promise<void> {
  await initializeLibrary()
  const transaction = (await database()).transaction(store, 'readwrite')
  const completed = transactionDone(transaction)
  transaction.objectStore(store).put(value)
  await completed
}

async function remove(store: 'tracks' | 'recordings', id: string): Promise<void> {
  await initializeLibrary()
  const transaction = (await database()).transaction(store, 'readwrite')
  const completed = transactionDone(transaction)
  transaction.objectStore(store).delete(id)
  await completed
}

export async function listTracks(): Promise<Track[]> {
  return (await readAll<Track>('tracks')).sort((a, b) => b.createdAt - a.createdAt)
}

export function saveTrack(track: Track): Promise<void> {
  return write('tracks', track)
}

export function deleteTrack(id: string): Promise<void> {
  return remove('tracks', id)
}

export async function listRecordings(): Promise<Recording[]> {
  return (await readAll<Recording>('recordings')).sort((a, b) => b.createdAt - a.createdAt)
}

export function saveRecording(recording: Recording): Promise<void> {
  return write('recordings', recording)
}

export function deleteRecording(id: string): Promise<void> {
  return remove('recordings', id)
}

function checkAudioSize(audio: Blob): void {
  if (audio.size === 0) throw new Error('音频文件为空，请选择有内容的音频。')
  if (audio.size > MAX_AUDIO_BYTES) throw new Error('单首音频请控制在 100 MB 以内。')
}

async function decodeDuration(audio: Blob): Promise<number> {
  const context = new AudioContext()
  try {
    const buffer = await context.decodeAudioData(await audio.arrayBuffer())
    return buffer.duration
  } catch (error) {
    throw new Error('无法解码这个音频，请使用当前设备支持的 MP3、WAV、M4A 等音频格式。', { cause: error })
  } finally {
    await context.close()
  }
}

export async function importTrack(file: File, lyrics = ''): Promise<Track> {
  if (!file.type.startsWith('audio/') && !AUDIO_EXTENSION.test(file.name)) {
    throw new Error('请选择 MP3、WAV、M4A、FLAC、OGG 等常见音频文件。')
  }
  checkAudioSize(file)
  const duration = await decodeDuration(file)
  const track: Track = {
    id: crypto.randomUUID(),
    title: file.name.replace(/\.[^.]+$/, ''),
    artist: '本地导入',
    duration,
    cover: 'mint',
    origin: 'local',
    audio: file,
    lyrics,
    createdAt: Date.now(),
    favorite: false,
  }
  await saveTrack(track)
  return track
}

async function readAudioResponse(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`)
  if (!response.body) throw new Error('链接没有返回音频内容')
  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel()
        throw new Error('单首音频请控制在 100 MB 以内')
      }
      chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer)
    }
  } finally {
    reader.releaseLock()
  }
  if (size === 0) throw new Error('链接没有返回音频内容')
  return new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' })
}

export async function importTrackFromUrl(url: string, title: string, lyrics = ''): Promise<Track> {
  const address = new URL(url)
  if (!['https:', 'http:'].includes(address.protocol)) throw new Error('音频直链只支持 HTTP 或 HTTPS 地址。')
  if (title.trim().length === 0) throw new Error('请填写这首歌曲的名称。')
  const audio = await fetch(address, { mode: 'cors', credentials: 'omit' })
    .then(readAudioResponse)
    .catch((error: unknown) => {
      throw new Error('无法读取音频直链，可能存在网络或跨域限制。请先在浏览器下载，再从本地导入。', { cause: error })
    })
  const duration = await decodeDuration(audio)
  const track: Track = {
    id: crypto.randomUUID(),
    title: title.trim(),
    artist: '直链导入',
    duration,
    cover: 'rose',
    origin: 'url',
    audio,
    lyrics,
    createdAt: Date.now(),
    favorite: false,
  }
  await saveTrack(track)
  return track
}
