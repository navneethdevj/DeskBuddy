const { app, BrowserWindow, session, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow;

// ── PiP size / position persistence ─────────────────────────────────────────

const PIP_SIZE = { width: 200, height: 200 };

function _pipPositionFile() {
  return path.join(app.getPath('userData'), 'pip-position.json');
}

function _loadPipPosition() {
  try {
    const raw = fs.readFileSync(_pipPositionFile(), 'utf8');
    const pos = JSON.parse(raw);
    if (typeof pos.x === 'number' && typeof pos.y === 'number') return pos;
  } catch (_) { /* first run or corrupt — use default */ }
  return { x: 40, y: 40 };
}

function _savePipPosition(pos) {
  try { fs.writeFileSync(_pipPositionFile(), JSON.stringify(pos)); } catch (_) { /* ignore */ }
}

// ── Window factory ──────────────────────────────────────────────────────────

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width, height,
    x: 0, y: 0,
    frame: false, transparent: false, alwaysOnTop: true,
    resizable: false, skipTaskbar: false, backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false  // required for MediaPipe WASM to load from node_modules
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC: PiP mode ────────────────────────────────────────────────────────────

ipcMain.on('enter-pip', () => {
  if (!mainWindow) return;
  const pos = _loadPipPosition();
  // setBounds is atomic (size + position in one call) — avoids the momentary
  // oversized-window flash that setResizable(true)+setSize()+setResizable(false)
  // can produce on some platforms.
  mainWindow.setBounds({ x: pos.x, y: pos.y, width: PIP_SIZE.width, height: PIP_SIZE.height }, false);
  mainWindow.webContents.send('pip-entered');
});

ipcMain.on('exit-pip', () => {
  if (!mainWindow) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setBounds({ x: 0, y: 0, width, height }, false);
  mainWindow.webContents.send('pip-exited');
});

ipcMain.on('save-pip-position', (_event, pos) => {
  if (mainWindow) mainWindow.setPosition(pos.x, pos.y);
  _savePipPosition(pos);
});

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Electron 34 requires BOTH handlers. setPermissionCheckHandler runs
  // synchronously before getUserMedia — without it camera is silently blocked.
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    if (permission === 'media' || permission === 'camera') return true;
    return null;
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' || permission === 'camera');
  });
  createWindow();
});

app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
