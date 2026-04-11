/**
 * Settings — Persistence module for DeskBuddy companion customisation.
 *
 * Two-layer storage:
 *   1. localStorage — synchronous, instant read on init.
 *   2. Electron Store via IPC — survives localStorage clear; reconciled async.
 *
 * Usage:
 *   Settings.init()           — call once at startup
 *   Settings.get('key')       — synchronous read
 *   Settings.set('key', val)  — write + fire listeners + persist
 *   Settings.onChange(k, fn)  — subscribe to changes for key k
 *   Settings.dump()           — full snapshot for debug / export
 */
const Settings = (() => {

  const STORAGE_KEY = 'deskbuddy_settings';

  const DEFAULTS = {
    mutePreset:      'ALL_ON',   // 'ALL_ON' | 'ESSENTIAL' | 'REMINDERS_ONLY' | 'ALL_OFF'
    volume:          0.7,        // master volume 0–1
    droneEnabled:    true,       // ambient soundscape on/off
    brightness:      1.0,        // #world CSS filter brightness (0.3–1.0)
    breakInterval:   25,         // minutes, 0 = disabled
    sensitivity:     'NORMAL',   // 'GENTLE' | 'NORMAL' | 'STRICT'
    phoneDetection:  true,       // brain.js phone posture detection
    companionSize:   'M',        // 'S' | 'M' | 'L'
    nightAutoVolume: true,       // soundscape reduces volume at NIGHT
    sessionLength:   25,         // default session duration in minutes
    timerStep:       5,          // +/− step size in minutes for duration stepper
    ticksEnabled:    true,       // soft timer tick sounds on/off
    keybinds:        {},         // override map: { [action_id]: 'KeyboardShortcut' }
  };

  let _current = { ...DEFAULTS };
  const _listeners = {};   // { key: [fn, fn, ...] }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    // Fast synchronous read from localStorage first
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        _current = { ...DEFAULTS, ...saved };
      }
    } catch (e) { /* corrupt data — start with defaults */ }

    // Reconcile with main-process Store (survives localStorage clear)
    if (window.electronAPI?.getSettings) {
      window.electronAPI.getSettings().then(saved => {
        if (!saved) return;
        _current = { ...DEFAULTS, ...saved };
        _persist();
        Object.keys(_current).forEach(key => _fire(key, _current[key]));
      }).catch(() => {});
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function get(key) {
    return _current[key] !== undefined ? _current[key] : DEFAULTS[key];
  }

  function set(key, value) {
    if (_current[key] === value) return;
    _current[key] = value;
    _persist();
    _fire(key, value);
  }

  function onChange(key, fn) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(fn);
  }

  function dump() {
    return { ..._current };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  function _fire(key, value) {
    (_listeners[key] || []).forEach(fn => {
      try { fn(value); } catch (e) {}
    });
  }

  function _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_current));
    } catch (e) {}
    if (window.electronAPI?.setSettings) {
      window.electronAPI.setSettings(_current);
    }
  }

  return { init, get, set, onChange, dump };
})();
