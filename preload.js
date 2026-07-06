const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  startServer: (opts) => ipcRenderer.invoke('start-server', opts),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onStatusChanged: (cb) => ipcRenderer.on('status-changed', (_, data) => cb(data)),
  onTunnelUrl: (cb) => ipcRenderer.on('tunnel-url', (_, url) => cb(url)),
  onLog: (cb) => ipcRenderer.on('log', (_, entry) => cb(entry)),
  simulateScale: (weightLb) => ipcRenderer.invoke('scale-simulate', weightLb),
});
