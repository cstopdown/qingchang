const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qingchangDesktop', {
  platform: process.platform,
  canStartLocalAi: process.platform === 'darwin' && process.arch === 'arm64',
  exportAudio: (bytes, fileName) => ipcRenderer.invoke('qingchang:export-audio', bytes, fileName),
  openExternal: url => ipcRenderer.invoke('qingchang:open-external', url),
  startLocalAi: () => ipcRenderer.invoke('qingchang:start-local-ai'),
  getLocalAiProgress: () => ipcRenderer.invoke('qingchang:local-ai-progress'),
});
