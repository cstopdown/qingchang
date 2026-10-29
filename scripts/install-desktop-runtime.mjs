import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD !== '1') {
  const require = createRequire(import.meta.url);
  const install = spawnSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' });
  if (install.error) throw install.error;
  process.exit(install.status ?? 1);
}
