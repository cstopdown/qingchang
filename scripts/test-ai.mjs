import { spawn } from 'node:child_process';
import path from 'node:path';
import { environment, python, root } from '../ai_service/runtime.mjs';

const test = spawn(python, ['-m', 'pytest', path.join(root, 'ai_service', 'tests'), '-q'], {
  cwd: root, env: environment, stdio: 'inherit',
});
test.on('error', error => { throw error; });
test.on('exit', code => process.exit(code ?? 1));
