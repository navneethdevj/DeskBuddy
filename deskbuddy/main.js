const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Enable PipeWire for camera access on Linux Wayland
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

let mainWindow;

function createWindow() {
  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Auto-grant media (webcam) permission so the camera activates without a
  // dialog.  The check handler is called synchronously for every permission
  // query; the request handler is the async follow-up for getUserMedia.
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, _requestingOrigin, _details) => {
      if (permission === 'media') return true;
      return false;
    }
  );
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, _details) => {
      if (permission === 'media') {
        callback(true);
        return;
      }
      callback(false);
    }
  );

  mainWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
