import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const android = fileURLToPath(new URL('../android/', import.meta.url));
const command = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const build = spawn(command, ['assembleDebug'], {
  cwd: android,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
build.on('error', error => { throw error; });
build.on('exit', code => {
  if (code === 0) console.log(`APK：${path.join(android, 'app/build/outputs/apk/debug/app-debug.apk')}`);
  process.exit(code ?? 1);
});
