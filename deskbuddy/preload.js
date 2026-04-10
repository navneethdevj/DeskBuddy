const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge between Electron and renderer.
// Only named functions are exposed — raw ipcRenderer is never passed through.
contextBridge.exposeInMainWorld('deskbuddy', {
  platform: process.platform
});

contextBridge.exposeInMainWorld('electronAPI', {
  enterPip:        ()      => ipcRenderer.send('enter-pip'),
  exitPip:         ()      => ipcRenderer.send('exit-pip'),
  savePipPosition: (pos)   => ipcRenderer.send('save-pip-position', pos),
  onPipEntered:    (fn)    => ipcRenderer.on('pip-entered', fn),
  onPipExited:     (fn)    => ipcRenderer.on('pip-exited',  fn),
});
