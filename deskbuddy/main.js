const { app, BrowserWindow, session, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Inline key/value store (electron-store–compatible API) ───────────────────
// Persists to userData/deskbuddy-store.json.  Writes synchronously on every
// set() so the size/position are never lost on force-quit.

class Store {
  constructor() {
    this._file = path.join(app.getPath('userData'), 'deskbuddy-store.json');
    this._data = {};
    try { this._data = JSON.parse(fs.readFileSync(this._file, 'utf8')); } catch (_) {}
  }
  get(key, defaultValue) {
    return Object.prototype.hasOwnProperty.call(this._data, key)
      ? this._data[key] : defaultValue;
  }
  set(key, value) {
    this._data[key] = value;
    try { fs.writeFileSync(this._file, JSON.stringify(this._data)); } catch (_) {}
  }
}

let store;   // initialised in app.whenReady() after getPath() is available
let mainWindow;

// ── Size presets ──────────────────────────────────────────────────────────────

const SIZE_PRESETS = { S: 150, M: 200, L: 270 };
const DEFAULT_PRESET = 'M';

function _getDim(preset) { return SIZE_PRESETS[preset] || SIZE_PRESETS[DEFAULT_PRESET]; }

// ── Position helpers ──────────────────────────────────────────────────────────

/** Return true only when (x,y,dim) fits inside at least one display's work area. */
function _positionIsOnScreen(x, y, dim) {
  return screen.getAllDisplays().some(d => {
    const { x: dx, y: dy, width: dw, height: dh } = d.workArea;
    return x >= dx && y >= dy && x + dim <= dx + dw && y + dim <= dy + dh;
  });
}

/** Clamp x/y so the window never extends beyond the primary work area. */
function _clamp(x, y, dim) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  return {
    x: Math.max(0, Math.min(Math.round(x), sw - dim)),
    y: Math.max(0, Math.min(Math.round(y), sh - dim)),
  };
}

function _loadPos(dim) {
  const saved = store.get('windowPos');
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number'
             && isFinite(saved.x) && isFinite(saved.y)
             && _positionIsOnScreen(saved.x, saved.y, dim)) {
    return { x: Math.round(saved.x), y: Math.round(saved.y) };
  }
  return { x: 40, y: 40 };   // safe default: top-left margin
}

// ── Snap to nearest corner ────────────────────────────────────────────────────

const SNAP_MARGIN = 20;   // px gap between snapped edge and screen edge
let _snapTimer = null;

function _doSnapToCorner() {
  if (!mainWindow) return;
  const [curX, curY] = mainWindow.getPosition();
  const [w]          = mainWindow.getSize();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const m = SNAP_MARGIN;
  const corners = [
    { x: m,          y: m          },   // top-left
    { x: sw - w - m, y: m          },   // top-right
    { x: m,          y: sh - w - m },   // bottom-left
    { x: sw - w - m, y: sh - w - m },   // bottom-right
  ];
  const best = corners.reduce((nearest, c) => {
    const d = Math.hypot(c.x - curX, c.y - curY);
    return d < nearest.dist ? { ...c, dist: d } : nearest;
  }, { ...corners[0], dist: Infinity });
  const safeX = Math.max(0, Math.min(best.x, sw - w));
  const safeY = Math.max(0, Math.min(best.y, sh - w));
  // animate: true is honoured on macOS; silently ignored elsewhere
  mainWindow.setPosition(safeX, safeY, true);
  store.set('windowPos', { x: safeX, y: safeY });
}

// ── Window factory ────────────────────────────────────────────────────────────

function createWindow() {
  const preset = store.get('windowPreset', DEFAULT_PRESET);
  const dim    = _getDim(preset);
  const pos    = _loadPos(dim);

  mainWindow = new BrowserWindow({
    width:         dim,
    height:        dim,
    x:             pos.x,
    y:             pos.y,
    minWidth:      150,
    minHeight:     150,
    maxWidth:      320,
    maxHeight:     320,
    resizable:     true,
    frame:         false,
    transparent:   true,
    alwaysOnTop:   true,
    hasShadow:     true,
    roundedCorners: true,
    skipTaskbar:   true,
    backgroundColor: '#00000000',
    show:          false,   // shown only after content loads — prevents white flash
    ...(process.platform === 'darwin' ? { vibrancy: 'hud' } : {}),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,   // required for MediaPipe WASM
    },
  });

  // 'floating' keeps the companion above normal windows but below system UI
  mainWindow.setAlwaysOnTop(true, 'floating');

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show only after the renderer has finished painting — no white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.send('window-ready', { preset, dim });
  });

  // Persist position every time the user moves the window; debounce snap
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    store.set('windowPos', { x, y });
    clearTimeout(_snapTimer);
    _snapTimer = setTimeout(_doSnapToCorner, 400);
  });

  // Persist size when the window is resized (e.g. via drag handle on macOS).
  // Map back to the closest preset so S/M/L stays in sync.
  mainWindow.on('resized', () => {
    const [w] = mainWindow.getSize();
    const closest = Object.entries(SIZE_PRESETS).reduce((best, [key, val]) => (
      Math.abs(val - w) < Math.abs(SIZE_PRESETS[best] - w) ? key : best
    ), DEFAULT_PRESET);
    store.set('windowPreset', closest);
    const [x, y] = mainWindow.getPosition();
    store.set('windowPos', { x, y });
    mainWindow.webContents.send('window-resized', { preset: closest, dim: w });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.on('resize-window', (_event, preset) => {
  if (!SIZE_PRESETS[preset] || !mainWindow) return;
  const dim = SIZE_PRESETS[preset];
  const [curX, curY] = mainWindow.getPosition();
  const clamped = _clamp(curX, curY, dim);
  // Animate the resize on macOS (true); ignored silently on Windows/Linux
  mainWindow.setBounds(
    { x: clamped.x, y: clamped.y, width: dim, height: dim },
    process.platform === 'darwin'
  );
  store.set('windowPreset', preset);
  store.set('windowPos', clamped);
  mainWindow.webContents.send('window-resized', { preset, dim });
});

ipcMain.on('set-ignore-mouse-events', (_event, ignore, options) => {
  if (mainWindow) mainWindow.setIgnoreMouseEvents(!!ignore, options || {});
});

ipcMain.on('enter-full-mode', () => {
  if (!mainWindow) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  // Remove size constraints that only make sense for the compact overlay.
  mainWindow.setMinimumSize(150, 150);
  mainWindow.setMaximumSize(width, height);
  mainWindow.setResizable(false);
  mainWindow.setBounds({ x: 0, y: 0, width, height }, process.platform === 'darwin');
  mainWindow.setSkipTaskbar(false);
  // Full mode is always interactive — cancel any pass-through.
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.webContents.send('full-mode-entered');
});

ipcMain.on('exit-full-mode', () => {
  if (!mainWindow) return;
  const preset = store.get('windowPreset', DEFAULT_PRESET);
  const dim    = _getDim(preset);
  const pos    = _loadPos(dim);
  // Restore compact constraints.
  mainWindow.setMinimumSize(150, 150);
  mainWindow.setMaximumSize(320, 320);
  mainWindow.setResizable(true);
  mainWindow.setBounds({ x: pos.x, y: pos.y, width: dim, height: dim }, process.platform === 'darwin');
  mainWindow.setSkipTaskbar(true);
  mainWindow.webContents.send('full-mode-exited');
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  store = new Store();

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
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
