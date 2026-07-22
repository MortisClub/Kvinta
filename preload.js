const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kvinta', {
  ym: (pathAndQuery) => ipcRenderer.invoke('ym-get', pathAndQuery),
  vkAuth: () => ipcRenderer.invoke('vk-auth'),
  vkAudio: (token, userId) => ipcRenderer.invoke('vk-audio', token, userId),
  ymStreamUrl: (trackId) => ipcRenderer.invoke('ym-stream-url', trackId),
  downloadTrack: (track) => ipcRenderer.invoke('download-track', track),
  importTrack: (track) => ipcRenderer.invoke('import-track', track),
  setCover: (trackPath, cover, oldCover) => ipcRenderer.invoke('set-cover', trackPath, cover, oldCover),
  deleteDownload: (path, cover) => ipcRenderer.invoke('delete-download', path, cover),
  fileExists: (path) => ipcRenderer.invoke('file-exists', path),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (_e, key) => cb(key)),
  setTrayMode: (on) => ipcRenderer.send('tray-mode', on),
  setMiniMode: (on) => ipcRenderer.invoke('mini-mode', on),
  appVersion: () => ipcRenderer.invoke('app-version'),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s))
});
