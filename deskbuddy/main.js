const { app, BrowserWindow, session, ipcMain, screen, clipboard, nativeImage, dialog } = require('electron');
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

// ── Snap helpers ──────────────────────────────────────────────────────────────

const SNAP_MARGIN = 20;   // px gap between snapped edge and screen edge
let _snapTimer = null;
let _isPipMode = false;   // tracks whether the compact PiP overlay is active

/**
 * WhatsApp-style edge snap: after the user releases the PiP bubble, slide it
 * to whichever horizontal screen edge it's closest to, keeping the current
 * vertical position (clamped to stay on screen).  This matches the behaviour
 * of WhatsApp's floating call PiP on Android / macOS / Windows.
 */
function _doSnapToEdge() {
  if (!mainWindow) return;
  const [curX, curY] = mainWindow.getPosition();
  const [w, h]       = mainWindow.getSize();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const m = SNAP_MARGIN;

  // Snap horizontally to the nearest edge; preserve vertical position.
  const distLeft  = curX;
  const distRight = sw - (curX + w);
  const snapX     = distLeft <= distRight ? m : sw - w - m;
  const snapY     = Math.max(m, Math.min(Math.round(curY), sh - h - m));

  mainWindow.setPosition(snapX, snapY, process.platform === 'darwin');
  store.set('windowPos', { x: snapX, y: snapY });
}

/** Legacy 5-zone corner snap — kept for full-mode resize drags. */
function _doSnapToCorner() {
  if (!mainWindow) return;
  const [curX, curY] = mainWindow.getPosition();
  const [w]          = mainWindow.getSize();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const m = SNAP_MARGIN;
  const zones = [
    { x: m,           y: m          },
    { x: sw - w - m,  y: m          },
    { x: m,           y: sh - w - m },
    { x: sw - w - m,  y: sh - w - m },
  ];
  const best = zones.reduce((nearest, c) => {
    const d = Math.hypot(c.x - curX, c.y - curY);
    if (!nearest || d < nearest.dist) return { x: c.x, y: c.y, dist: d };
    return nearest;
  }, null);
  const safeX = Math.max(0, Math.min(best.x, sw - w));
  const safeY = Math.max(0, Math.min(best.y, sh - w));
  mainWindow.setPosition(safeX, safeY, process.platform === 'darwin');
  store.set('windowPos', { x: safeX, y: safeY });
}

// ── Window factory ────────────────────────────────────────────────────────────

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width:         sw,
    height:        sh,
    x:             0,
    y:             0,
    minWidth:      150,
    minHeight:     150,
    maxWidth:      sw,
    maxHeight:     sh,
    resizable:     false,
    frame:         false,
    transparent:   true,
    alwaysOnTop:   false,
    hasShadow:     true,
    roundedCorners: false,
    skipTaskbar:   false,
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

  // 'floating' is only for PiP mode — the app starts in full-screen mode
  // where alwaysOnTop must be false so other apps can be focused normally.
  // The exit-full-mode IPC handler sets alwaysOnTop(true, 'floating') when
  // the user collapses to the compact overlay.

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show only after the renderer has finished painting — no white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Persist position on move; debounce-snap to nearest edge (PiP) or corner (full)
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    store.set('windowPos', { x, y });
    clearTimeout(_snapTimer);
    _snapTimer = setTimeout(_isPipMode ? _doSnapToEdge : _doSnapToCorner, 400);
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

  // ── Auto-PiP on blur: forward window focus/blur to renderer ──────────────
  mainWindow.on('blur', () => {
    if (mainWindow) mainWindow.webContents.send('app-blur');
  });
  mainWindow.on('focus', () => {
    if (mainWindow) mainWindow.webContents.send('app-focus');
  });
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
  _isPipMode = false;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  // Remove size constraints that only make sense for the compact overlay.
  mainWindow.setMinimumSize(150, 150);
  mainWindow.setMaximumSize(width, height);
  mainWindow.setResizable(false);
  mainWindow.setBounds({ x: 0, y: 0, width, height }, process.platform === 'darwin');
  mainWindow.setSkipTaskbar(false);
  // Clear any pip thumbnail clip so the full window shows in task view
  if (process.platform === 'win32') {
    try { mainWindow.setThumbnailClip({ x: 0, y: 0, width, height }); } catch (_) {}
  }
  // Full mode is not always-on-top and is always interactive.
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setIgnoreMouseEvents(false);
  // In full mode, only show on the current workspace (normal app behaviour)
  try { mainWindow.setVisibleOnAllWorkspaces(false); } catch (_) {}
  mainWindow.webContents.send('full-mode-entered');
});

