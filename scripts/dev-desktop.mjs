import { spawn } from 'node:child_process';
import electron from 'electron';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const vite = spawn(npm, ['run', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' });
let desktop;

function stop() {
  desktop?.kill();
  vite.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', code => {
  if (code) {
    desktop?.kill();
    process.exit(code);
  }
});

for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:5173/');
    if (response.ok) break;
  } catch (error) {
    if (error.cause?.code !== 'ECONNREFUSED') throw error;
  }
  if (attempt === 99) {
    stop();
    throw new Error('Vite 未能在 http://127.0.0.1:5173/ 启动');
  }
  await new Promise(resolve => setTimeout(resolve, 200));
}

desktop = spawn(electron, ['.', '--development'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
desktop.on('exit', code => {
  vite.kill();
  process.exit(code ?? 0);
});
