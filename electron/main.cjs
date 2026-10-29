const { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeFile } = require('node:fs/promises');

const development = !app.isPackaged && process.argv.includes('--development');
const rendererURL = development
  ? 'http://127.0.0.1:5173/'
  : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
let mainWindow;

function trustedURL(value) {
  return value.split('#')[0] === rendererURL;
}

function trustedContents(contents) {
  return contents === mainWindow?.webContents && trustedURL(contents.getURL());
}

function trustedSender(event) {
  if (!trustedContents(event.sender) || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('仅允许轻唱本地窗口调用原生功能');
  }
}

function externalURL(value) {
  if (typeof value !== 'string') throw new TypeError('外链必须是字符串');
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('只允许 HTTP 或 HTTPS 外链');
  }
  return url.href;
}

ipcMain.handle('qingchang:export-audio', async (event, bytes, fileName) => {
  trustedSender(event);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 512 * 1024 * 1024) {
    throw new Error('音频数据无效或超过 512 MB');
  }
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 240 ||
      fileName !== path.basename(fileName) || fileName !== path.win32.basename(fileName) ||
      /[\x00-\x1f<>:"|?*]/.test(fileName) || fileName === '.' || fileName === '..') {
    throw new Error('音频文件名必须是有效的单个文件名');
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出轻唱作品',
    defaultPath: fileName,
    filters: [{ name: '音频文件', extensions: [path.extname(fileName).slice(1) || 'wav'] }],
  });
  if (result.canceled) return 'cancelled';
  await writeFile(result.filePath, bytes);
  return 'saved';
});

ipcMain.handle('qingchang:open-external', async (event, url) => {
  trustedSender(event);
  await shell.openExternal(externalURL(url));
});

function createWindow() {
  mainWindow = new BrowserWindow({
    title: '轻唱', width: 1440, height: 940, minWidth: 820, minHeight: 640,
    backgroundColor: '#f7f5f0',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  const { webContents } = mainWindow;
  webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    const audio = permission === 'media' && details.mediaType === 'audio';
    if (!trustedContents(contents) || !details.isMainFrame || !trustedURL(details.requestingUrl ?? '') || !audio) return false;
    return process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('microphone') === 'granted';
  });
  webContents.session.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    const audio = permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 &&
      details.mediaTypes.every(type => type === 'audio');
    if (!trustedContents(contents) || !details.isMainFrame || !trustedURL(details.requestingUrl) || !audio) {
      callback(false);
      return;
    }
    callback(process.platform === 'darwin' ? await systemPreferences.askForMediaAccess('microphone') : true);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(externalURL(url));
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (!trustedURL(url)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(externalURL(url));
    }
  });
  webContents.on('will-redirect', event => event.preventDefault());
  webContents.on('will-attach-webview', event => event.preventDefault());
  if (development) void mainWindow.loadURL(rendererURL);
  else void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
