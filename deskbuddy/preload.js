const { contextBridge, ipcRenderer } = require('electron');

// Safe bridge between Electron and renderer.
// Only named functions are exposed — raw ipcRenderer is never passed through.
contextBridge.exposeInMainWorld('deskbuddy', {
  platform: process.platform
});

contextBridge.exposeInMainWorld('electronAPI', {
  enterPip:        ()    => ipcRenderer.send('enter-pip'),
  exitPip:         ()    => ipcRenderer.send('exit-pip'),
  savePipPosition: (pos) => ipcRenderer.send('save-pip-position', pos),

  // Returns a cleanup function so callers can remove the listener when done.
  onPipEntered: (fn) => {
    const handler = (_event, ...args) => fn(...args);
    ipcRenderer.on('pip-entered', handler);
    return () => ipcRenderer.removeListener('pip-entered', handler);
  },
  onPipExited: (fn) => {
    const handler = (_event, ...args) => fn(...args);
    ipcRenderer.on('pip-exited', handler);
    return () => ipcRenderer.removeListener('pip-exited', handler);
  },
});
