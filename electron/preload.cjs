const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qingchangDesktop', {
  platform: process.platform,
  exportAudio: (bytes, fileName) => ipcRenderer.invoke('qingchang:export-audio', bytes, fileName),
  openExternal: url => ipcRenderer.invoke('qingchang:open-external', url),
});
