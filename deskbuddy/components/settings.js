/**
 * Settings — persistence module for DeskBuddy companion customisation.
 *
 * Reads from localStorage on init (synchronous, instant), then reconciles
 * with the main-process Store via IPC so settings survive localStorage clears.
 *
 * Usage:
 *   Settings.init();
 *   Settings.get('mutePreset');         // → 'ALL_ON'
 *   Settings.set('mutePreset', 'ALL_OFF');
 *   Settings.onChange('mutePreset', v => { /* react */ });
 */
const Settings = (() => {

  const STORAGE_KEY = 'deskbuddy_settings';

  const DEFAULTS = {
    mutePreset:      'ALL_ON',    // 'ALL_ON' | 'ESSENTIAL' | 'REMINDERS_ONLY' | 'ALL_OFF'
    droneEnabled:    true,        // ambient soundscape on/off
    brightness:      1.0,         // #world CSS filter brightness (0.3–1.0)
    breakInterval:   25,          // minutes, 0 = disabled
    sensitivity:     'NORMAL',    // 'GENTLE' | 'NORMAL' | 'STRICT'
    phoneDetection:  true,        // brain.js phone posture detection
    companionSize:   'M',         // 'S' | 'M' | 'L'
    nightAutoVolume: true,        // soundscape reduces volume at NIGHT
    keybinds:        {},          // override map: { [action_id]: 'KeyboardShortcut' }
  };

  let _current = { ...DEFAULTS };
  const _listeners = {};  // { key: [fn, fn, ...] }

  function init() {
    // Fast read from localStorage first (synchronous, instant)
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        _current = { ...DEFAULTS, ...saved };
      }
    } catch (e) {}

    // Then reconcile with main-process Store (survives localStorage clear)
    if (window.electronAPI && window.electronAPI.getSettings) {
      window.electronAPI.getSettings().then(saved => {
        if (!saved) return;
        _current = { ...DEFAULTS, ...saved };
        // Sync only localStorage — data came from the Store, no need to IPC back
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_current)); } catch (e) {}
        // Fire all listeners so UI reflects the reconciled values
        Object.keys(_current).forEach(key => _fire(key, _current[key]));
      }).catch(() => {});
    }
  }

  function get(key) {
    return _current[key] !== undefined ? _current[key] : DEFAULTS[key];
  }

  function set(key, value) {
    if (_current[key] === value) return;  // no-op if unchanged
    _current[key] = value;
    _persist();
    _fire(key, value);
  }

  function onChange(key, fn) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(fn);
  }

  function _fire(key, value) {
    (_listeners[key] || []).forEach(fn => { try { fn(value); } catch (e) {} });
  }

  function _persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_current)); } catch (e) {}
    if (window.electronAPI && window.electronAPI.setSettings) {
      window.electronAPI.setSettings(_current);
    }
  }

  // Export full settings object (for debug / export feature)
  function dump() { return { ..._current }; }

  return { init, get, set, onChange, dump };
})();
