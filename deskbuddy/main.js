const { app, BrowserWindow, session, ipcMain, screen, clipboard, nativeImage, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');

class Store {
  constructor() {
    this._file = path.join(app.getPath('userData'), 'deskbuddy-store.json');
    this._data = {};
    try {
      this._data = JSON.parse(fs.readFileSync(this._file, 'utf8'));
    } catch (err) {
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
      console.error('[Store] write error:', err.message);
    }
  }
}

let store;
let mainWindow;

const SIZE_PRESETS = { S: 150, M: 200, L: 270 };
const DEFAULT_PRESET = 'M';
// Tight corner snap margin — 8px gap so window sits flush in corners
const SNAP_MARGIN = 8;

function _getDim(preset) { return SIZE_PRESETS[preset] || SIZE_PRESETS[DEFAULT_PRESET]; }

function _positionIsOnScreen(x, y, dim) {
  return screen.getAllDisplays().some(d => {
    const { x: dx, y: dy, width: dw, height: dh } = d.workArea;
    return x >= dx && y >= dy && x + dim <= dx + dw && y + dim <= dy + dh;
  });
}

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
  return { x: SNAP_MARGIN, y: SNAP_MARGIN };
}

let _snapTimer    = null;
let _isPipMode    = false;
let _pipLocked    = false;  // tracks pip window lock — prevents drag + snap

// ── WhatsApp-style drag tracking — velocity + momentum snap ───────────────
let _dragVelX     = 0;
let _dragVelY     = 0;
let _dragLastPos  = null;
let _dragLastTime = null;
let _dragTrail    = [];  // last N positions for velocity estimation

function _doSnapToNearestZone() {
  if (!mainWindow || _pipLocked) return;
  const [curX, curY] = mainWindow.getPosition();
  const [w, h]       = mainWindow.getSize();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const m  = SNAP_MARGIN;
  const cx = curX + w / 2;
  const cy = curY + h / 2;
  const zones = [
    { x: m,                        y: m          },
    { x: Math.round((sw - w) / 2), y: m          },
    { x: sw - w - m,               y: m          },
    { x: m,                        y: sh - h - m },
    { x: sw - w - m,               y: sh - h - m },
  ];
  const best = zones.reduce((nearest, z) => {
    const d = Math.hypot((z.x + w / 2) - cx, (z.y + h / 2) - cy);
    return (!nearest || d < nearest.dist) ? { ...z, dist: d } : nearest;
  }, null);
  mainWindow.setPosition(best.x, best.y, process.platform === 'darwin');
  store.set('windowPos', { x: best.x, y: best.y });
}

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

