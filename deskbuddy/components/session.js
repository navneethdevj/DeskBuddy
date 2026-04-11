/**
 * Session — Study session lifecycle manager.
 *
 * Sits above timer.js. Manages the full study session lifecycle including
 * goals, break tracking, localStorage history, and outcome logging.
 *
 * States:   IDLE → ACTIVE → PAUSED → COMPLETED | FAILED | ABANDONED
 *
 * Session listens to Timer.onStateChange() — does NOT read brain.js directly.
 * FAILED outcome from Timer has two paths:
 *   - oldState === 'CRITICAL'  → distraction-based failure (session FAILED)
 *   - oldState !== 'CRITICAL'  → timer naturally ran to 0 (session COMPLETED)
 *
 * Breaks have no time limit — the user may take a break of any duration and
 * resume whenever they are ready.
 *
 * localStorage key: 'deskbuddy_sessions'.  Max 50 sessions; oldest dropped.
 *
 * Focus timeline: samples { t, level, state } every 5 s during ACTIVE state.
 * Milestones: { t, type } events (distraction, break_start, break_end, milestone_Xm).
 * Timeline/milestones are stripped from all but the most recent stored session
 * to keep localStorage usage low (≈12 KB max per recent session).
 */
const Session = (() => {

  // ── Constants ─────────────────────────────────────────────────────────────

  const _MAX_SESSIONS   = 50;
  const _STORAGE_KEY    = 'deskbuddy_sessions';
  const _SAMPLE_RATE_MS = 5000;   // one focus-level sample every 5 s
  const _MAX_SAMPLES    = 720;    // cap: 1 hr session at 5 s/sample

  const STATE = {
    IDLE:      'IDLE',
    ACTIVE:    'ACTIVE',
    PAUSED:    'PAUSED',
    COMPLETED: 'COMPLETED',
    FAILED:    'FAILED',
    ABANDONED: 'ABANDONED',
  };

  // ── Private state ──────────────────────────────────────────────────────────

  let _state        = STATE.IDLE;
  let _current      = null;   // session object in progress
  let _breakStartMs = null;   // wall-clock ms when break began

  // Focus tracking (only during ACTIVE state)
  let _focusedSince = null;  // ms when current FOCUSED timer-state began
  let _streakStart  = null;  // ms when current focused streak began (resets on distraction)

  // Timeline sampler
  let _sampleInterval = null;

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
    // Strip focusTimeline + milestones from all previously stored sessions —
    // only the most-recent (index 0) needs the full timeline for the graph.
    _history = _history.map(s => {
      if (!s.focusTimeline && !s.milestones) return s;
      const { focusTimeline, milestones, ...rest } = s; // eslint-disable-line no-unused-vars
      return rest;
    });
    _history.unshift(session);
    if (_history.length > _MAX_SESSIONS) {
      _history = _history.slice(0, _MAX_SESSIONS);
    }
    _saveToStorage();
  }

  // ── Break tracking ─────────────────────────────────────────────────────────

  function _clearBreakStart() {
    _breakStartMs = null;
  }

  // ── Focus timeline sampler ─────────────────────────────────────────────────

  /** Elapsed seconds since session start (derived from Timer remaining time). */
  function _elapsedSeconds() {
    if (!_current) return 0;
    if (window.Timer && Timer.getRemainingSeconds) {
      return Math.max(0, _current.durationMinutes * 60 - Timer.getRemainingSeconds());
    }
    return 0;
  }

  /**
   * _startSampler() — begin recording { t, level, state } at _SAMPLE_RATE_MS.
   * Called on ACTIVE entry (startNew + resume). No-op if already running.
   */
  function _startSampler() {
    if (_sampleInterval) return;
    _sampleInterval = setInterval(() => {
      if (_state !== STATE.ACTIVE || !_current) return;
      const elapsed = Math.round(_elapsedSeconds());
      const level   = Math.round(window.Brain?.getFocusLevel?.() ?? 50);
      const state   = window.Timer?.getState?.()   || 'FOCUSED';
      _current.focusTimeline.push({ t: elapsed, level, state });
      if (_current.focusTimeline.length > _MAX_SAMPLES) {
        _current.focusTimeline.shift();
      }
    }, _SAMPLE_RATE_MS);
  }

  /** _stopSampler() — stop sampling. Called on PAUSED and terminal states. */
  function _stopSampler() {
    if (_sampleInterval) { clearInterval(_sampleInterval); _sampleInterval = null; }
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
      // Record distraction milestone on the timeline
      _current.milestones.push({ t: Math.round(_elapsedSeconds()), type: 'distraction' });
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

    _stopSampler();
    _closeFocusedStreak();
    _clearBreakStart();

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
      focusTimeline:             [],   // { t, level, state } samples every 5 s
      milestones:                [],   // { t, type } event markers
    };

    // Start counting focused time from session start (assume user is focused)
    _focusedSince = _now();
    _streakStart  = _now();

    _setState(STATE.ACTIVE);
    if (window.Sounds) Sounds.play('session_start');
    _startSampler();

    // ── Time-of-day awareness ──────────────────────────────────────────────
    if (window.Brain) {
      const period = Brain.getTimePeriod();
      Brain.applyTimePeriod(period);
      if (window.Soundscape) Soundscape.setTimeTint(period);

      if (period === 'NIGHT') {
        Brain.trackNightSession();
        Brain.checkNightWhisper();
      } else {
        Brain.resetNightSessions();
      }

      if (period === 'MORNING') {
        // Small delay so session_start sound plays first
        setTimeout(() => Brain.doMorningGreeting(), 600);
      }
    }
  }

  /**
   * pause() — start a break.
   * Flushes current focused streak. Breaks have no time limit — the session
   * remains paused until the user explicitly calls resume() or abandon().
   */
  function pause() {
    if (_state !== STATE.ACTIVE) return;

    _stopSampler();
    _closeFocusedStreak();
    _streakStart = null;

    _breakStartMs = _now();

    // Mark break start on the timeline
    if (_current) {
      _current.milestones.push({ t: Math.round(_elapsedSeconds()), type: 'break_start' });
    }

    _setState(STATE.PAUSED);
    if (window.Sounds) Sounds.play('break_start');
  }

  /**
   * resume() — end break, return to active session.
   */
  function resume() {
    if (_state !== STATE.PAUSED) return;

    _clearBreakStart();

    // Resume focused tracking from this moment
    _focusedSince = _now();
    _streakStart  = _now();

    // Mark break end on the timeline
    if (_current) {
      _current.milestones.push({ t: Math.round(_elapsedSeconds()), type: 'break_end' });
    }

    _setState(STATE.ACTIVE);
    if (window.Sounds) Sounds.play('break_end');
    _startSampler();
  }

  /**
   * abandon() — user quits mid-session (no sound; already feels bad).
   */
  function abandon() {
    if (_state !== STATE.ACTIVE && _state !== STATE.PAUSED) return;
    _endSession('ABANDONED');
  }

  /**
   * recordMilestone(minutesMark) — push a focus-milestone event onto the timeline.
   * Called from renderer.js when Brain.onMilestone fires (every 5 min focused).
   * @param {number} minutesMark — e.g. 5, 10, 15 …
   */
  function recordMilestone(minutesMark) {
    if (!_current || _state !== STATE.ACTIVE) return;
    _current.milestones.push({
      t:    Math.round(_elapsedSeconds()),
      type: `milestone_${minutesMark}m`,
    });
  }

  /**
   * getLastSessionData() — return the most recently completed session (index 0),
   * including its focusTimeline and milestones arrays.
   * Returns null if no session has been recorded yet.
   * @returns {Object|null}
   */
  function getLastSessionData() {
    return _history.length > 0 ? _history[0] : null;
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
   * getBreakElapsedMs() — milliseconds elapsed since the break started.
   * Returns 0 if not currently on a break.
   * Used by the UI to display a live break elapsed-time counter.
   */
  function getBreakElapsedMs() {
    if (_state !== STATE.PAUSED || _breakStartMs === null) return 0;
    return _now() - _breakStartMs;
  }

  /**
   * onSessionStateChange(fn) — register a callback for session state transitions.
   * Signature: fn(newState, oldState)
   */
  function onSessionStateChange(fn) {
    _callbacks.onSessionStateChange.push(fn);
  }

  /**
   * reset() — return to IDLE so the user can start a fresh session.
   * Safe to call only after a terminal state (COMPLETED / FAILED / ABANDONED).
   * No-op if already IDLE or if a session is in progress.
   */
  function reset() {
    if (_state === STATE.ACTIVE || _state === STATE.PAUSED) return;
    _current      = null;
    _focusedSince = null;
    _streakStart  = null;
    _clearBreakStart();
    _setState(STATE.IDLE);
  }

  // ── Public surface ─────────────────────────────────────────────────────────

  return {
    init,
    startNew,
    pause,
    resume,
    abandon,
    reset,
    setGoalAchieved,
    getHistory,
    getLastSessionData,
    getCurrentStats,
    getBreakElapsedMs,
    onSessionStateChange,
    recordMilestone,
    STATE,
  };

})();
