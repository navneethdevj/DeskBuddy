/**
 * DND — Do Not Disturb mode.
 *
 * Overrides companion behaviour for a set duration:
 *   • Sounds switched to REMINDERS_ONLY preset (saves + restores)
 *   • Companion locked to quiet focused expression via Brain.setDNDActive
 *   • Spontaneous behaviours, whispers, and rhythm reactions suppressed
 *   • Visual indicator on #dnd-indicator shows remaining time
 *
 * Durations: 15, 20, 25, 30, 45, 60, 90 minutes or 0 for "until cancelled".
 *
 * Public API:
 *   DND.init()                   — wire indicator click-to-cancel (call once)
 *   DND.activate(durationMins)   — start DND; pass 0 for infinite
 *   DND.deactivate()             — end DND early (or let auto-timer fire)
 *   DND.toggle(durationMins)     — activate if off, deactivate if on
 *   DND.isActive()               — boolean
 *   DND.getRemainingMs()         — ms until auto-deactivation (0 = infinite)
 *   DND.onActivate(fn)           — subscribe: fn(durationMins)
 *   DND.onDeactivate(fn)         — subscribe: fn()
 */
const DND = (() => {

  let _active      = false;
  let _endsAt      = 0;        // epoch ms; 0 = infinite
  let _timerId     = null;     // auto-deactivation setTimeout handle
  let _tickId      = null;     // indicator update setInterval handle
  let _savedPreset = null;     // mute preset saved before DND started

  const _callbacks = { onActivate: [], onDeactivate: [] };

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    const el = document.getElementById('dnd-indicator');
    if (el) {
      // Click on the active indicator cancels DND early
      el.addEventListener('click', () => { if (_active) deactivate(); });
    }
  }

  // ── Activate ─────────────────────────────────────────────────────────────

  function activate(durationMinutes) {
    if (_active) deactivate();   // restart cleanly if already running

    const mins = (parseInt(durationMinutes, 10) || 0);
    _active = true;
    _endsAt = mins > 0 ? Date.now() + mins * 60 * 1000 : 0;

    document.body.classList.add('dnd-active');

    // Save current mute preset then force REMINDERS_ONLY
    _savedPreset = (typeof Settings !== 'undefined')
      ? Settings.get('mutePreset')
      : 'ALL_ON';
    if (typeof Sounds !== 'undefined') Sounds.setMutePreset('REMINDERS_ONLY');

    // Suppress companion brain reactions
    if (typeof Brain !== 'undefined' && Brain.setDNDActive) Brain.setDNDActive(true);

    // Indicator updates every second
    _tickId = setInterval(_tick, 1000);
    _updateIndicator();

    // Auto-deactivate when the duration expires (skip for infinite)
    if (_endsAt > 0) {
      _timerId = setTimeout(deactivate, mins * 60 * 1000);
    }

    _callbacks.onActivate.forEach(fn => { try { fn(mins); } catch (_) {} });
  }

  // ── Deactivate ────────────────────────────────────────────────────────────

  function deactivate() {
    if (!_active) return;
    _active = false;
    _endsAt = 0;

    if (_timerId) { clearTimeout(_timerId);  _timerId = null; }
    if (_tickId)  { clearInterval(_tickId);  _tickId  = null; }

    document.body.classList.remove('dnd-active');

    // Restore the mute preset that was active before DND started.
    // Only restore if Settings didn't change the stored preset while DND was on
    // (i.e. the user manually changed it via the Settings panel during DND).
    if (typeof Sounds !== 'undefined' && _savedPreset) {
      const currentStored = (typeof Settings !== 'undefined')
        ? Settings.get('mutePreset')
        : _savedPreset;
      // currentStored is what Settings thinks is active; if the user changed it
      // during DND it's already different from _savedPreset — honour their choice.
      Sounds.setMutePreset(currentStored !== 'REMINDERS_ONLY' ? currentStored : _savedPreset);
    }
    _savedPreset = null;

    // Unlock companion behaviour
    if (typeof Brain !== 'undefined' && Brain.setDNDActive) Brain.setDNDActive(false);

    _updateIndicator();
    _callbacks.onDeactivate.forEach(fn => { try { fn(); } catch (_) {} });
  }

  // ── Internal tick ─────────────────────────────────────────────────────────

  function _tick() {
    if (!_active) return;
    if (_endsAt > 0 && Date.now() >= _endsAt) { deactivate(); return; }
    _updateIndicator();
  }

  // ── Indicator DOM update ──────────────────────────────────────────────────

  function _updateIndicator() {
    const el = document.getElementById('dnd-indicator');
    if (!el) return;

    if (!_active) {
      el.classList.remove('dnd-on');
      el.removeAttribute('title');
      return;
    }

    el.classList.add('dnd-on');
    el.title = 'Focus lock active — click to cancel';

    if (_endsAt === 0) {
      el.textContent = '⊘  focus lock';
    } else {
      const remaining = Math.max(0, _endsAt - Date.now());
      const m = String(Math.floor(remaining / 60000)).padStart(2, '0');
      const s = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
      el.textContent = `⊘  ${m}:${s}`;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function toggle(durationMinutes) {
    _active ? deactivate() : activate(durationMinutes);
  }

  function isActive()       { return _active; }
  function getRemainingMs() { return (_active && _endsAt > 0) ? Math.max(0, _endsAt - Date.now()) : 0; }
  function onActivate(fn)   { _callbacks.onActivate.push(fn); }
  function onDeactivate(fn) { _callbacks.onDeactivate.push(fn); }

  return { init, activate, deactivate, toggle, isActive, getRemainingMs, onActivate, onDeactivate };

})();