// ── WhatsApp-style momentum snap ─────────────────────────────────────────
// Determines snap target by projecting current position forward using
// drag velocity, then snapping to the nearest of 9 zones.
// This matches WhatsApp's PiP behavior: throw → flies to nearest edge.
function _doSnapWithMomentum() {
  if (!mainWindow || _pipLocked) return;
  const [curX, curY] = mainWindow.getPosition();
  const [w, h]       = mainWindow.getSize();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const m = SNAP_MARGIN;

  // Project position forward based on velocity (momentum prediction)
  const MOMENTUM_MS   = 220; // how far ahead to project (ms of current velocity)
  const projX = curX + _dragVelX * MOMENTUM_MS;
  const projY = curY + _dragVelY * MOMENTUM_MS;

  // 9 snap zones: corners + edge-midpoints + center
  const half = Math.round((sw - w) / 2);
  const vmid = Math.round((sh - h) / 2);
  const zones = [
    { x: m,         y: m         },  // top-left
    { x: half,      y: m         },  // top-center
    { x: sw-w-m,    y: m         },  // top-right
    { x: m,         y: vmid      },  // mid-left
    { x: sw-w-m,    y: vmid      },  // mid-right
    { x: m,         y: sh-h-m    },  // bottom-left
    { x: half,      y: sh-h-m    },  // bottom-right (was bottom-center)
    { x: sw-w-m,    y: sh-h-m    },  // bottom-right
  ];

  // Find nearest zone to projected position
  const best = zones.reduce((nearest, z) => {
    const d = Math.hypot((z.x + w/2) - (projX + w/2), (z.y + h/2) - (projY + h/2));
    return (!nearest || d < nearest.dist) ? { ...z, dist: d } : nearest;
  }, null);

  const safeX = Math.max(0, Math.min(best.x, sw - w));
  const safeY = Math.max(0, Math.min(best.y, sh - h));

  // Animate with smooth transition (Electron setPosition is instant — use setBounds)
  mainWindow.setBounds({ x: safeX, y: safeY, width: w, height: h }, process.platform === 'darwin');
  store.set('windowPos', { x: safeX, y: safeY });

  // Reset velocity after snap
  _dragVelX = 0; _dragVelY = 0;
  _dragLastPos = null; _dragLastTime = null;
}

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width:           sw,
    height:          sh,
    x:               0,
    y:               0,
    minWidth:        150,
    minHeight:       150,
    maxWidth:        sw,
    maxHeight:       sh,
    resizable:       false,
    frame:           false,
    transparent:     true,
    alwaysOnTop:     false,
    hasShadow:       false,   // false: we render our own glow via CSS box-shadow on #world
    roundedCorners:  false,
    skipTaskbar:     false,
    backgroundColor: '#00000000',
    show:            false,
    ...(process.platform === 'darwin' ? { vibrancy: 'hud' } : {}),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.send('window-ready');
  });

  mainWindow.on('moved', () => {
    if (_pipLocked) return;
    const [x, y] = mainWindow.getPosition();
    const now = Date.now();

    // Track drag velocity for WhatsApp-style momentum snap
    if (_dragLastPos && _dragLastTime) {
      const dt = Math.max(1, now - _dragLastTime);
      _dragVelX = (x - _dragLastPos.x) / dt;
      _dragVelY = (y - _dragLastPos.y) / dt;
    }
    _dragLastPos  = { x, y };
    _dragLastTime = now;

    store.set('windowPos', { x, y });
    clearTimeout(_snapTimer);

    if (_isPipMode) {
      const snapEnabled = (store.get('settings', {}).pipSnapEnabled !== false);
      if (snapEnabled) {
        // Short delay — snap fires quickly like WhatsApp
        _snapTimer = setTimeout(_doSnapWithMomentum, 180);
      }
    } else {
      _snapTimer = setTimeout(_doSnapToCorner, 350);
    }
  });

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

  mainWindow.on('blur',  () => { if (mainWindow) mainWindow.webContents.send('app-blur');  });
  mainWindow.on('focus', () => { if (mainWindow) mainWindow.webContents.send('app-focus'); });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.on('resize-window', (_event, preset) => {
  if (!SIZE_PRESETS[preset] || !mainWindow) return;
  const dim = SIZE_PRESETS[preset];
  const [curX, curY] = mainWindow.getPosition();
  const clamped = _clamp(curX, curY, dim);
  mainWindow.setBounds({ x: clamped.x, y: clamped.y, width: dim, height: dim }, process.platform === 'darwin');
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
  _pipLocked = false;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setMinimumSize(150, 150);
  mainWindow.setMaximumSize(width, height);
  mainWindow.setResizable(false);
  mainWindow.setBounds({ x: 0, y: 0, width, height }, process.platform === 'darwin');
  mainWindow.setSkipTaskbar(false);
  if (process.platform === 'win32') {
    try { mainWindow.setThumbnailClip({ x: 0, y: 0, width, height }); } catch (_) {}
  }
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setMovable(true);
  try { mainWindow.setVisibleOnAllWorkspaces(false); } catch (_) {}
  mainWindow.webContents.send('full-mode-entered');
});

