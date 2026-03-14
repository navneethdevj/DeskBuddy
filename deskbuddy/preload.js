const { contextBridge } = require('electron');

// Safe bridge between Electron and renderer
// Extend this in later phases as needed
contextBridge.exposeInMainWorld('deskbuddy', {
  platform: process.platform
});
