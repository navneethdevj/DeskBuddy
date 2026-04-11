/**
 * Timer — Focus Health Meter
 *
 * NOT a wall-clock countdown. The timer's speed is driven by the user's
 * real attention level (window.Brain.getFocusLevel()). When distracted it
 * slows to a crawl; when focused it runs at full speed. This makes the
 * remaining time feel precious and makes focus viscerally rewarding.
 *
 * Architecture — fixed 100ms interval with accumulator (critical):
 *   WRONG: varying setInterval speed → math drift, skipped ticks.
 *   RIGHT: fixed 100ms tick, scale the accumulator increment by multiplier.
 *   Real tick fires whenever accumulated ms crosses a 1000ms boundary —
 *   gap between real ticks varies (600ms in DRIFTING, ~12s in CRITICAL),
 *   which feels organic rather than mechanical.
 *
 * CSS variables are set on document.documentElement so any element in the
 * document tree can consume them — no inline styles in JS.
 */
const Timer = (() => {

  // ── State constants ────────────────────────────────────────────────────────
  // Each state has a threshold that must be held continuously before the
  // timer moves into it, preventing flicker when focus briefly bounces.

  const STATE = {
    FOCUSED:    'FOCUSED',     // focusLevel >= 30 (NORMAL)                 → 1.0x
    DRIFTING:   'DRIFTING',    // focusLevel 20–29 for >= 7s continuous     → 0.7x
    DISTRACTED: 'DISTRACTED',  // focusLevel < 20 for >= 12s continuous     → 0.35x
    CRITICAL:   'CRITICAL',    // focusLevel < 12 for >= 25s continuous     → 0.08x
    FAILED:     'FAILED',      // CRITICAL held >= 60s                      → 0x (session lost)
  };

  // Multiplier applied to the 100ms accumulator increment.
  // FAILED is 0 so the timer stops completely.
  const MULTIPLIER = {
    [STATE.FOCUSED]:    1.00,
    [STATE.DRIFTING]:   0.70,
    [STATE.DISTRACTED]: 0.35,
    [STATE.CRITICAL]:   0.08,
    [STATE.FAILED]:     0.00,
  };

  // Minimum continuous seconds at a degraded focus level before entering state.
  // Recovery going upward also respects MIN_HOLD_RECOVERY to prevent bounce.
  // NOTE: These are the fallback defaults only. When Brain is available,
  // _pollFocus() uses thr.holdDrifting / holdDistracted / holdCritical / holdFailed
  // from getSensitivityThresholds() so the holds scale with the chosen preset.
  const ENTRY_HOLD = {
    [STATE.DRIFTING]:   7,   // NORMAL-preset default
    [STATE.DISTRACTED]: 12,
    [STATE.CRITICAL]:   25,
    [STATE.FAILED]:     60,
  };

  // Minimum seconds of improved focus before stepping *up* one recovery level.
  const MIN_HOLD_RECOVERY = 3;  // prevents flicker when focus bounces at boundary

  // CSS variable names written to document.documentElement per state.
  // JS reads state → looks up here → sets vars. No inline styles, ever.
  const CSS_VARS = {
    [STATE.FOCUSED]:    { '--timer-color': 'white',   '--timer-glow-color': 'transparent',  '--timer-shake-px': '0px', '--timer-pulse-speed': 'none' },
    [STATE.DRIFTING]:   { '--timer-color': '#ffbb44', '--timer-glow-color': '#ffbb4433',    '--timer-shake-px': '1px', '--timer-pulse-speed': '3s'   },
    [STATE.DISTRACTED]: { '--timer-color': '#ff4444', '--timer-glow-color': '#ff444433',    '--timer-shake-px': '2px', '--timer-pulse-speed': '1.2s' },
    [STATE.CRITICAL]:   { '--timer-color': '#ff4444', '--timer-glow-color': '#ff444433',    '--timer-shake-px': '3px', '--timer-pulse-speed': '0.6s' },
    [STATE.FAILED]:     { '--timer-color': '#555555', '--timer-glow-color': 'none',         '--timer-shake-px': '0px', '--timer-pulse-speed': 'none' },
  };

  // ── Private state ──────────────────────────────────────────────────────────

  let _initialSeconds   = 0;     // duration set by init()
  let _remainingSeconds = 0;     // counts down toward 0
  let _accumulated      = 0;     // sub-second ms accumulator (see architecture note)
  let _tickMultiplier   = MULTIPLIER[STATE.FOCUSED];

  let _currentState     = STATE.FOCUSED;
  let _running          = false;

  // Real-time delta tracking — prevents accumulator drift under CPU load and
  // tab-sleep jumps (capped at 200ms per tick so a sleeping tab can't jump seconds).
  let _lastTick = 0;

  // Interval handles — cleared on pause/reset to avoid orphaned intervals
  let _tickInterval       = null;  // fixed 100ms accumulator ticker
  let _focusPollInterval  = null;  // 500ms focus level sampler

  // State entry/recovery hold tracking.
  // Each potential next-state has its own continuous-seconds counter so
  // transitions in different directions don't share the same clock.
  let _distractionTimer = 0;  // seconds continuously below the current DRIFTING threshold
  let _criticalTimer    = 0;  // seconds continuously in CRITICAL (to detect FAILED)
  let _recoveryHold     = 0;  // seconds continuously at improved focus (for recovery step)

  // Callbacks
  let _tickCallbacks        = [];  // fn() — called each logical timer-second
  let _stateChangeCallbacks = [];  // fn(newState, oldState) — called on transition

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Set up the timer for a session of durationMinutes.
   * Does NOT start ticking — call start() after init().
   */
  function init(durationMinutes) {
    _stop();
    _initialSeconds   = durationMinutes * 60;
    _remainingSeconds = _initialSeconds;
    _accumulated      = 0;
    _currentState     = STATE.FOCUSED;
    _tickMultiplier   = MULTIPLIER[STATE.FOCUSED];
    _running          = false;
    _distractionTimer = 0;
    _criticalTimer    = 0;
    _recoveryHold     = 0;
    // Write initial CSS state silently (no callbacks fired)
    Object.entries(CSS_VARS[STATE.FOCUSED]).forEach(([k, v]) =>
      document.documentElement.style.setProperty(k, v));
  }

  /**
   * Begin the session. Starts both the tick accumulator and the focus poller.
   */
  function start() {
    if (_running) return;
    _running = true;
    _lastTick = Date.now();
    _tickInterval      = setInterval(_tick,      100);
    _focusPollInterval = setInterval(_pollFocus, 500);
    // Poll immediately so the correct state is set from the first tick,
    // not 500ms later (prevents free-focused period when focus is already low).
    _pollFocus();
  }

  /**
   * Pause — freeze tick accumulator and focus poller.
   * State and remaining time are preserved.
   */
  function pause() {
    _stop();
  }

  /**
   * Resume from a paused state. Restarts accumulator and focus poller.
   */
  function resume() {
    start();
  }

  /**
   * Reset to initial duration and FOCUSED state without starting.
   * Clears all intervals and resets every counter.
   */
  function reset() {
    _stop();
    _remainingSeconds = _initialSeconds;
    _accumulated      = 0;
    _distractionTimer = 0;
    _criticalTimer    = 0;
    _recoveryHold     = 0;
    _applyState(STATE.FOCUSED);
  }

  /** Return the current state string (one of STATE.*). */
  function getState() {
    return _currentState;
  }

  /** Return remaining time in integer seconds. */
  function getRemainingSeconds() {
    return _remainingSeconds;
  }

  /**
   * Register a callback fired each logical timer-second (wall-clock gap varies
   * by multiplier — that irregular cadence is intentional).
   */
  function onTick(fn) {
    _tickCallbacks.push(fn);
  }

  /**
   * Register a callback fired on every state transition.
   * Signature: fn(newState, oldState)
   */
  function onStateChange(fn) {
    _stateChangeCallbacks.push(fn);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Internal stop — clears intervals, marks not running. */
  function _stop() {
    _running = false;
    if (_tickInterval)      { clearInterval(_tickInterval);      _tickInterval      = null; }
    if (_focusPollInterval) { clearInterval(_focusPollInterval); _focusPollInterval = null; }
  }

  /** Fixed 100ms accumulator tick — uses real elapsed time with 200ms cap. */
  function _tick() {
    if (!_running) return;
    const now   = Date.now();
    const delta = Math.min(now - _lastTick, 200); // cap prevents tab-sleep jumps
    _lastTick   = now;
    _accumulated += delta * _tickMultiplier;
    if (_accumulated >= 1000) {
      _accumulated -= 1000;
      _fireTick();
    }
  }

  /**
   * _pollFocus — called every 500ms while running.
   *
   * Reads Brain.getFocusLevel() (0–100) and the current sensitivity thresholds
   * (via Brain.getSensitivityThresholds()), then steps state up or down as
   * warranted.  Each direction is gated by continuous hold timers to prevent
   * rapid flicker when focus bounces at a boundary.
   *
   * Downward path:  FOCUSED → DRIFTING → DISTRACTED → CRITICAL → FAILED
   * Recovery path:  FAILED is terminal.
   *                 CRITICAL → DISTRACTED → DRIFTING → FOCUSED
   *                 Each upward step requires MIN_HOLD_RECOVERY continuous seconds.
   */
  function _pollFocus() {
    if (!_running || _currentState === STATE.FAILED) return;

    const level = window.Brain ? Brain.getFocusLevel() : 50;
    const thr   = (window.Brain?.getSensitivityThresholds?.())
                  || { drifting: 30, distracted: 20, critical: 12,
                       holdDrifting: 7, holdDistracted: 12, holdCritical: 25, holdFailed: 60 };

    // Resolve hold values from sensitivity preset, falling back to ENTRY_HOLD constants.
    const holdDrifting   = thr.holdDrifting   ?? ENTRY_HOLD[STATE.DRIFTING];
    const holdDistracted = thr.holdDistracted ?? ENTRY_HOLD[STATE.DISTRACTED];
    const holdCritical   = thr.holdCritical   ?? ENTRY_HOLD[STATE.CRITICAL];
    const holdFailed     = thr.holdFailed     ?? ENTRY_HOLD[STATE.FAILED];

    const HALF = 0.5; // 500ms poll = 0.5s per call

    // ── Already in CRITICAL: count toward FAILED, or recover to DISTRACTED ──
    if (_currentState === STATE.CRITICAL) {
      if (level < thr.critical) {
        _criticalTimer += HALF;
        _recoveryHold   = 0;
        _distractionTimer = 0;
        if (_criticalTimer >= holdFailed) {
          _applyState(STATE.FAILED);
          _stop();
        }
      } else {
        _recoveryHold += HALF;
        _criticalTimer = 0;
        _distractionTimer = 0;
        if (_recoveryHold >= MIN_HOLD_RECOVERY) {
          _applyState(STATE.DISTRACTED);
          _recoveryHold = 0;
        }
      }
      return;
    }

    // ── Already in DISTRACTED: deepen to CRITICAL, or recover to DRIFTING ──
    if (_currentState === STATE.DISTRACTED) {
      if (level < thr.critical) {
        _distractionTimer += HALF;
        _criticalTimer    += HALF;
        _recoveryHold      = 0;
        if (_distractionTimer >= holdCritical) {
          _applyState(STATE.CRITICAL);
          _distractionTimer = 0;
        }
      } else if (level < thr.distracted) {
        // Stable in DISTRACTED range — reset both timers
        _distractionTimer = 0;
        _criticalTimer    = 0;
        _recoveryHold     = 0;
      } else {
        _distractionTimer = 0;
        _criticalTimer    = 0;
        _recoveryHold    += HALF;
        if (_recoveryHold >= MIN_HOLD_RECOVERY) {
          _applyState(STATE.DRIFTING);
          _recoveryHold = 0;
        }
      }
      return;
    }

    // ── Already in DRIFTING: deepen to DISTRACTED, or recover to FOCUSED ──
    if (_currentState === STATE.DRIFTING) {
      if (level < thr.distracted) {
        _distractionTimer += HALF;
        _recoveryHold      = 0;
        if (_distractionTimer >= holdDistracted) {
          _applyState(STATE.DISTRACTED);
          _distractionTimer = 0;
        }
      } else if (level < thr.drifting) {
        // Stable in DRIFTING range
        _distractionTimer = 0;
        _recoveryHold     = 0;
      } else {
        _distractionTimer = 0;
        _recoveryHold    += HALF;
        if (_recoveryHold >= MIN_HOLD_RECOVERY) {
          _applyState(STATE.FOCUSED);
          _recoveryHold = 0;
        }
      }
      return;
    }

    // ── FOCUSED: enter DRIFTING if focus drops below drifting threshold ─────
    if (level < thr.drifting) {
      _distractionTimer += HALF;
      _recoveryHold      = 0;
      if (_distractionTimer >= holdDrifting) {
        _applyState(STATE.DRIFTING);
        _distractionTimer = 0;
      }
    } else {
      _distractionTimer = 0;
      _recoveryHold     = 0;
    }
  }

  /**
   * _applyState — transition to newState if it differs from _currentState.
   *
   * Responsibilities:
   *   1. Set _currentState and _tickMultiplier.
   *   2. Write CSS_VARS[newState] to document.documentElement.
   *   3. Fire all _stateChangeCallbacks(newState, oldState).
   *
   * Idempotent: calling with the current state is a no-op.
   */
  function _applyState(newState) {
    if (newState === _currentState) return;
    const oldState  = _currentState;
    _currentState   = newState;
    _tickMultiplier = MULTIPLIER[newState];
    const vars = CSS_VARS[newState];
    if (vars) {
      Object.entries(vars).forEach(([k, v]) =>
        document.documentElement.style.setProperty(k, v));
    }
    _stateChangeCallbacks.forEach(fn => { try { fn(newState, oldState); } catch (e) {} });
  }

  /**
   * _fmtSecs(secs) — format a seconds value as H:MM:SS (hours omitted when 0).
   */
  function _fmtSecs(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * _fireTick — called each time the accumulated ms crosses a 1000ms boundary.
   *
   * Responsibilities:
   *   1. Decrement _remainingSeconds (floor at 0).
   *   2. Fire all _tickCallbacks.
   *   3. If _remainingSeconds reaches 0 and state is not FAILED, enter FAILED.
   */
  function _fireTick() {
    _remainingSeconds = Math.max(0, _remainingSeconds - 1);
    _tickCallbacks.forEach(fn => { try { fn(); } catch (e) {} });

    // Update the timer display element if present
    const timerEl = document.getElementById('session-timer');
    if (timerEl) {
      timerEl.textContent = _fmtSecs(_remainingSeconds);
    }

    if (_remainingSeconds <= 0 && _currentState !== STATE.FAILED) {
      _applyState(STATE.FAILED);
      _stop();
    }
  }

  // ── Public surface ─────────────────────────────────────────────────────────

  return {
    init,
    start,
    pause,
    resume,
    reset,
    getState,
    getRemainingSeconds,
    onTick,
    onStateChange,
    // Expose constants for external use (e.g. brain.js reacting to FAILED)
    STATE,
  };

})();
