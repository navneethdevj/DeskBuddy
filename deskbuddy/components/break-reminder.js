/**
 * BreakReminder — proactive wall-clock break reminder.
 *
 * Distinct from session.js which manages session health.
 * This module manages human health: after X minutes of continuous
 * focused working it fires a visual + audio nudge. Purely advisory.
 * No authority over session state, no auto-fail, no hard enforcement.
 *
 * Architecture:
 *   - Accumulates wall-clock time via a 1-second interval while running.
 *   - When accumulated time ≥ interval threshold, fires _trigger().
 *   - _trigger() overrides timer CSS variables to a soft teal colour.
 *   - _dismiss() removes those overrides; timer.js restores its own state.
 *   - Callbacks registered via onTrigger/onDismiss are wired in renderer.js.
 */
const BreakReminder = (() => {

  let _intervalMinutes = 25;   // 0 = disabled
  let _active          = false; // is a reminder currently showing?
  let _walltimeMs      = 0;    // accumulated working wall-clock ms since last reminder
  let _lastTickMs      = null; // for delta calculation
  let _running         = false;
  let _tickId          = null;
  let _onTriggerCbs    = [];
  let _onDismissCbs    = [];

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(intervalMinutes) {
    _intervalMinutes = (intervalMinutes !== undefined) ? intervalMinutes : 25;
    _walltimeMs  = 0;
    _active      = false;
    _lastTickMs  = null;
  }

  // ── Start / stop / pause / resume (driven by session state) ──────────────

  function start() {
    if (_running) return;
    _running    = true;
    _lastTickMs = Date.now();
    _tickId     = setInterval(_tick, 1000);
  }

  function stop() {
    _running = false;
    if (_tickId !== null) { clearInterval(_tickId); _tickId = null; }
    _lastTickMs = null;
    _walltimeMs = 0;
    _dismiss();
  }

  function pause() {
    // Stop accumulating time but keep the current accumulation.
    // The user is on a break; we clear the reminder if one is active.
    _running = false;
    if (_tickId !== null) { clearInterval(_tickId); _tickId = null; }
    _lastTickMs = null;
    _dismiss();
  }

  function resume() {
    if (_running) return;
    _running    = true;
    _lastTickMs = Date.now();
    _tickId     = setInterval(_tick, 1000);
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  function _tick() {
    if (!_running || _active || _intervalMinutes === 0) return;

    const now   = Date.now();
    // Cap delta at 3 s — handles tab sleep / background throttling
    const delta = Math.min(now - (_lastTickMs || now), 3000);
    _lastTickMs = now;
    _walltimeMs += delta;

    if (_walltimeMs >= _intervalMinutes * 60 * 1000) {
      _trigger();
    }
  }

  // ── Trigger / dismiss ──────────────────────────────────────────────────────

  function _trigger() {
    if (_active) return;
    _active     = true;
    _walltimeMs = 0;  // reset accumulator for next cycle

    // Visual cue — override timer CSS variables to soft teal ("you earned a break")
    document.documentElement.style.setProperty('--timer-color',       '#44e8b0');
    document.documentElement.style.setProperty('--timer-glow-color',  '#44e8b044');
    document.documentElement.style.setProperty('--timer-pulse-speed', '2.5s');
    document.documentElement.style.setProperty('--timer-shake-px',    '0px');

    _onTriggerCbs.forEach(fn => { try { fn(); } catch (e) {} });
  }

  function _dismiss() {
    if (!_active) return;
    _active = false;

    // Remove the override — timer.js will restore its own colour on next tick
    document.documentElement.style.removeProperty('--timer-color');
    document.documentElement.style.removeProperty('--timer-glow-color');
    document.documentElement.style.removeProperty('--timer-pulse-speed');
    document.documentElement.style.removeProperty('--timer-shake-px');

    _onDismissCbs.forEach(fn => { try { fn(); } catch (e) {} });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function setInterval_(minutes) {
    _intervalMinutes = parseInt(minutes, 10) || 0;
  }

  function onTrigger(fn)  { _onTriggerCbs.push(fn); }
  function onDismiss(fn)  { _onDismissCbs.push(fn); }
  function isActive()     { return _active; }
  function dismiss()      { _dismiss(); }
  function getInterval()  { return _intervalMinutes; }

  return {
    init,
    start,
    stop,
    pause,
    resume,
    setInterval: setInterval_,
    getInterval,
    onTrigger,
    onDismiss,
    isActive,
    dismiss,
  };
})();
