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
    // ── Companion size (numeric %) ────────────────────────────────────────
    // 100 = original M scale, 78 = old S, 122 = old L. Slider range 50–200.
    companionSize:   100,
    nightAutoVolume: true,       // soundscape reduces volume at NIGHT
    sessionLength:   25,         // default session duration in minutes
    timerStep:       5,          // +/− step size in minutes for duration stepper
    ticksEnabled:       true,       // soft timer tick sounds on/off
    celebrationEnabled: true,       // confetti + banner on session complete
    breakAnimEnabled:   true,       // teal glow + break card when break starts
    keybinds:           {},         // override map: { [action_id]: 'KeyboardShortcut' }
    // ── Window behaviour ──────────────────────────────────────────────
    autoPipOnBlur:          true,  // collapse to PiP when the user switches to another app
    autoPipDelay:           0,     // seconds to wait before collapsing (0 = instant)
    autoPipRestore:         true,  // restore full mode when the user returns
    autoPipSkipSession:     false, // skip auto-collapse when a focus session is running
    pipShape:               'square', // 'square' | 'rounded' | 'circle'
    // ── Buddy personality ──────────────────────────────────────────────
    idleSpeed:              2,   // 1 = slow/calm, 3 = fast/hyper
    expressiveness:         2,   // 1 = subtle, 3 = maximum
    pettingMode:            2,   // 1 = gentle, 2 = default, 3 = eager
    emotionPreviewDuration: 3,   // seconds the "tap to preview" hold lasts (1–10)
    // ── DND ────────────────────────────────────────────────────────────
    dndDuration:            25,  // default duration in minutes (0 = infinite)
    // ── Screen Time features ────────────────────────────────────────────
    dailyFocusGoalMins:     0,   // 0 = disabled
    distractionBudget:      0,   // 0 = unlimited
    sessionCategory:        'study',
    weeklyReportLastShown:  '',
    // ── Anti-cheat ────────────────────────────────────────────────────
    antiCheatEnabled: true,
    // ── Buddy appearance ──────────────────────────────────────────────
    fullTheme:       'galaxy',
    themeParticles:  true,
    eyeColor:        'periwinkle',
    eyeGlowColor:    'default',
    eyeRoundness:    'round',
    // ── Eye / Face sizing (all numeric %, 100 = default) ──────────────
    eyeSize:         100,  // eye-wrap scale 50–200; 100 = default
    eyeGap:          6,    // gap between eyes in vmin (2–20); 6 = default
    irisSize:        100,  // iris scale within eye 50–130; 100 = default
    mouthSize:       100,  // mouth scale 50–150; 100 = default
    noseSize:        100,  // nose scale 50–150; 100 = default
    blinkRate:       'normal',
    showEyebrows:    true,
    noseStyle:       'triangle',
    mouthStyle:      'arc',
    mouthThickness:  'normal',
    // ── Glow ──────────────────────────────────────────────────────────
    // 'off' | 'subtle' | 'normal' | 'vivid'  (maps to slider 0-3)
    glowIntensity:   'normal',
    // ── PiP / Overlay ─────────────────────────────────────────────────
    pipOpacity:      78,         // 20–95 integer %
    pipAlwaysOnTop:  true,
    companionPos:    'center',   // 'left'|'center'|'right' (kept for legacy)
    // ── Custom colour overrides ────────────────────────────────────────
    customIrisHex:   '',         // hex string or '' for preset
    customIrisCenterHex: '',
    customIrisMidHex:    '',
    customIrisEdgeHex:   '',
    customIrisRingHex:   '',
    customIrisHighlightHex: '',
    customIrisPupilCoreHex: '',
    irisBorderEnabled: true,
    irisBorderThickness: 100, // % (50–200), 100 = default
    customGlowHex:   '',
    glowEmotionSync: true,
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

    // Migrate deprecated theme names to supported ones
    const VALID_THEMES = new Set(['galaxy', 'classic', 'forest', 'cherry', 'ocean',
                                   'midnight', 'snow', 'aurora']);
    if (!VALID_THEMES.has(_current.fullTheme)) _current.fullTheme = 'galaxy';

    // Migrate deprecated mouth style names
    const MOUTH_MIGRATE = { wave: 'arc', perky: 'wide', minimal: 'flat' };
    if (MOUTH_MIGRATE[_current.mouthStyle]) _current.mouthStyle = MOUTH_MIGRATE[_current.mouthStyle];

    // ── Numeric migrations (old string → new numeric) ──────────────────────
    // companionSize: 'S'/'M'/'L' → number
    if (typeof _current.companionSize === 'string') {
      _current.companionSize = ({ S: 78, M: 100, L: 122 })[_current.companionSize] ?? 100;
    }
    // pupilSize: 'small'/'normal'/'large' → eyeSize number (remove old key)
    if (typeof _current.pupilSize === 'string') {
      if (_current.eyeSize == null)
        _current.eyeSize = ({ small: 78, normal: 100, large: 130 })[_current.pupilSize] ?? 100;
      delete _current.pupilSize;
    }
    // eyeSpacing: 'narrow'/'normal'/'wide' → eyeGap vmin
    if (typeof _current.eyeSpacing === 'string') {
      if (_current.eyeGap == null)
        _current.eyeGap = ({ narrow: 3, normal: 6, wide: 11 })[_current.eyeSpacing] ?? 6;
      delete _current.eyeSpacing;
    }

    // Reconcile with main-process Store (survives localStorage clear)
    if (window.electronAPI?.getSettings) {
      window.electronAPI.getSettings().then(saved => {
        if (!saved) return;
        _current = { ...DEFAULTS, ...saved };
        if (!VALID_THEMES.has(_current.fullTheme)) _current.fullTheme = 'galaxy';
        if (MOUTH_MIGRATE[_current.mouthStyle]) _current.mouthStyle = MOUTH_MIGRATE[_current.mouthStyle];
        // Apply same numeric migrations after Electron Store reconcile
        if (typeof _current.companionSize === 'string')
          _current.companionSize = ({ S: 78, M: 100, L: 122 })[_current.companionSize] ?? 100;
        if (typeof _current.pupilSize === 'string') {
          if (_current.eyeSize == null)
            _current.eyeSize = ({ small: 78, normal: 100, large: 130 })[_current.pupilSize] ?? 100;
          delete _current.pupilSize;
        }
        if (typeof _current.eyeSpacing === 'string') {
          if (_current.eyeGap == null)
            _current.eyeGap = ({ narrow: 3, normal: 6, wide: 11 })[_current.eyeSpacing] ?? 6;
          delete _current.eyeSpacing;
        }
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

  // ── Export / Import ──────────────────────────────────────────────────────

  /**
   * exportSettings() — serialise the current settings to a JSON string.
   * Returns a wrapper object with metadata for validation on import.
   */
  function exportSettings() {
    const payload = {
      version:    1,
      exportedAt: new Date().toISOString(),
      appVersion: 'DeskBuddy',
      settings:   { ..._current },
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * importSettings(jsonString) — parse a JSON export and apply all settings.
   * Unknown keys are ignored; known keys are merged over current values.
   *
   * @returns {{ success: boolean, applied: number, reason?: string }}
   */
  function importSettings(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (_) {
      return { success: false, reason: 'Invalid JSON file.' };
    }

    if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
      return { success: false, reason: 'File does not contain settings data.' };
    }

    // Only apply keys that exist in DEFAULTS (ignore unknown / future keys)
    const knownKeys = Object.keys(DEFAULTS);
    const incoming  = parsed.settings;
    let applied = 0;

    knownKeys.forEach(key => {
      if (key in incoming) {
        _current[key] = incoming[key];
        _fire(key, _current[key]);
        applied++;
      }
    });

    _persist();
    return { success: true, applied };
  }

  /**
   * reset() — restore all settings to factory defaults and persist.
   */
  function reset() {
    _current = { ...DEFAULTS };
    _persist();
    Object.keys(_current).forEach(key => _fire(key, _current[key]));
  }

  return { init, get, set, onChange, dump, exportSettings, importSettings, reset };
})();
