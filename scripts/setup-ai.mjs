import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { aiHome, emit, initializeHome, localUvPaths, python, root, run, writeInstalledMarker } from '../ai_service/runtime.mjs'

const UV_VERSION = '0.11.28'

async function executable(candidate) {
  try { await access(candidate, constants.X_OK); return true }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return false
    throw error
  }
}

async function findUv() {
  for (const candidate of localUvPaths) if (await executable(candidate)) return candidate
  emit('progress', 'runtime', '从官方发行版安装项目专用 uv')
  const tools = path.join(aiHome, 'tools')
  await mkdir(tools, { recursive: true })
  const name = 'uv-aarch64-apple-darwin.tar.gz'
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${name}`
  const [archiveResponse, hashResponse] = await Promise.all([fetch(url), fetch(`${url}.sha256`)])
  if (!archiveResponse.ok || !hashResponse.ok) throw new Error('无法下载官方 uv 运行时，请检查网络后重试。')
  const archive = Buffer.from(await archiveResponse.arrayBuffer())
  const expected = (await hashResponse.text()).trim().split(/\s+/)[0]
  if (createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('官方 uv 运行时校验失败。')
  const archivePath = path.join(tools, name)
  await writeFile(archivePath, archive)
  await run('/usr/bin/tar', ['-xzf', archivePath, '-C', tools, '--strip-components=1'])
  return path.join(tools, 'uv')
}

try {
  await initializeHome()
  const uv = await findUv()
  if (!await executable(python)) {
    emit('progress', 'environment', '创建项目独立 Python 3.12 环境')
    const existingPython = path.join(homedir(), '.local', 'share', 'uv', 'python', 'cpython-3.12-macos-aarch64-none', 'bin', 'python3.12')
    await run(uv, ['venv', '--python', await executable(existingPython) ? existingPython : '3.12.13', path.join(aiHome, 'venv')])
  }
  emit('progress', 'dependencies', '安装已锁定版本并校验依赖哈希')
  await run(uv, ['pip', 'install', '--python', python, '--require-hashes', '-r', path.join(root, 'ai_service', 'requirements.txt')])
  emit('progress', 'model', '下载并验证固定版本 MiniCPM-o 4.5 音频模型')
  await run(python, [path.join(root, 'ai_service', 'download.py')], { protocol: true })
  const verified = JSON.parse(await readFile(path.join(aiHome, 'model-verified.json'), 'utf8'))
  await writeInstalledMarker()
  emit('ready', 'setup', '本机 AI 环境已安装，可启动评分服务', { modelRevision: verified.revision })
} catch (error) {
  emit('error', 'setup', error.message)
  process.exitCode = 1
}