ipcMain.on('exit-full-mode', () => {
  if (!mainWindow) return;
  _isPipMode = true;
  const preset = store.get('windowPreset', DEFAULT_PRESET);
  const dim    = _getDim(preset);
  const pos    = _loadPos(dim);
  mainWindow.setMinimumSize(150, 150);
  mainWindow.setMaximumSize(320, 320);
  mainWindow.setResizable(true);
  mainWindow.setBounds({ x: pos.x, y: pos.y, width: dim, height: dim }, process.platform === 'darwin');
  mainWindow.setSkipTaskbar(false);
  mainWindow.setIgnoreMouseEvents(false);
  // Restore lock state from saved settings
  const savedSettings = store.get('settings', {});
  _pipLocked = !!savedSettings.pipLocked;
  mainWindow.setMovable(!_pipLocked);
  try { mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  if (process.platform === 'win32') {
    try { mainWindow.setThumbnailClip({ x: 0, y: 0, width: dim, height: dim }); } catch (_) {}
  }
  mainWindow.showInactive();
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.webContents.send('full-mode-exited');
});

// ── PiP window lock — disables OS-level dragging ──────────────────────────────
ipcMain.on('set-pip-locked', (_event, locked) => {
  if (!mainWindow) return;
  _pipLocked = !!locked;
  try { mainWindow.setMovable(!_pipLocked); } catch (_) {}
  const settings = store.get('settings', {});
  settings.pipLocked = _pipLocked;
  store.set('settings', settings);
});

// ── PiP corner snap ────────────────────────────────────────────────────────────
function _snapToCorner(corner) {
  if (!mainWindow || !_isPipMode) return;
  const [w, h] = mainWindow.getSize();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const m = SNAP_MARGIN;
  const positions = {
    'top-left':     { x: m,                         y: m          },
    'top-center':   { x: Math.round((sw - w) / 2),  y: m          },
    'top-right':    { x: sw - w - m,                y: m          },
    'bottom-left':  { x: m,                         y: sh - h - m },
    'bottom-right': { x: sw - w - m,                y: sh - h - m },
  };
  const pos = positions[corner];
  if (!pos) return;
  const safe = _clamp(pos.x, pos.y, w);
  mainWindow.setPosition(safe.x, safe.y, process.platform === 'darwin');
  store.set('windowPos', { x: safe.x, y: safe.y });
}

ipcMain.on('set-pip-corner',       (_event, corner) => _snapToCorner(corner));
ipcMain.on('snap-pip-to-corner',   (_event, corner) => _snapToCorner(corner));

ipcMain.on('set-pip-snap-enabled', (_event, enabled) => {
  const settings = store.get('settings', {});
  settings.pipSnapEnabled = !!enabled;
  store.set('settings', settings);
  if (enabled && mainWindow && _isPipMode && !_pipLocked) _doSnapToNearestZone();
});

ipcMain.on('set-pip-always-on-top', (_event, flag) => {
  if (!mainWindow || !_isPipMode) return;
  mainWindow.setAlwaysOnTop(!!flag, flag ? 'floating' : undefined);
});

// ── Settings IPC ──────────────────────────────────────────────────────────────
const SETTINGS_DEFAULTS = {
  mutePreset: 'ALL_ON', droneEnabled: true, brightness: 1.0,
  breakInterval: 25, sensitivity: 'NORMAL', phoneDetection: true,
  companionSize: 'M', nightAutoVolume: true, keybinds: {},
  celebrationEnabled: true, breakAnimEnabled: true,
};

ipcMain.handle('settings:get', () => store.get('settings', SETTINGS_DEFAULTS));
ipcMain.on('settings:set', (_event, obj) => store.set('settings', { ...SETTINGS_DEFAULTS, ...obj }));

ipcMain.handle('share-card:copy-image', (_event, dataUrl) => {
  try { clipboard.writeImage(nativeImage.createFromDataURL(dataUrl)); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('share-card:save-image', async (_event, dataUrl) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `deskbuddy-session-${new Date().toISOString().slice(0,10)}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    return { ok: true, filePath: result.filePath };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('history:export', async (_event, jsonString) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export DeskBuddy History',
      defaultPath: `deskbuddy-history-${new Date().toISOString().slice(0,10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }], buttonLabel: 'Export',
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    fs.writeFileSync(result.filePath, jsonString, 'utf8');
    return { ok: true };
  } catch (err) { return { ok: false, reason: err.message }; }
});

ipcMain.handle('history:import', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import DeskBuddy History',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'], buttonLabel: 'Import',
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
    return { ok: true, data: fs.readFileSync(result.filePaths[0], 'utf8') };
  } catch (err) { return { ok: false, reason: err.message }; }
});

ipcMain.handle('settings:export', async (_event, jsonString) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export DeskBuddy Settings',
      defaultPath: `deskbuddy-settings-${new Date().toISOString().slice(0,10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }], buttonLabel: 'Export',
    });
    if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
    fs.writeFileSync(result.filePath, jsonString, 'utf8');
    return { ok: true };
  } catch (err) { return { ok: false, reason: err.message }; }
});

ipcMain.handle('settings:import', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import DeskBuddy Settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'], buttonLabel: 'Import',
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
    return { ok: true, data: fs.readFileSync(result.filePaths[0], 'utf8') };
  } catch (err) { return { ok: false, reason: err.message }; }
});

app.whenReady().then(() => {
  store = new Store();
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    if (permission === 'media' || permission === 'camera') return true;
    return null;
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' || permission === 'camera');
  });
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
