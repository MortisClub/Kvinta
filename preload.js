const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kvinta', {
  ym: (pathAndQuery) => ipcRenderer.invoke('ym-get', pathAndQuery),
  ymStreamUrl: (trackId) => ipcRenderer.invoke('ym-stream-url', trackId),
  downloadTrack: (track) => ipcRenderer.invoke('download-track', track),
  deleteDownload: (path) => ipcRenderer.invoke('delete-download', path),
  fileExists: (path) => ipcRenderer.invoke('file-exists', path),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (_e, key) => cb(key))
});
