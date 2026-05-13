/**
 * Settings — Persistence module for DeskBuddy companion customisation.
 *
 * Two-layer storage:
 *   1. localStorage — synchronous, instant read on init.
 *   2. Electron Store via IPC — survives localStorage clear; reconciled async.
 *
 * PERFORMANCE: _persist() is debounced 400ms so rapid Settings.set() calls
 * (e.g. sliders dragging) don't hammer localStorage or IPC on every frame.
 *
 * Usage:
 *   Settings.init()           — call once at startup
 *   Settings.get('key')       — synchronous read
 *   Settings.set('key', val)  — write + fire listeners + persist (debounced)
 *   Settings.resetKey('key')  — restore single key to default
 *   Settings.onChange(k, fn)  — subscribe to changes for key k
 *   Settings.dump()           — full snapshot for debug / export
 */
const Settings = (() => {

  const STORAGE_KEY = 'deskbuddy_settings';

  const DEFAULTS = {
    mutePreset:      'ALL_ON',
    volume:          0.7,
    droneEnabled:    true,
    brightness:      1.0,
    breakInterval:   25,
    sensitivity:     'NORMAL',
    phoneDetection:  true,
    companionSize:   100,
    nightAutoVolume: true,
    sessionLength:   25,
    timerStep:       5,
    ticksEnabled:       true,
    celebrationEnabled: true,
    breakAnimEnabled:   true,
    keybinds:           {},
    autoPipOnBlur:          true,
    autoPipDelay:           0,
    autoPipRestore:         true,
    autoPipSkipSession:     false,
    pipShape:               'square',
    // ── Buddy personality (legacy 1-3 scale — migrated to 1-10 on load) ──
    idleSpeed:              5,
    expressiveness:         5,
    pettingMode:            5,
    emotionPreviewDuration: 3,
    // ── Personality Studio extended dimensions ─────────────────────────
    spontaneousFreq:  5,
    reactionSpeed:    5,
    affectionLevel:   5,
    jealousyLevel:    3,
    forgivenessSpeed: 6,
    encourageFreq:    5,
    distractPatience: 5,
    talkative:        5,
    voicePitch:       5,
    whisperStyle:     'cute',
    // Special behaviours
    nightOwlMode:     false,
    morningCheerful:  true,
    streakCelebrate:  true,
    waveReaction:     true,
    multiPersonReact: true,
    memoryWhispers:   true,
    flowStateEnabled: true,
    // Emotion sensitivity
    emo_happy:   5,
    emo_sad:     5,
    emo_fear:    5,
    emo_curious: 6,
    emo_love:    5,
    emo_grumpy:  5,
    emo_shy:     5,
    emo_excited: 5,
    // ── DND ────────────────────────────────────────────────────────────
    dndDuration:            25,
    // ── Screen Time ────────────────────────────────────────────────────
    dailyFocusGoalMins:     0,
    distractionBudget:      0,
    sessionCategory:        'study',
    weeklyReportLastShown:  '',
    antiCheatEnabled: true,
    // ── Buddy appearance ──────────────────────────────────────────────
    fullTheme:       'galaxy',
    themeParticles:  true,
    eyeColor:        'periwinkle',
    eyeGlowColor:    'default',
    eyeRoundness:    'round',
    eyeSize:         100,
    eyeGap:          6,
    irisSize:        100,
    mouthSize:       100,
    noseSize:        100,
    blinkRate:       'normal',
    showEyebrows:    true,
    showWhiskers:    true,
    noseStyle:       'triangle',
    mouthStyle:      'arc',
    mouthThickness:  'normal',
    glowIntensity:   'normal',
    // ── PiP ───────────────────────────────────────────────────────────
    pipOpacity:      78,
    pipAlwaysOnTop:         true,
    pipSnapEnabled:         true,
    pipLocked:              false,
    pipBorderStyle:         'glow',
    pipBorderColor:         '#8a93ff',
    pipBorderColor2:        '#ff79b0',
    pipBorderThickness:     2,
    pipBorderOpacity:       85,
    pipGlowSize:            55,
    pipGlowSoftness:        50,
    pipAnimEnabled:         true,
    pipAnimSpeed:           50,
    pipHoverGlow:           true,
    pipEmotionSync:         true,
    pipVisualPreset:        'default',
    companionPos:    'center',
    // ── Custom colours ─────────────────────────────────────────────────
    customIrisHex:   '',
    customIrisCenterHex: '',
    customIrisMidHex:    '',
    customIrisEdgeHex:   '',
    customIrisRingHex:   '',
    customIrisHighlightHex: '',
    customIrisPupilCoreHex: '',
    irisBorderEnabled: true,
    irisBorderThickness: 100,
    customGlowHex:   '',
    glowEmotionSync: true,
  };

  let _current = { ...DEFAULTS };
  const _listeners = {};

  // ── Debounced persist ─────────────────────────────────────────────────────
  // Prevents rapid Settings.set() calls (e.g. slider drag) from hammering
  // localStorage or firing Electron IPC on every frame.
  let _persistTimer = null;
  const PERSIST_DEBOUNCE = 400; // ms

  function _schedulePersist() {
    clearTimeout(_persistTimer);
    _persistTimer = setTimeout(_persist, PERSIST_DEBOUNCE);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        _current = { ...DEFAULTS, ...saved };
      }
    } catch (e) {}

    // Theme validation
    const VALID_THEMES = new Set(['galaxy','classic','forest','cherry','ocean',
                                   'midnight','snow','aurora']);
    if (!VALID_THEMES.has(_current.fullTheme)) _current.fullTheme = 'galaxy';

    // Mouth migration
    const MOUTH_MIGRATE = { wave:'arc', perky:'wide', minimal:'flat' };
    if (MOUTH_MIGRATE[_current.mouthStyle]) _current.mouthStyle = MOUTH_MIGRATE[_current.mouthStyle];

    // companionSize: 'S'/'M'/'L' → number
    if (typeof _current.companionSize === 'string') {
      _current.companionSize = ({ S:78, M:100, L:122 })[_current.companionSize] ?? 100;
    }
    // pupilSize → eyeSize
    if (typeof _current.pupilSize === 'string') {
      if (_current.eyeSize == null)
        _current.eyeSize = ({ small:78, normal:100, large:130 })[_current.pupilSize] ?? 100;
      delete _current.pupilSize;
    }
    // eyeSpacing → eyeGap
    if (typeof _current.eyeSpacing === 'string') {
      if (_current.eyeGap == null)
        _current.eyeGap = ({ narrow:3, normal:6, wide:11 })[_current.eyeSpacing] ?? 6;
      delete _current.eyeSpacing;
    }

    // ── Migrate old 1-3 personality scale to new 1-10 ─────────────────────
    // Old UI sent integer 1/2/3; new slider is 1-10.
    // Detect old style: integer in [1,3] AND was saved as that int (not 4+).
    // Map: 1→2 (very calm), 2→5 (default), 3→9 (hyper)
    const _migrateScale = (key, map) => {
      const v = _current[key];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3 &&
          DEFAULTS[key] >= 4) {
        // Only migrate if the DEFAULTS for this key is 4+ (i.e. new 1-10 range)
        _current[key] = map[v] || 5;
      }
    };
    _migrateScale('idleSpeed',      { 1:2, 2:5, 3:9 });
    _migrateScale('expressiveness', { 1:2, 2:5, 3:9 });
    _migrateScale('pettingMode',    { 1:2, 2:5, 3:9 });

    // Electron Store reconcile (async, non-blocking)
    if (window.electronAPI?.getSettings) {
      window.electronAPI.getSettings().then(saved => {
        if (!saved) return;
        _current = { ...DEFAULTS, ...saved };
        if (!VALID_THEMES.has(_current.fullTheme)) _current.fullTheme = 'galaxy';
        if (MOUTH_MIGRATE[_current.mouthStyle]) _current.mouthStyle = MOUTH_MIGRATE[_current.mouthStyle];
        if (typeof _current.companionSize === 'string')
          _current.companionSize = ({ S:78, M:100, L:122 })[_current.companionSize] ?? 100;
        _migrateScale('idleSpeed',      { 1:2, 2:5, 3:9 });
        _migrateScale('expressiveness', { 1:2, 2:5, 3:9 });
        _migrateScale('pettingMode',    { 1:2, 2:5, 3:9 });
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
    _schedulePersist();   // ← debounced, not immediate
    _fire(key, value);
  }

  /** Restore one key to its factory default. */
  function resetKey(key) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      set(key, DEFAULTS[key]);
    }
  }

  function onChange(key, fn) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(fn);
  }

  function dump() { return { ..._current }; }

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

  // ── Export / Import ───────────────────────────────────────────────────────
  function exportSettings() {
    const payload = {
      version:    1,
      exportedAt: new Date().toISOString(),
      appVersion: 'DeskBuddy',
      settings:   { ..._current },
    };
    return JSON.stringify(payload, null, 2);
  }

  function importSettings(jsonString) {
    let parsed;
    try { parsed = JSON.parse(jsonString); }
    catch (_) { return { success: false, reason: 'Invalid JSON file.' }; }

    if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings))
      return { success: false, reason: 'File does not contain settings data.' };

    const knownKeys = Object.keys(DEFAULTS);
    const incoming  = parsed.settings;
    let applied = 0;
    knownKeys.forEach(key => {
      if (key in incoming) { _current[key] = incoming[key]; _fire(key, _current[key]); applied++; }
    });
    _persist();
    return { success: true, applied };
  }

  function reset() {
    _current = { ...DEFAULTS };
    _persist();
    Object.keys(_current).forEach(key => _fire(key, _current[key]));
  }

  return { init, get, set, resetKey, onChange, dump, exportSettings, importSettings, reset };
})();
