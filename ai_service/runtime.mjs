import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const aiHome = path.resolve(process.env.QINGCHANG_AI_HOME ?? path.join(root, '.tools', 'ai'))
export const python = path.join(aiHome, 'venv', 'bin', 'python')
export const environment = {
  ...process.env,
  QINGCHANG_AI_HOME: aiHome,
  HF_HOME: path.join(aiHome, 'cache', 'huggingface'),
  UV_CACHE_DIR: path.join(aiHome, 'cache', 'uv'),
  UV_PYTHON_INSTALL_DIR: path.join(aiHome, 'python'),
  PYTHONDONTWRITEBYTECODE: '1',
  PYTHONUNBUFFERED: '1',
}

export function emit(event, stage, message, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, stage, message, ...fields })}\n`)
}

export async function initializeHome() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('本机 MiniCPM 服务需要 Apple Silicon Mac；其他设备可连接个人 Mac 评分服务。')
  }
  await mkdir(aiHome, { recursive: true })
}

export async function writeInstalledMarker() {
  await access(python, constants.X_OK)
  const manifest = JSON.parse(await readFile(path.join(root, 'ai_service', 'model-manifest.json'), 'utf8'))
  const verified = JSON.parse(await readFile(path.join(aiHome, 'model-verified.json'), 'utf8'))
  if (verified.modelId !== manifest.modelId || verified.revision !== manifest.revision) throw new Error('模型版本校验记录不一致。')
  const hashes = new Map(verified.files.map(file => [file.file, file.sha256]))
  for (const [name, hash] of Object.entries(manifest.weightHashes)) {
    if (hashes.get(name) !== hash) throw new Error('模型权重哈希校验记录不一致。')
  }
  for (const name of manifest.files) await access(path.join(aiHome, 'models', 'MiniCPM-o-4_5-4bit', name), constants.R_OK)
  const marker = {
    apiVersion: 1,
    requirementsSha256: createHash('sha256').update(await readFile(path.join(root, 'ai_service', 'requirements.txt'))).digest('hex'),
    modelId: manifest.modelId,
    modelRevision: manifest.revision,
  }
  await writeFile(path.join(aiHome, 'runtime-installed.json'), JSON.stringify(marker, null, 2))
  return marker
}

export function run(command, args, { protocol = false, env = environment } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stderr.on('data', data => process.stderr.write(data))
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
      if (protocol) {
        try {
          const item = JSON.parse(line)
          if (['progress', 'ready', 'error'].includes(item.event) && typeof item.message === 'string') {
            process.stdout.write(`${JSON.stringify(item)}\n`)
            return
          }
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
        }
      }
      process.stderr.write(`${line}\n`)
    })
    const terminate = () => child.kill('SIGTERM')
    process.on('SIGTERM', terminate)
    process.on('SIGINT', terminate)
    child.once('error', reject)
    child.once('exit', code => {
      process.off('SIGTERM', terminate)
      process.off('SIGINT', terminate)
      if (code === 0) resolve()
      else reject(new Error(`子进程退出，状态 ${code}`))
    })
  })
}

export const localUvPaths = [
  ...(process.env.QINGCHANG_UV_PATH ? [process.env.QINGCHANG_UV_PATH] : []),
  path.join(aiHome, 'tools', 'uv'), '/opt/homebrew/bin/uv',
  path.join(homedir(), '.local', 'bin', 'uv'),
  ...String(process.env.PATH ?? '').split(path.delimiter).map(directory => path.join(directory, 'uv')),
]
