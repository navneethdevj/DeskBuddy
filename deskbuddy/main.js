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
    try {
      this._data = JSON.parse(fs.readFileSync(this._file, 'utf8'));
    } catch (err) {
      // ENOENT on first run is expected; any other error is logged and we
      // start with an empty store (safe fallback — defaults will be used).
      if (err.code !== 'ENOENT') console.error('[Store] load error:', err.message);
    }
  }
  get(key, defaultValue) {
    return Object.prototype.hasOwnProperty.call(this._data, key)
      ? this._data[key] : defaultValue;
  }
  set(key, value) {
    this._data[key] = value;
    try { fs.writeFileSync(this._file, JSON.stringify(this._data)); } catch (err) {
      // Non-fatal — position/size will revert to defaults on next launch
      // if the write failed (e.g. disk full, permissions).
      console.error('[Store] write error:', err.message);
    }
  }
}

let store;   // initialised in app.whenReady() after getPath() is available
let mainWindow;

// ── Size presets ──────────────────────────────────────────────────────────────

const SIZE_PRESETS = { S: 150, M: 200, L: 270 };
const DEFAULT_PRESET = 'M';
// §3.3 — explicit allowlist prevents prototype-property bypass
const ALLOWED_PRESETS = new Set(Object.keys(SIZE_PRESETS));

function _getDim(preset) { return SIZE_PRESETS[preset] || SIZE_PRESETS[DEFAULT_PRESET]; }

// ── Position helpers ──────────────────────────────────────────────────────────

/** Return true only when (x,y,dim) fits inside at least one display's work area. */
function _positionIsOnScreen(x, y, dim) {
  return screen.getAllDisplays().some(d => {
    const { x: dx, y: dy, width: dw, height: dh } = d.workArea;
    return x >= dx && y >= dy && x + dim <= dx + dw && y + dim <= dy + dh;
  });
}

/**
 * §3.5 — Find the display that currently contains the window centre.
 * Falls back to the primary display if the centre is between monitors.
 */
function _getActiveDisplay() {
  if (!mainWindow) return screen.getPrimaryDisplay();
  const [wx, wy] = mainWindow.getPosition();
  const [ww]     = mainWindow.getSize();
  const cx = wx + ww / 2;
  const cy = wy + ww / 2;
  return (
    screen.getAllDisplays().find(d => {
      const { x, y, width, height } = d.workArea;
      return cx >= x && cx < x + width && cy >= y && cy < y + height;
    }) || screen.getPrimaryDisplay()
  );
}

/** Clamp x/y so the window never extends beyond the active display's work area. */
function _clamp(x, y, dim) {
  const { x: dx, y: dy, width: dw, height: dh } = _getActiveDisplay().workArea;
  return {
    x: Math.max(dx, Math.min(Math.round(x), dx + dw - dim)),
    y: Math.max(dy, Math.min(Math.round(y), dy + dh - dim)),
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
  // §3.5 — snap to the display the window is actually on, not always the primary
  const { x: dx, y: dy, width: dw, height: dh } = _getActiveDisplay().workArea;
  const m = SNAP_MARGIN;
  const corners = [
    { x: dx + m,          y: dy + m           },   // top-left
    { x: dx + dw - w - m, y: dy + m           },   // top-right
    { x: dx + m,          y: dy + dh - w - m  },   // bottom-left
    { x: dx + dw - w - m, y: dy + dh - w - m  },   // bottom-right
  ];
  // Reduce over all corners, starting with null so the first comparison is
  // always a real distance check rather than a meaningless Infinity seed.
  const best = corners.reduce((nearest, c) => {
    const d = Math.hypot(c.x - curX, c.y - curY);
    if (!nearest || d < nearest.dist) return { x: c.x, y: c.y, dist: d };
    return nearest;
  }, null);
  const safeX = Math.max(dx, Math.min(best.x, dx + dw - w));
  const safeY = Math.max(dy, Math.min(best.y, dy + dh - w));
  // animate: true is honoured on macOS; silently ignored elsewhere
  mainWindow.setPosition(safeX, safeY, true);
  // §3.6 — write only here (debounced), not on every 'moved' event
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

  // §3.2 — Content-Security-Policy: applied via response-header hook so it
  // works even with webSecurity:false and covers the local file:// origin.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "connect-src 'self' https://storage.googleapis.com; " +
          "img-src 'self' data: blob:; " +
          "media-src 'self' mediastream: blob:; " +
          "object-src 'none';"
        ],
      },
    });
  });

  // §3.8 — Prevent navigation away from the local app file and block
  // any attempt to open a new window (e.g. from a dependency link).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in the OS browser, never inside the app window.
    require('electron').shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // Show only after the renderer has finished painting — no white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.send('window-ready', { preset, dim });
  });

  // §3.6 — Do NOT write windowPos on every 'moved' event (called on every
  // drag frame).  The write happens inside _doSnapToCorner() which is already
  // debounced 400 ms, so position is still persisted after each drag gesture.
  mainWindow.on('moved', () => {
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
  // §3.3 — explicit Set check prevents prototype-property bypass
  if (typeof preset !== 'string' || !ALLOWED_PRESETS.has(preset) || !mainWindow) return;
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
  // §3.4 — persist mode so next launch restores correctly after crash/force-quit
  store.set('fullMode', true);
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
  // §3.4 — persist mode
  store.set('fullMode', false);
  mainWindow.webContents.send('full-mode-exited');
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  store = new Store();

  // Electron 34 requires BOTH handlers. setPermissionCheckHandler runs
  // synchronously before getUserMedia — without it camera is silently blocked.
  // §3.7 — check handler grants only 'camera'; 'media' is intentionally
  // excluded here since it would also approve microphone permission checks.
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    if (permission === 'camera') return true;
    return null;
  });
  // The request handler must still accept 'media' because that is the string
  // Electron uses internally when getUserMedia() is called, even when
  // audio: false is specified in the constraints.
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
