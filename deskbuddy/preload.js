const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskbuddy', {
  platform: process.platform,
});

contextBridge.exposeInMainWorld('electronAPI', {
  resizeWindow:        (preset)         => ipcRenderer.send('resize-window', preset),
  setIgnoreMouseEvents:(ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),

  enterFullMode: () => ipcRenderer.send('enter-full-mode'),
  exitFullMode:  () => ipcRenderer.send('exit-full-mode'),

  setPipAlwaysOnTop: (flag)    => ipcRenderer.send('set-pip-always-on-top', flag),
  setPipSnapEnabled: (enabled) => ipcRenderer.send('set-pip-snap-enabled', enabled),

  // Named corner snap — 'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-right'
  setPipCorner:      (corner)  => ipcRenderer.send('set-pip-corner', corner),
  snapPipToCorner:   (corner)  => ipcRenderer.send('snap-pip-to-corner', corner),

  // Lock/unlock pip window dragging (OS-level setMovable)
  setPipLocked:      (locked)  => ipcRenderer.send('set-pip-locked', locked),

  onWindowReady: (fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on('window-ready', h);
    return () => ipcRenderer.removeListener('window-ready', h);
  },
  onWindowResized: (fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on('window-resized', h);
    return () => ipcRenderer.removeListener('window-resized', h);
  },
  onFullModeEntered: (fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on('full-mode-entered', h);
    return () => ipcRenderer.removeListener('full-mode-entered', h);
  },
  onFullModeExited: (fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on('full-mode-exited', h);
    return () => ipcRenderer.removeListener('full-mode-exited', h);
  },

  getSettings: ()    => ipcRenderer.invoke('settings:get'),
  setSettings: (obj) => ipcRenderer.send('settings:set', obj),

  copyImage: (dataUrl) => ipcRenderer.invoke('share-card:copy-image', dataUrl),
  saveImage: (dataUrl) => ipcRenderer.invoke('share-card:save-image', dataUrl),

  exportHistory: (jsonString) => ipcRenderer.invoke('history:export', jsonString),
  importHistory: ()           => ipcRenderer.invoke('history:import'),

  onAppBlur: (fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on('app-blur', h);
    return () => ipcRenderer.removeListener('app-blur', h);
  },
  onAppFocus: (fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on('app-focus', h);
    return () => ipcRenderer.removeListener('app-focus', h);
  },

  exportSettings: (jsonString) => ipcRenderer.invoke('settings:export', jsonString),
  importSettings: ()           => ipcRenderer.invoke('settings:import'),
});