ipcMain.on('exit-full-mode', () => {
  if (!mainWindow) return;
  _isPipMode = true;
  const preset = store.get('windowPreset', DEFAULT_PRESET);
  const dim    = _getDim(preset);
  const pos    = _loadPos(dim);
  // Restore compact constraints.
  mainWindow.setMinimumSize(150, 150);
  mainWindow.setMaximumSize(320, 320);
  mainWindow.setResizable(true);
  mainWindow.setBounds({ x: pos.x, y: pos.y, width: dim, height: dim }, process.platform === 'darwin');
  mainWindow.setSkipTaskbar(false);  // Keep visible in Win+Tab Task View
  mainWindow.setIgnoreMouseEvents(false);
  // Make the PiP bubble visible on ALL virtual desktops / workspaces so the
  // buddy is never "lost" when the user switches desktops with Win+Tab / Mission
  // Control.  visibleOnFullScreen ensures it appears even over full-screen apps.
  try { mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  // On Windows, clip the taskbar thumbnail to the pip bubble area so the companion
  // is clearly visible when hovering over the taskbar icon or in Win+Tab Task View.
  if (process.platform === 'win32') {
    try { mainWindow.setThumbnailClip({ x: 0, y: 0, width: dim, height: dim }); } catch (_) {}
  }
  // showInactive first so the window is rendered at the new size/position,
  // then assert alwaysOnTop last — nothing after this call can reset the level.
  mainWindow.showInactive();
  // 'floating' keeps the PiP bubble above every normal window on all platforms,
  // exactly like WhatsApp's call overlay. This MUST be the last OS-level call
  // so no subsequent API resets the window level.
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.webContents.send('full-mode-exited');
});

// ── PiP corner snap: move window to one of 5 named positions ─────────────────
ipcMain.on('set-pip-corner', (_event, corner) => {
  if (!mainWindow || !_isPipMode) return;
  const [w, h] = mainWindow.getSize();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const m = SNAP_MARGIN;
  const corners = {
    'top-left':   { x: m,              y: m              },
    'top-center': { x: Math.round((sw - w) / 2), y: m   },
    'top-right':  { x: sw - w - m,     y: m              },
    'bottom-left':  { x: m,            y: sh - h - m     },
    'bottom-right': { x: sw - w - m,   y: sh - h - m     },
  };
  const pos = corners[corner];
  if (!pos) return;
  const { x, y } = _clamp(pos.x, pos.y, w);
  mainWindow.setPosition(x, y, process.platform === 'darwin');
  store.set('windowPos', { x, y });
});


ipcMain.on('set-pip-always-on-top', (_event, flag) => {
  if (!mainWindow || !_isPipMode) return;
  if (flag) {
    mainWindow.setAlwaysOnTop(true, 'floating');
  } else {
    mainWindow.setAlwaysOnTop(false);
  }
});

// ── Settings IPC handlers ──────────────────────────────────────────────────

const SETTINGS_DEFAULTS = {
  mutePreset:      'ALL_ON',
  droneEnabled:    true,
  brightness:      1.0,
  breakInterval:   25,
  sensitivity:     'NORMAL',
  phoneDetection:  true,
  companionSize:   'M',
  nightAutoVolume: true,
  keybinds:        {},
  celebrationEnabled: true,
  breakAnimEnabled:   true,
};

ipcMain.handle('settings:get', () => {
  return store.get('settings', SETTINGS_DEFAULTS);
});

ipcMain.on('settings:set', (_event, obj) => {
  store.set('settings', { ...SETTINGS_DEFAULTS, ...obj });
});

// ── Share-card IPC handlers ───────────────────────────────────────────────────

// Copy the card image to the system clipboard using Electron's native API.
ipcMain.handle('share-card:copy-image', (_event, dataUrl) => {
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Open a native Save dialog and write the PNG to disk.
ipcMain.handle('share-card:save-image', async (_event, dataUrl) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `deskbuddy-session-${new Date().toISOString().slice(0, 10)}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Session history export — open native Save dialog ─────────────────────────
ipcMain.handle('history:export', async (_event, jsonString) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title:       'Export DeskBuddy History',
      defaultPath: `deskbuddy-history-${new Date().toISOString().slice(0, 10)}.json`,
      filters:     [{ name: 'JSON', extensions: ['json'] }],
      buttonLabel: 'Export',
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    fs.writeFileSync(result.filePath, jsonString, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

// ── Session history import — open native Open dialog ─────────────────────────
ipcMain.handle('history:import', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title:       'Import DeskBuddy History',
      filters:     [{ name: 'JSON', extensions: ['json'] }],
      properties:  ['openFile'],
      buttonLabel: 'Import',
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
    const data = fs.readFileSync(result.filePaths[0], 'utf8');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

// ── Settings export — open native Save dialog ────────────────────────────────
ipcMain.handle('settings:export', async (_event, jsonString) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title:       'Export DeskBuddy Settings',
      defaultPath: `deskbuddy-settings-${new Date().toISOString().slice(0, 10)}.json`,
      filters:     [{ name: 'JSON', extensions: ['json'] }],
      buttonLabel: 'Export',
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    fs.writeFileSync(result.filePath, jsonString, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

// ── Settings import — open native Open dialog ─────────────────────────────────
ipcMain.handle('settings:import', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title:       'Import DeskBuddy Settings',
      filters:     [{ name: 'JSON', extensions: ['json'] }],
      properties:  ['openFile'],
      buttonLabel: 'Import',
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
    const data = fs.readFileSync(result.filePaths[0], 'utf8');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
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
