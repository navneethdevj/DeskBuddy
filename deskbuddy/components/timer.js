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
    FOCUSED:    'FOCUSED',     // focusLevel >= 60                       → 1.0x
    DRIFTING:   'DRIFTING',    // focusLevel 35–59 for >= 5s continuous  → 0.7x
    DISTRACTED: 'DISTRACTED',  // focusLevel < 35 for >= 8s continuous   → 0.35x
    CRITICAL:   'CRITICAL',    // focusLevel < 20 for >= 20s continuous  → 0.08x
    FAILED:     'FAILED',      // CRITICAL held >= 45s                   → 0x (session lost)
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
  const ENTRY_HOLD = {
    [STATE.DRIFTING]:   5,   // 5s below 60
    [STATE.DISTRACTED]: 8,   // 8s below 35
    [STATE.CRITICAL]:   20,  // 20s below 20
    [STATE.FAILED]:     45,  // 45s in CRITICAL
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

  // Interval handles — cleared on pause/reset to avoid orphaned intervals
  let _tickInterval       = null;  // fixed 100ms accumulator ticker
  let _focusPollInterval  = null;  // 500ms focus level sampler

  // State entry/recovery hold tracking.
  // Each potential next-state has its own continuous-seconds counter so
  // transitions in different directions don't share the same clock.
  let _distractionTimer = 0;  // seconds continuously below the DRIFTING threshold (< 60)
  let _criticalTimer    = 0;  // seconds continuously in CRITICAL (to detect FAILED)
  let _recoveryHold     = 0;  // seconds continuously at improved focus (for recovery step)

  // Callbacks
  let _tickCallbacks        = [];  // fn() — called each logical timer-second
  let _stateChangeCallbacks = [];  // fn(newState, oldState) — called on transition

  // ── Public API — stubs ─────────────────────────────────────────────────────

  /**
   * Set up the timer for a session of durationMinutes.
   * Does NOT start ticking — call start() after init().
   */
  function init(durationMinutes) {
    throw new Error('Not implemented: Timer.init');
  }

  /**
   * Begin the session. Starts both the tick accumulator and the focus poller.
   */
  function start() {
    throw new Error('Not implemented: Timer.start');
  }

  /**
   * Pause — freeze tick accumulator and focus poller.
   * State and remaining time are preserved.
   */
  function pause() {
    throw new Error('Not implemented: Timer.pause');
  }

  /**
   * Resume from a paused state. Restarts accumulator and focus poller.
   */
  function resume() {
    throw new Error('Not implemented: Timer.resume');
  }

  /**
   * Reset to initial duration and FOCUSED state without starting.
   * Clears all intervals and resets every counter.
   */
  function reset() {
    throw new Error('Not implemented: Timer.reset');
  }

  /** Return the current state string (one of STATE.*). */
  function getState() {
    throw new Error('Not implemented: Timer.getState');
  }

  /** Return remaining time in integer seconds. */
  function getRemainingSeconds() {
    throw new Error('Not implemented: Timer.getRemainingSeconds');
  }

  /**
   * Register a callback fired each logical timer-second (wall-clock gap varies
   * by multiplier — that irregular cadence is intentional).
   */
  function onTick(fn) {
    throw new Error('Not implemented: Timer.onTick');
  }

  /**
   * Register a callback fired on every state transition.
   * Signature: fn(newState, oldState)
   */
  function onStateChange(fn) {
    throw new Error('Not implemented: Timer.onStateChange');
  }

  // ── Private stubs ──────────────────────────────────────────────────────────

  /**
   * _pollFocus — called every 500ms while running.
   *
   * Reads window.Brain.getFocusLevel() (0–100) and decides whether a state
   * transition is warranted. Transitions are gated by ENTRY_HOLD seconds of
   * continuous degradation (downward) or MIN_HOLD_RECOVERY (upward).
   *
   * Downward path:  FOCUSED → DRIFTING → DISTRACTED → CRITICAL → FAILED
   * Recovery path:  FAILED is terminal. CRITICAL → DISTRACTED → DRIFTING → FOCUSED
   *                 Each upward step requires MIN_HOLD_RECOVERY continuous seconds.
   */
  function _pollFocus() {
    throw new Error('Not implemented: Timer._pollFocus');
  }

  /**
   * _applyState — transition to newState if it differs from _currentState.
   *
   * Responsibilities:
   *   1. Set _currentState and _tickMultiplier.
   *   2. Write CSS_VARS[newState] to document.documentElement.
   *   3. Fire all _stateChangeCallbacks(newState, oldState).
   *
   * Must be idempotent: calling with current state is a no-op.
   * CSS variables are written unconditionally on any real transition so
   * external CSS animations pick up the change immediately.
   */
  function _applyState(newState) {
    throw new Error('Not implemented: Timer._applyState');
  }

  /**
   * _fireTick — called each time accumulated ms crosses a 1000ms boundary.
   *
   * Responsibilities:
   *   1. Decrement _remainingSeconds (floor at 0).
   *   2. Fire all _tickCallbacks.
   *   3. If _remainingSeconds reaches 0 and state is not FAILED, enter FAILED.
   */
  function _fireTick() {
    throw new Error('Not implemented: Timer._fireTick');
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
