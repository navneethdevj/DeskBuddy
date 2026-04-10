const { contextBridge, ipcRenderer } = require('electron');

// Safe IPC bridge — only named functions are exposed.
// Raw ipcRenderer is never passed to the renderer.

contextBridge.exposeInMainWorld('deskbuddy', {
  platform: process.platform,
});

contextBridge.exposeInMainWorld('electronAPI', {
  // Send S / M / L resize request to main process.
  resizeWindow: (preset) => ipcRenderer.send('resize-window', preset),

  // Toggle OS-level mouse pass-through.
  // ignore=true + { forward: true } → clicks pass through, mousemove still reaches renderer.
  // ignore=false → normal interactive mode.
  setIgnoreMouseEvents: (ignore, options) =>
    ipcRenderer.send('set-ignore-mouse-events', ignore, options),

  // Fired by main after the window is shown (ready-to-show).
  onWindowReady: (fn) => {
    const handler = (_event, ...args) => fn(...args);
    ipcRenderer.on('window-ready', handler);
    return () => ipcRenderer.removeListener('window-ready', handler);
  },

  // Fired whenever the window is resized (preset buttons or OS drag handle).
  onWindowResized: (fn) => {
    const handler = (_event, ...args) => fn(...args);
    ipcRenderer.on('window-resized', handler);
    return () => ipcRenderer.removeListener('window-resized', handler);
  },
});
