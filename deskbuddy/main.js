const { app, BrowserWindow, session, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow;

// ── PiP size / position persistence ─────────────────────────────────────────

const PIP_SIZES = { small: 160, medium: 200, large: 260 };
let _currentPipDim  = PIP_SIZES.medium;  // active pixel dimension (square)
let _currentPipSize = 'medium';           // size name, kept in sync with _currentPipDim

function _pipStateFile() {
  return path.join(app.getPath('userData'), 'pip-position.json');
}

function _loadPipState() {
  try {
    const raw = fs.readFileSync(_pipStateFile(), 'utf8');
    const s = JSON.parse(raw);
    const pos = (typeof s.x === 'number' && typeof s.y === 'number') ? s : { x: 40, y: 40 };
    if (PIP_SIZES[s.size]) { _currentPipDim = PIP_SIZES[s.size]; _currentPipSize = s.size; }
    return pos;
  } catch (_) { /* first run or corrupt — use default */ }
  return { x: 40, y: 40 };
}

function _savePipState(pos, size) {
  const entry = { x: Math.round(pos.x), y: Math.round(pos.y), size: size || _currentPipSize };
  try { fs.writeFileSync(_pipStateFile(), JSON.stringify(entry)); } catch (_) { /* ignore */ }
}

/** Clamp x/y so the PiP window never extends beyond the work area. */
function _clampToWorkArea(x, y, dim) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  return {
    x: Math.max(0, Math.min(Math.round(x), sw - dim)),
    y: Math.max(0, Math.min(Math.round(y), sh - dim)),
  };
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
  const pos = _loadPipState();
  const safe = _clampToWorkArea(pos.x, pos.y, _currentPipDim);
  // setBounds is atomic (size + position in one call) — avoids the momentary
  // oversized-window flash that setResizable(true)+setSize()+setResizable(false)
  // can produce on some platforms.
  mainWindow.setBounds({ x: safe.x, y: safe.y, width: _currentPipDim, height: _currentPipDim }, false);
  mainWindow.webContents.send('pip-entered', { size: _currentPipDim });
});

ipcMain.on('exit-pip', () => {
  if (!mainWindow) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setBounds({ x: 0, y: 0, width, height }, false);
  mainWindow.webContents.send('pip-exited');
});

// Called every frame during drag and once on drop. Using setBounds (not
// setPosition) guarantees the window size stays locked at _currentPipDim
// so it never drifts on platforms where repeated setPosition can resize.
ipcMain.on('save-pip-position', (_event, pos) => {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number'
           || !isFinite(pos.x) || !isFinite(pos.y)) return;
  const safe = _clampToWorkArea(pos.x, pos.y, _currentPipDim);
  if (mainWindow) mainWindow.setBounds({ x: safe.x, y: safe.y, width: _currentPipDim, height: _currentPipDim }, false);
  _savePipState(safe);
});

ipcMain.on('set-pip-size', (_event, sizeName) => {
  if (!PIP_SIZES[sizeName]) return;
  _currentPipDim  = PIP_SIZES[sizeName];
  _currentPipSize = sizeName;
  if (!mainWindow) return;
  const [curX, curY] = mainWindow.getPosition();
  const safe = _clampToWorkArea(curX, curY, _currentPipDim);
  mainWindow.setBounds({ x: safe.x, y: safe.y, width: _currentPipDim, height: _currentPipDim }, false);
  mainWindow.webContents.send('pip-resized', { size: _currentPipDim });
  _savePipState(safe, sizeName);
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

app.on('window-all-closed', () => {
  // On macOS, applications keep their process alive after all windows close
  // (user quits explicitly with Cmd+Q). Match that convention here.
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
