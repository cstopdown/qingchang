import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
const extraArgs = process.argv.slice(3);
const project = path.join(root, 'ios', 'App', 'App.xcodeproj');
const derivedData = path.join(root, 'ios', 'DerivedData', 'simulator');
const app = path.join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（退出码 ${result.status}）。`);
}

function check() {
  if (process.platform !== 'darwin') throw new Error('iOS 原生构建需要安装完整 Xcode 的 Mac。');
  const version = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' });
  if (version.error) throw version.error;
  if (version.status !== 0) {
    throw new Error('需要完整 Xcode 26+；Command Line Tools 不包含 iOS SDK。请先安装并完成 Xcode 首次启动，可用 DEVELOPER_DIR 指定其 Contents/Developer 目录。\n' + version.stderr.trim());
  }
  const major = Number(version.stdout.match(/^Xcode (\d+)/m)?.[1]);
  if (!(major >= 26)) throw new Error(`需要 Xcode 26+，当前为 ${version.stdout.trim()}。`);
  const sdks = spawnSync('xcodebuild', ['-showsdks'], { encoding: 'utf8' });
  if (sdks.error) throw sdks.error;
  if (sdks.status !== 0 || !/\biphoneos\d/.test(sdks.stdout) || !/\biphonesimulator\d/.test(sdks.stdout)) {
    throw new Error('当前 Xcode 缺少 iPhoneOS 或 iPhoneSimulator SDK。请在 Xcode 设置中安装所需平台。\n' + sdks.stderr.trim());
  }
  console.log(version.stdout.trim());
  console.log(sdks.stdout.trim());
  console.log('iOS 工具链检查通过；本应用最低支持 iOS 16.4。');
}

try {
  if (!['check', 'build', 'run'].includes(mode)) throw new Error('用法：npm run ios:check / ios:build / ios:run -- [Capacitor 参数]');
  if (mode !== 'run' && extraArgs.length) throw new Error('仅 ios:run 接受 Capacitor 设备选择参数。');
  check();
  if (mode !== 'check') {
    const cap = path.join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
    if (!extraArgs.includes('--list')) run('npm', ['run', 'ios:sync']);
    if (mode === 'build') {
      run('xcodebuild', [
        '-project', project, '-scheme', 'App', '-configuration', 'Debug',
        '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator',
        '-derivedDataPath', derivedData, 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
        'ONLY_ACTIVE_ARCH=NO', 'build',
      ]);
      console.log(`未签名模拟器应用：${app}`);
      console.log('该 .app 用于 iOS 模拟器；真机自用请运行 ios:run 并在 Xcode 配置个人 Team。');
    } else {
      run(process.execPath, [cap, 'run', 'ios', '--scheme', 'App', '--no-sync', ...extraArgs]);
    }
  }
} catch (error) {
  console.error(`iOS：${error.message}`);
  process.exitCode = 1;
}
