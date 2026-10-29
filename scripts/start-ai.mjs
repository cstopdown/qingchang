import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { aiHome, emit, initializeHome, python, run } from '../ai_service/runtime.mjs'

try {
  await initializeHome()
  try {
    await access(python, constants.X_OK)
    await access(path.join(aiHome, 'model-verified.json'), constants.R_OK)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') throw new Error('尚未安装本机 AI，请先运行 AI 安装。')
    throw error
  }
  emit('progress', 'start', '启动本机 MiniCPM 音频服务，正在等待模型加载')
  await run(python, ['-m', 'ai_service', ...process.argv.slice(2)], { protocol: true })
} catch (error) {
  emit('error', 'start', error.message)
  process.exitCode = 1
}
