/**
 * Session — Study session lifecycle manager.
 *
 * Sits above timer.js. Manages the full study session lifecycle including
 * goals, break budget, localStorage history, and outcome logging.
 *
 * States:   IDLE → ACTIVE → PAUSED → COMPLETED | FAILED | ABANDONED
 *
 * Session listens to Timer.onStateChange() — does NOT read brain.js directly.
 * FAILED outcome from Timer has two paths:
 *   - oldState === 'CRITICAL'  → distraction-based failure (session FAILED)
 *   - oldState !== 'CRITICAL'  → timer naturally ran to 0 (session COMPLETED)
 *
 * localStorage key: 'deskbuddy_sessions'.  Max 50 sessions; oldest dropped.
 * Break budget: 5 min.  Auto-FAIL if break exceeds 2× (10 min).
 */
const Session = (() => {

  // ── Constants ─────────────────────────────────────────────────────────────

  const _MAX_SESSIONS    = 50;
  const _BREAK_BUDGET_MS = 5 * 60 * 1000;          // 5 minutes
  const _BREAK_MAX_MS    = 2 * _BREAK_BUDGET_MS;    // 10 minutes → auto-fail
  const _STORAGE_KEY     = 'deskbuddy_sessions';

  const STATE = {
    IDLE:      'IDLE',
    ACTIVE:    'ACTIVE',
    PAUSED:    'PAUSED',
    COMPLETED: 'COMPLETED',
    FAILED:    'FAILED',
    ABANDONED: 'ABANDONED',
  };

  // ── Private state ──────────────────────────────────────────────────────────

  let _state      = STATE.IDLE;
  let _current    = null;   // session object in progress
  let _breakTimer = null;   // setInterval ID for break budget overflow check
  let _breakStartMs = null; // wall-clock ms when break began

  // Focus tracking (only during ACTIVE state)
  let _focusedSince = null;  // ms when current FOCUSED timer-state began
  let _streakStart  = null;  // ms when current focused streak began (resets on distraction)

  let _history  = [];  // array of completed session objects loaded from localStorage

  // Callbacks registered by external callers
  const _callbacks = {
    onSessionStateChange: [],  // fn(newState, oldState)
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _now() { return Date.now(); }

  function _setState(newState) {
    const oldState = _state;
    _state = newState;
    _callbacks.onSessionStateChange.forEach(fn => {
      try { fn(newState, oldState); } catch (_) {}
    });
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  function _loadFromStorage() {
    try {
      const raw = localStorage.getItem(_STORAGE_KEY);
      _history = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(_history)) _history = [];
    } catch (e) {
      _history = [];
    }
  }

  function _saveToStorage() {
    const _attemptSave = () => {
      localStorage.setItem(_STORAGE_KEY, JSON.stringify(_history));
    };
    try {
      _attemptSave();
    } catch (e) {
      // Quota exceeded — drop the oldest 10 sessions and retry once
      if (_history.length > 10) {
        _history = _history.slice(0, _history.length - 10);
        try { _attemptSave(); } catch (_) { /* give up silently */ }
      }
    }
  }

  function _pushSession(session) {
    _history.unshift(session);
    if (_history.length > _MAX_SESSIONS) {
      _history = _history.slice(0, _MAX_SESSIONS);
    }
    _saveToStorage();
  }

  // ── Break timer ────────────────────────────────────────────────────────────

  function _stopBreakTimer() {
    if (_breakTimer !== null) {
      clearTimeout(_breakTimer);
      _breakTimer = null;
    }
    _breakStartMs = null;
  }

  // ── Focus streak accounting ────────────────────────────────────────────────

  /**
   * Close off the current FOCUSED streak: add its duration to actualFocusedSeconds
   * and update longestFocusStreakSeconds. Clears _focusedSince.
   */
  function _closeFocusedStreak() {
    if (_focusedSince === null || !_current) return;
    const duration = (_now() - _focusedSince) / 1000;
    _current.actualFocusedSeconds += duration;
    if (duration > _current.longestFocusStreakSeconds) {
      _current.longestFocusStreakSeconds = duration;
    }
    _focusedSince = null;
  }

  // ── Core timer state listener ─────────────────────────────────────────────

  /**
   * _onTimerStateChange(newState, oldState)
   * Registered with Timer.onStateChange(). Drives session accounting.
   *
   * FOCUSED streak tracking:
   *   - Entering FOCUSED  → record _focusedSince, reset _streakStart
   *   - Leaving  FOCUSED  → close streak, accumulate time, update longest
   *
   * Distraction counting:
   *   - Entering DISTRACTED or CRITICAL from a better state → ++distractionCount
   *
   * Refocus sound:
   *   - Entering FOCUSED from DISTRACTED or CRITICAL → play 'refocus'
   *
   * Session outcome:
   *   - Timer enters FAILED + oldState was CRITICAL → session FAILED (distraction)
   *   - Timer enters FAILED + oldState was not CRITICAL → timer ran to 0 → COMPLETED
   */
  function _onTimerStateChange(newState, oldState) {
    if (_state !== STATE.ACTIVE) return;
    if (!_current) return;

    const TIMER_FOCUSED    = 'FOCUSED';
    const TIMER_DRIFTING   = 'DRIFTING';
    const TIMER_DISTRACTED = 'DISTRACTED';
    const TIMER_CRITICAL   = 'CRITICAL';
    const TIMER_FAILED     = 'FAILED';

    // ── Leaving FOCUSED ──────────────────────────────────────────────────────
    if (oldState === TIMER_FOCUSED && newState !== TIMER_FOCUSED) {
      _closeFocusedStreak();
      _streakStart = null;
    }

    // ── Entering FOCUSED ─────────────────────────────────────────────────────
    if (newState === TIMER_FOCUSED) {
      _focusedSince = _now();
      _streakStart  = _now();
      // Warm re-focus sound when returning from degraded state
      if (oldState === TIMER_DISTRACTED || oldState === TIMER_CRITICAL) {
        if (window.Sounds) Sounds.play('refocus');
      }
    }

    // ── Distraction events ───────────────────────────────────────────────────
    if ((newState === TIMER_DISTRACTED || newState === TIMER_CRITICAL) &&
        (oldState === TIMER_FOCUSED || oldState === TIMER_DRIFTING)) {
      _current.distractionCount++;
    }

    // ── Terminal: timer FAILED ────────────────────────────────────────────────
    if (newState === TIMER_FAILED) {
      // If the timer's remaining time reached zero it's a natural expiry → always COMPLETED.
      // CRITICAL held 45 s with time still on the clock → distraction failure → FAILED.
      const naturalExpiry = !!(window.Timer && Timer.getRemainingSeconds() === 0);
      _endSession((naturalExpiry || oldState !== TIMER_CRITICAL) ? 'COMPLETED' : 'FAILED');
    }
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────

  /**
   * _endSession(outcome)
   * Finalize the in-progress session: flush streak, save, fire sound, update state.
   * outcome: 'COMPLETED' | 'FAILED' | 'ABANDONED'
   */
  function _endSession(outcome) {
    if (!_current) return;

    _closeFocusedStreak();
    _stopBreakTimer();

    _current.outcome = outcome;
    _pushSession(Object.assign({}, _current));

    // Play appropriate lifecycle sound
    if (window.Sounds) {
      if (outcome === 'COMPLETED') Sounds.play('session_complete');
      else if (outcome === 'FAILED') Sounds.play('session_fail');
      // ABANDONED: silent — user chose to quit
    }

    _current      = null;
    _focusedSince = null;
    _streakStart  = null;

    _setState(STATE[outcome]);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * init() — load localStorage, register with Timer.
   * Must be called once after Timer is available (at app startup).
   */
  function init() {
    _loadFromStorage();
    if (window.Timer && Timer.onStateChange) {
      Timer.onStateChange(_onTimerStateChange);
    }
  }

  /**
   * startNew(mins, goal?) — begin a new session.
   * @param {number} mins   — intended session duration in minutes
   * @param {string} [goal] — optional goal text (max 100 chars)
   */
  function startNew(mins, goal) {
    if (_state === STATE.ACTIVE || _state === STATE.PAUSED) return;

    _current = {
      id:                        _now().toString(),
      date:                      new Date().toISOString(),
      durationMinutes:           mins,
      actualFocusedSeconds:      0,
      distractionCount:          0,
      longestFocusStreakSeconds:  0,
      outcome:                   null,
      goalText:                  (goal && goal.trim().slice(0, 100)) || null,
      goalAchieved:              null,
    };

    // Start counting focused time from session start (assume user is focused)
    _focusedSince = _now();
    _streakStart  = _now();

    _setState(STATE.ACTIVE);
    if (window.Sounds) Sounds.play('session_start');
  }

  /**
   * pause() — start a break.
   * Flushes current focused streak. Starts the break-budget watchdog.
   */
  function pause() {
    if (_state !== STATE.ACTIVE) return;

    _closeFocusedStreak();
    _streakStart = null;

    _breakStartMs = _now();

    // Schedule auto-fail at exactly the moment the break budget is exhausted.
    // One-shot setTimeout is more precise than polling (no ±interval overshoot).
    _breakTimer = setTimeout(() => {
      _breakTimer = null;
      _endSession('FAILED');
    }, _BREAK_MAX_MS);

    _setState(STATE.PAUSED);
    if (window.Sounds) Sounds.play('break_start');
  }

  /**
   * resume() — end break, return to active session.
   */
  function resume() {
    if (_state !== STATE.PAUSED) return;

    _stopBreakTimer();

    // Resume focused tracking from this moment
    _focusedSince = _now();
    _streakStart  = _now();

    _setState(STATE.ACTIVE);
    if (window.Sounds) Sounds.play('break_end');
  }

  /**
   * abandon() — user quits mid-session (no sound; already feels bad).
   */
  function abandon() {
    if (_state !== STATE.ACTIVE && _state !== STATE.PAUSED) return;
    _endSession('ABANDONED');
  }

  /**
   * setGoalAchieved(achieved) — record the goal outcome for the most recent session.
   * Called after the user answers "Did you finish it?" on the outcome screen.
   * @param {boolean} achieved
   */
  function setGoalAchieved(achieved) {
    if (!_history.length) return;
    _history[0].goalAchieved = achieved;
    _saveToStorage();
  }

  /**
   * getHistory() — return a copy of all past sessions, newest first.
   * @returns {Array}
   */
  function getHistory() {
    return _history.slice();
  }

  /**
   * getCurrentStats() — live stats for the in-progress session.
   * @returns {{ state, elapsed, focusedSeconds, distractionCount, streakSeconds, goalText } | null}
   *   elapsed: wall-clock seconds since session start (derived from Timer if available)
   *   focusedSeconds: total seconds in FOCUSED timer-state (includes current streak)
   *   streakSeconds:  current unbroken FOCUSED streak (0 if not in FOCUSED state)
   *   distractionCount: number of times user entered DISTRACTED/CRITICAL
   */
  function getCurrentStats() {
    if (!_current) return null;

    const isActive = (_state === STATE.ACTIVE);

    // Accumulate ongoing focused streak into snapshot total
    let focusedNow = _current.actualFocusedSeconds;
    if (isActive && _focusedSince !== null) {
      focusedNow += (_now() - _focusedSince) / 1000;
    }

    // Current unbroken streak (only meaningful while actively focused)
    let streakNow = 0;
    if (isActive && _streakStart !== null) {
      streakNow = (_now() - _streakStart) / 1000;
    }

    // Elapsed: derive from Timer if available; else 0 (caller can compute)
    let elapsed = 0;
    if (window.Timer && Timer.getRemainingSeconds) {
      const totalSeconds = _current.durationMinutes * 60;
      elapsed = Math.max(0, totalSeconds - Timer.getRemainingSeconds());
    }

    return {
      state:            _state,
      elapsed,
      focusedSeconds:   focusedNow,
      distractionCount: _current.distractionCount,
      streakSeconds:    streakNow,
      goalText:         _current.goalText,
    };
  }

  /**
   * getBreakTimeRemaining() — milliseconds of break budget left.
   * Returns full budget if not currently on a break.
   * Used by the timer display to show a break countdown.
   */
  function getBreakTimeRemaining() {
    if (_state !== STATE.PAUSED || _breakStartMs === null) return _BREAK_BUDGET_MS;
    return Math.max(0, _BREAK_BUDGET_MS - (_now() - _breakStartMs));
  }

  /**
   * onSessionStateChange(fn) — register a callback for session state transitions.
   * Signature: fn(newState, oldState)
   */
  function onSessionStateChange(fn) {
    _callbacks.onSessionStateChange.push(fn);
  }

  // ── Public surface ─────────────────────────────────────────────────────────

  return {
    init,
    startNew,
    pause,
    resume,
    abandon,
    setGoalAchieved,
    getHistory,
    getCurrentStats,
    getBreakTimeRemaining,
    onSessionStateChange,
    STATE,
    // Expose constants for UI
    BREAK_BUDGET_MS: _BREAK_BUDGET_MS,
    BREAK_MAX_MS:    _BREAK_MAX_MS,
  };

})();
