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
 * localStorage key: 'deskbuddy_sessions'.  Max 365 sessions; oldest dropped.
 */
const Session = (() => {

  // ── Constants ─────────────────────────────────────────────────────────────

  const _MAX_SESSIONS          = 365;
  const _STORAGE_KEY           = 'deskbuddy_sessions';
  const _TIMELINE_INTERVAL_MS  = 5000;  // snapshot every 5 s during ACTIVE state

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

  // Timeline sampling
  let _timelineIntervalId = null;  // setInterval id for periodic snapshots
  let _sessionStartMs     = null;  // wall-clock ms when current session started

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

  // ── Timeline helpers ───────────────────────────────────────────────────────

  /** Seconds elapsed since the session started (used as the `t` coordinate). */
  function _elapsedSeconds() {
    return _sessionStartMs ? Math.round((_now() - _sessionStartMs) / 1000) : 0;
  }

  /** Push one focus-level snapshot to the timeline. */
  function _recordSnapshot() {
    if (!_current) return;
    const level = (typeof Brain !== 'undefined' && Brain.getFocusLevel) ? Brain.getFocusLevel() : 50;
    const state = (typeof Timer !== 'undefined' && Timer.getState)      ? Timer.getState()      : 'FOCUSED';
    _current.focusTimeline.push({ t: _elapsedSeconds(), level, state });
  }

  function _startTimeline() {
    _stopTimeline();
    _timelineIntervalId = setInterval(_recordSnapshot, _TIMELINE_INTERVAL_MS);
  }

  function _stopTimeline() {
    if (_timelineIntervalId !== null) {
      clearInterval(_timelineIntervalId);
      _timelineIntervalId = null;
    }
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

  // ── Break tracking ─────────────────────────────────────────────────────────

  function _clearBreakStart() {
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
        if (typeof Sounds !== 'undefined') Sounds.play('refocus');
      }
    }

    // ── Distraction events ───────────────────────────────────────────────────
    if ((newState === TIMER_DISTRACTED || newState === TIMER_CRITICAL) &&
        (oldState === TIMER_FOCUSED || oldState === TIMER_DRIFTING)) {
      _current.distractionCount++;
      // Record distraction milestone for the post-session graph
      _current.milestones.push({ t: _elapsedSeconds(), type: 'distraction' });
    }

    // ── Terminal: timer FAILED ────────────────────────────────────────────────
    if (newState === TIMER_FAILED) {
      // If the timer's remaining time reached zero it's a natural expiry → always COMPLETED.
      // CRITICAL held 45 s with time still on the clock → distraction failure → FAILED.
      const naturalExpiry = !!(typeof Timer !== 'undefined' && Timer.getRemainingSeconds() === 0);
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
    _clearBreakStart();

    // Stop timeline sampling and push a final snapshot
    _stopTimeline();
    _recordSnapshot();

    _current.outcome = outcome;
    _pushSession(Object.assign({}, _current));

    // Play appropriate lifecycle sound
    if (typeof Sounds !== 'undefined') {
      if (outcome === 'COMPLETED') Sounds.play('session_complete');
      else if (outcome === 'FAILED') Sounds.play('session_fail');
      // ABANDONED: silent — user chose to quit
    }

    _current        = null;
    _focusedSince   = null;
    _streakStart    = null;
    _sessionStartMs = null;

    _setState(STATE[outcome]);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * init() — load localStorage, register with Timer.
   * Must be called once after Timer is available (at app startup).
   */
  function init() {
    _loadFromStorage();
    if (typeof Timer !== 'undefined' && Timer.onStateChange) {
      Timer.onStateChange(_onTimerStateChange);
    }
    // Record 5-minute milestones from Brain for the post-session graph
    if (typeof Brain !== 'undefined' && Brain.onMilestone) {
      Brain.onMilestone(() => {
        if (_state === STATE.ACTIVE && _current) {
          _current.milestones.push({ t: _elapsedSeconds(), type: 'milestone_5m' });
        }
      });
    }
  }

  /**
   * startNew(mins, goal?, category?) — begin a new session.
   * @param {number} mins      — intended session duration in minutes
   * @param {string} [goal]    — optional goal text (max 100 chars)
   * @param {string} [category] — activity category: 'study'|'work'|'creative'|'reading'|'other'
   */
  function startNew(mins, goal, category) {
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
      moodRating:                null,
      category:                  (category && ['study','work','creative','reading','other'].includes(category))
                                   ? category : null,
      focusTimeline:             [],   // { t: elapsedSecs, level: 0-100, state: timerState }
      milestones:                [],   // { t: elapsedSecs, type: 'distraction'|'milestone_5m' }
    };

    // Record t=0 baseline snapshot then start periodic sampling
    _sessionStartMs = _now();
    _recordSnapshot();
    _startTimeline();

    // Start counting focused time from session start (assume user is focused)
    _focusedSince = _now();
    _streakStart  = _now();

    _setState(STATE.ACTIVE);
    if (typeof Sounds !== 'undefined') Sounds.play('session_start');

    // ── Time-of-day awareness ──────────────────────────────────────────────
    if (typeof Brain !== 'undefined') {
      const period = Brain.getTimePeriod();
      Brain.applyTimePeriod(period);
      if (typeof Soundscape !== 'undefined') Soundscape.setTimeTint(period);

      if (period === 'NIGHT') {
        Brain.trackNightSession();
        Brain.checkNightWhisper();
      } else {
        Brain.resetNightSessions();
      }

      if (period === 'MORNING') {
        // Short delay so the start animation fires first, then morning whisper follows
        setTimeout(() => Brain.doMorningGreeting(), 100);
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

    _closeFocusedStreak();
    _streakStart = null;

    // Snapshot current state before pausing, then stop sampling during break
    _recordSnapshot();
    _stopTimeline();

    _breakStartMs = _now();

    _setState(STATE.PAUSED);
    if (typeof Sounds !== 'undefined') Sounds.play('break_start');
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

    // Restart timeline sampling
    _startTimeline();

    _setState(STATE.ACTIVE);
    if (typeof Sounds !== 'undefined') Sounds.play('break_over');
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
    if (typeof Timer !== 'undefined' && Timer.getRemainingSeconds) {
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
   * computeDayStreak() — count consecutive days ending today that each have at
   * least one COMPLETED or FAILED (not ABANDONED) session recorded.
   * @returns {number}
   */
  function computeDayStreak() {
    const history = getHistory();
    if (!history.length) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streak   = 0;
    let checking = new Date(today);

    while (true) {
      const dayStart  = checking.getTime();
      const dayEnd    = dayStart + 86400000;
      const hasSession = history.some(s => {
        const ts = s.date ? new Date(s.date).getTime() : 0;
        return ts >= dayStart && ts < dayEnd && s.outcome !== 'ABANDONED';
      });
      if (!hasSession) break;
      streak++;
      checking.setDate(checking.getDate() - 1);
      if (streak > 365) break;  // safety cap
    }

    return streak;
  }

  /**
   * computeLongestStreak() — find the longest ever consecutive-day streak
   * in the full history. Scans up to 2 years of history.
   * @returns {number} — days
   */
  function computeLongestStreak() {
    const history = getHistory();
    if (!history.length) return 0;

    // Build a Set of "day keys" (date strings) for all non-abandoned sessions
    const dayKeys = new Set(
      history
        .filter(s => s.outcome !== 'ABANDONED')
        .map(s => {
          if (!s.date) return null;
          const d = new Date(s.date);
          return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        })
        .filter(Boolean)
    );

    let longest = 0;
    let current = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 730; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dayKeys.has(key)) {
        current++;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    }
    return longest;
  }

  /**
   * getTotalFocusedMinutes() — sum of actualFocusedSeconds across all
   * COMPLETED sessions in history, converted to minutes (floored).
   * @returns {number}
   */
  function getTotalFocusedMinutes() {
    const history = getHistory();
    const totalSecs = history.reduce((acc, s) => {
      return acc + (s.outcome === 'COMPLETED' ? (s.actualFocusedSeconds || 0) : 0);
    }, 0);
    return Math.floor(totalSecs / 60);
  }

  /**
   * getGoalCompletionRate() — statistics on answered goal sessions.
   * Only counts sessions where goalText was set AND the user answered
   * the "did you finish it?" prompt (goalAchieved is not null).
   * @returns {{ total: number, achieved: number, rate: number }}
   */
  function getGoalCompletionRate() {
    const history  = getHistory();
    const answered = history.filter(s => s.goalText && s.goalAchieved !== null);
    const achieved = answered.filter(s => s.goalAchieved === true).length;
    const rate     = answered.length > 0 ? Math.round((achieved / answered.length) * 100) : 0;
    return { total: answered.length, achieved, rate };
  }


  /**
   * setMoodRating(rating) — record a post-session energy/mood rating (1–5)
   * for the most recent session. Called when the user answers the mood prompt
   * on sessions that had no goal set.
   * @param {number} rating — integer 1 (drained) … 5 (on fire)
   */
  function setMoodRating(rating) {
    if (!_history.length) return;
    _history[0].moodRating = rating;
    _saveToStorage();
  }

  /**
   * reset() — return to IDLE so the user can start a fresh session.
   * Safe to call only after a terminal state (COMPLETED / FAILED / ABANDONED).
   * No-op if already IDLE or if a session is in progress.
   */
  function reset() {
    if (_state === STATE.ACTIVE || _state === STATE.PAUSED) return;
    _current        = null;
    _focusedSince   = null;
    _streakStart    = null;
    _sessionStartMs = null;
    _stopTimeline();
    _clearBreakStart();
    _setState(STATE.IDLE);
  }

  // ── History mutation ──────────────────────────────────────────────────────

  /**
   * deleteSession(index) — remove one session by its 0-based index in getHistory().
   * History is stored newest-first, so index 0 = most recent.
   * Does nothing and returns false if the index is out of range.
   * @param {number} index
   * @returns {boolean} true if a session was removed
   */
  function deleteSession(index) {
    if (index < 0 || index >= _history.length) return false;
    _history.splice(index, 1);
    _saveToStorage();
    return true;
  }

  /**
   * deleteSessions(indices) — remove multiple sessions by their 0-based indices.
   * Indices are resolved against the array BEFORE any removal so callers can
   * pass them in any order.
   * @param {number[]} indices
   * @returns {number} count of sessions actually removed
   */
  function deleteSessions(indices) {
    const valid = [...new Set(indices)]
      .filter(i => Number.isInteger(i) && i >= 0 && i < _history.length)
      .sort((a, b) => b - a); // remove highest index first to keep lower indices stable
    valid.forEach(i => _history.splice(i, 1));
    if (valid.length) _saveToStorage();
    return valid.length;
  }

  /**
   * clearHistory() — delete all saved session history from memory and localStorage.
   */
  function clearHistory() {
    _history = [];
    _saveToStorage();
  }

  /**
   * clearAllCache() — wipe ALL localStorage keys used by DeskBuddy
   * (sessions + settings + any other persisted state).
   */
  function clearAllCache() {
    const KNOWN_KEYS = [
      _STORAGE_KEY,                     // deskbuddy_sessions
      'deskbuddy_settings',
      'deskbuddy_phone_detect',
      'deskbuddy_dnd_active',
    ];
    KNOWN_KEYS.forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    _history = [];
  }

  // ── Public surface ─────────────────────────────────────────────────────────

  /**
   * exportHistory() — serialise the full session history to a JSON string.
   * Returns a wrapper object with metadata for validation on import.
   */
  function exportHistory() {
    const payload = {
      version:      1,
      exportedAt:   new Date().toISOString(),
      appVersion:   'DeskBuddy',
      sessionCount: _history.length,
      sessions:     _history.slice(),
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * importHistory(jsonString) — parse a JSON export and merge sessions.
   *
   * Merge strategy: additive by ID.
   *   - Sessions from the file that do NOT exist locally (by id) are added.
   *   - Sessions that already exist locally are KEPT (local wins on conflict).
   *   - Result is sorted newest-first and capped at _MAX_SESSIONS.
   *
   * @returns {{ success: boolean, imported: number, total: number, reason?: string }}
   */
  function importHistory(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (_) {
      return { success: false, reason: 'Invalid JSON file.' };
    }

    if (!parsed.sessions || !Array.isArray(parsed.sessions)) {
      return { success: false, reason: 'File does not contain session data.' };
    }

    // Validate: each session must have at least date + outcome
    const valid = parsed.sessions.filter(s => s.date && s.outcome !== undefined);
    if (!valid.length) {
      return { success: false, reason: 'No valid sessions found in file.' };
    }

    // Merge: add sessions whose IDs don't already exist locally
    const existingIds = new Set(_history.map(s => s.id));
    const newSessions = valid.filter(s => !existingIds.has(s.id));

    _history = [...newSessions, ..._history]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, _MAX_SESSIONS);

    _saveToStorage();
    return { success: true, imported: newSessions.length, total: _history.length };
  }

  return {
    init,
    startNew,
    pause,
    resume,
    abandon,
    reset,
    setGoalAchieved,
    setMoodRating,
    getHistory,
    getCurrentStats,
    getBreakElapsedMs,
    onSessionStateChange,
    computeDayStreak,
    computeLongestStreak,
    getTotalFocusedMinutes,
    getGoalCompletionRate,
    STATE,
    exportHistory,
    importHistory,
    deleteSession,
    deleteSessions,
    clearHistory,
    clearAllCache,
  };

})();
