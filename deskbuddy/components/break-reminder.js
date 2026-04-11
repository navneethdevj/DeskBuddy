/**
 * BreakReminder — Proactive break reminder for DeskBuddy.
 *
 * Tracks wall-clock working time independently of session state.
 * After X minutes of continuous focused working, fires a reminder.
 * Purely advisory — has no authority over session state.
 *
 * API:
 *   BreakReminder.init(intervalMinutes)
 *   BreakReminder.start()   — begin accumulating (call when session ACTIVE)
 *   BreakReminder.pause()   — stop accumulating without reset (call on PAUSED)
 *   BreakReminder.resume()  — resume accumulating (call when session resumes)
 *   BreakReminder.stop()    — stop + reset (call when session ends)
 *   BreakReminder.dismiss() — clear the active reminder manually
 *   BreakReminder.setInterval(minutes) — update threshold; 0 = disabled
 *   BreakReminder.onTrigger(fn)
 *   BreakReminder.onDismiss(fn)
 *   BreakReminder.isActive()
 */
const BreakReminder = (() => {

  let _intervalMinutes = 25;
  let _active          = false;
  let _walltimeMs      = 0;
  let _lastTickMs      = null;
  let _running         = false;
  let _tickId          = null;

  const _onTriggerCbs = [];
  const _onDismissCbs = [];

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(intervalMinutes) {
    _intervalMinutes = (intervalMinutes != null) ? intervalMinutes : 25;
    _walltimeMs = 0;
    _active = false;
    _lastTickMs = null;
  }

  // ── Start / stop ──────────────────────────────────────────────────────────

  function start() {
    if (_running) return;
    _running = true;
    _lastTickMs = Date.now();
    _tickId = setInterval(_tick, 1000);
  }

  function stop() {
    _running = false;
    if (_tickId !== null) { clearInterval(_tickId); _tickId = null; }
    _lastTickMs = null;
    _walltimeMs = 0;
    _dismiss();
  }

  function pause() {
    _running = false;
    if (_tickId !== null) { clearInterval(_tickId); _tickId = null; }
    _lastTickMs = null;
    _dismiss();
  }

  function resume() {
    if (_running) return;
    _running = true;
    _lastTickMs = Date.now();
    _tickId = setInterval(_tick, 1000);
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  function _tick() {
    if (!_running || _active || _intervalMinutes === 0) return;

    const now   = Date.now();
    const delta = Math.min(now - (_lastTickMs || now), 3000);  // cap to handle tab sleep
    _lastTickMs = now;
    _walltimeMs += delta;

    const thresholdMs = _intervalMinutes * 60 * 1000;
    if (_walltimeMs >= thresholdMs) {
      _trigger();
    }
  }

  // ── Trigger / dismiss ─────────────────────────────────────────────────────

  function _trigger() {
    if (_active) return;
    _active = true;
    _walltimeMs = 0;

    // Visual cue — timer colour becomes a soft teal "you've earned a break"
    document.documentElement.style.setProperty('--timer-color',       '#44e8b0');
    document.documentElement.style.setProperty('--timer-glow-color',  '#44e8b044');
    document.documentElement.style.setProperty('--timer-pulse-speed', '2.5s');
    document.documentElement.style.setProperty('--timer-shake-px',    '0px');

    _onTriggerCbs.forEach(fn => { try { fn(); } catch (e) {} });
  }

  function _dismiss() {
    if (!_active) return;
    _active = false;

    // Remove timer colour override — timer.js will restore its own colour on next tick
    document.documentElement.style.removeProperty('--timer-color');
    document.documentElement.style.removeProperty('--timer-glow-color');
    document.documentElement.style.removeProperty('--timer-pulse-speed');
    document.documentElement.style.removeProperty('--timer-shake-px');

    _onDismissCbs.forEach(fn => { try { fn(); } catch (e) {} });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function setInterval_(minutes) {
    _intervalMinutes = parseInt(minutes, 10) || 0;
  }

  function onTrigger(fn)  { _onTriggerCbs.push(fn); }
  function onDismiss(fn)  { _onDismissCbs.push(fn); }
  function isActive()     { return _active; }
  function dismiss()      { _dismiss(); }

  return { init, start, stop, pause, resume, setInterval: setInterval_, onTrigger, onDismiss, isActive, dismiss };
})();
