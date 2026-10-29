const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { readFile, access } = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash } = require('node:crypto');

function createLocalAiController(resourceDirectory, userDataDirectory) {
  const supported = process.platform === 'darwin' && process.arch === 'arm64';
  const aiHome = path.resolve(process.env.QINGCHANG_AI_HOME || path.join(userDataDirectory, 'ai'));
  let progress = { state: 'idle', message: '首次准备约需下载 6.2 GB 模型，仅在本机运行。' };
  let activeTask;
  let setupProcess;
  let serviceProcess;
  let closing = false;

  function repairError(message) {
    return new Error(`${message}。请在项目中将 QINGCHANG_AI_HOME 设置为 ${aiHome}，再运行 npm run ai:setup 重新安装。`);
  }

  async function installed() {
    let marker;
    try { marker = JSON.parse(await readFile(path.join(aiHome, 'runtime-installed.json'), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return false;
      if (error instanceof SyntaxError) throw repairError('本机 AI 安装记录无法解析');
      throw error;
    }
    const manifest = JSON.parse(await readFile(path.join(resourceDirectory, 'ai_service', 'model-manifest.json'), 'utf8'));
    const requirementsHash = createHash('sha256').update(await readFile(path.join(resourceDirectory, 'ai_service', 'requirements.txt'))).digest('hex');
    if (marker?.apiVersion !== 1 || marker.requirementsSha256 !== requirementsHash ||
        marker.modelId !== manifest.modelId || marker.modelRevision !== manifest.revision) {
      throw repairError('本机 AI 安装记录与当前版本不一致');
    }
    try { await access(path.join(aiHome, 'venv', 'bin', 'python'), constants.X_OK); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES') throw repairError('本机 AI 的 Python 环境缺失或不可执行');
      throw error;
    }
    return true;
  }

  async function health() {
    let response;
    try {
      response = await fetch('http://127.0.0.1:8787/health', {
        signal: AbortSignal.timeout(3000),
        headers: process.env.QINGCHANG_AI_TOKEN ? { Authorization: `Bearer ${process.env.QINGCHANG_AI_TOKEN}` } : {},
      });
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return null;
      throw error;
    }
    if (!response.ok) throw new Error(`本机 AI 服务返回 HTTP ${response.status}，请检查 8787 端口。`);
    const value = await response.json();
    if (value?.service !== 'qingchang-ai' || value.apiVersion !== 1 || !['loading', 'ready', 'error'].includes(value.status) ||
        (value.message !== undefined && typeof value.message !== 'string') ||
        value.modelId !== 'mlx-community/MiniCPM-o-4_5-4bit' || value.backend !== 'mlx' || value.audioInput !== true) {
      throw new Error('8787 端口不是兼容的轻唱 MiniCPM-o 4.5 私有服务。');
    }
    if (value.status === 'error') throw new Error(value.message || '本机 AI 服务报告加载失败。');
    return value;
  }

  function terminate(child) {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }

  function launchScript(name, state) {
    const child = spawn(process.execPath, [path.join(resourceDirectory, 'scripts', `${name}-ai.mjs`)], {
      cwd: resourceDirectory,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', QINGCHANG_AI_HOME: aiHome, PYTHONUNBUFFERED: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const completed = new Promise((resolve, reject) => {
      child.on('error', reject);
      createInterface({ input: child.stdout }).on('line', line => {
        try {
          const event = JSON.parse(line);
          if (!['progress', 'ready', 'error'].includes(event.event) || typeof event.message !== 'string') {
            throw new Error('AI 启动脚本返回了无效的进度信息。');
          }
          if (event.event === 'error') throw new Error(event.message);
          const bytes = event.downloadedBytes === undefined ? ''
            : `（${(event.downloadedBytes / 1e9).toFixed(2)} / ${(event.totalBytes / 1e9).toFixed(2)} GB）`;
          const rate = event.downloadRateBytesPerSecond === undefined ? ''
            : ` ${(event.downloadRateBytesPerSecond / 1e6).toFixed(1)} MB/s`;
          progress = { state, message: `${event.message}${bytes}${rate}` };
        } catch (error) {
          terminate(child);
          reject(error);
        }
      });
      child.on('exit', code => {
        if (code === 0 || closing) resolve();
        else reject(new Error(stderr.trim() || `AI ${name} 进程退出（${code}）。`));
      });
    });
    return { child, completed };
  }

  async function prepare() {
    const running = await health();
    if (running) {
      progress = {
        state: running.status === 'ready' ? 'ready' : 'starting',
        message: running.message || '正在使用已有的本机轻唱 AI 服务。',
      };
      return;
    }
    if (!await installed()) {
      progress = { state: 'installing', message: '正在准备独立 Python 环境与 MiniCPM-o 4.5 模型，首次约 6.2 GB。' };
      const setup = launchScript('setup', 'installing');
      setupProcess = setup.child;
      try { await setup.completed; }
      finally { setupProcess = undefined; }
    }
    if (closing) return;
    progress = { state: 'starting', message: '正在加载本机 MiniCPM-o 4.5 模型。' };
    const service = launchScript('start', 'starting');
    serviceProcess = service.child;
    service.child.on('exit', () => { serviceProcess = undefined; });
    service.completed.then(() => {
      if (!closing) progress = { state: 'error', message: '本机 AI 服务已退出，可以重新启动。' };
    }, error => {
      if (!closing) progress = { state: 'error', message: error.message };
    });
  }

  return {
    supported,
    start() {
      if (!supported) throw new Error('自动准备本机 AI 仅支持 Apple Silicon Mac，请连接已有私有服务。');
      if (activeTask || setupProcess) return;
      if (serviceProcess) {
        progress = { state: 'starting', message: '正在重新检查本机 AI 服务。' };
        return;
      }
      progress = { state: 'starting', message: '正在检查已有的本机轻唱 AI 服务。' };
      activeTask = prepare().catch(error => {
        progress = { state: 'error', message: error.message };
      }).finally(() => { activeTask = undefined; });
    },
    async getProgress() {
      if (progress.state === 'starting' || progress.state === 'ready') {
        try {
          const running = await health();
          if (running?.status === 'ready') progress = { state: 'ready', message: 'MiniCPM-o 4.5 已在本机就绪，录音不会发送到云端。' };
          else if (progress.state === 'ready') progress = { state: 'error', message: '本机 AI 服务连接已断开，请重新启动。' };
        } catch (error) {
          progress = { state: 'error', message: error.message };
        }
      }
      return progress;
    },
    async stop() {
      closing = true;
      const children = [setupProcess, serviceProcess].filter(child => child?.pid);
      await Promise.all(children.map(async child => {
        const exited = new Promise(resolve => child.once('close', () => resolve('exited')));
        terminate(child);
        let timer;
        const outcome = await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 2000); })]);
        clearTimeout(timer);
        // Python 正在加载或推理时可能延迟响应 SIGTERM；退出应用时结束整个自有进程组。
        if (outcome === 'timeout' && child.exitCode === null && child.signalCode === null) {
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
      }));
    },
  };
}

module.exports = { createLocalAiController };
