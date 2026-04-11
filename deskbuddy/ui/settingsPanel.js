/**
 * SettingsPanel — UI controller for the settings overlay.
 *
 * Depends on: Settings (settings.js must be loaded first)
 *
 * Responsibilities:
 *   - Open / close the panel (gear button, close button, Escape key)
 *   - Populate controls from Settings.get() on open
 *   - Write changes back via Settings.set() on user interaction
 *   - Apply settings side-effects to live modules
 *   - Maintain a focus trap while the panel is open (a11y)
 */
const SettingsPanel = (() => {

  let _panel    = null;
  let _gearBtn  = null;
  let _closeBtn = null;
  let _open     = false;

  // ── Apply helpers — translate a setting value into live module calls ───────

  const _MUTE_DESCRIPTIONS = {
    ALL_ON:         'All sounds: ticks, emotions, sessions, breaks',
    ESSENTIAL:      'Session & break sounds only — no tick or emotion chatter',
    REMINDERS_ONLY: 'Break reminders only — everything else is silent',
    ALL_OFF:        'Complete silence — no sounds at all',
  };

  function _applyMutePreset(preset) {
    if (window.Sounds && Sounds.setMutePreset) Sounds.setMutePreset(preset);
    // Update description text
    const desc = document.getElementById('sp-mute-desc');
    if (desc) desc.textContent = _MUTE_DESCRIPTIONS[preset] || '';
  }

  function _applyDroneEnabled(enabled) {
    if (!window.Soundscape) return;
    if (enabled) {
      Soundscape.resume();
    } else {
      Soundscape.stop();
    }
  }

  function _applyBrightness(value) {
    const world = document.getElementById('world');
    if (world) world.style.filter = `brightness(${value})`;
  }

  function _applySensitivity(level) {
    if (window.Brain && Brain.setSensitivity) Brain.setSensitivity(level);
  }

  function _applyPhoneDetection(enabled) {
    if (window.Brain && Brain.setPhoneDetectionEnabled) {
      Brain.setPhoneDetectionEnabled(enabled);
    }
  }

  function _applyCompanionSize(size) {
    if (window.electronAPI && electronAPI.resizeWindow) {
      electronAPI.resizeWindow(size);
    }
  }

  function _applyNightAutoVolume(enabled) {
    // When disabled, force night gain multiplier to 1.0 so volume never drops.
    // Brain's applyTimePeriod will set it back to 0.8 when NIGHT if enabled.
    if (!enabled && window.Sounds && Sounds.setNightGainMult) {
      Sounds.setNightGainMult(1.0);
    }
    // If re-enabled, Brain's next applyTimePeriod call will restore the correct value.
  }

  // ── Panel open / close ─────────────────────────────────────────────────────

  function openPanel() {
    if (_open) return;
    _open = true;
    _panel.classList.add('settings-open');
    _syncControlsFromSettings();
    _gearBtn.setAttribute('aria-expanded', 'true');
    // Focus the close button as the first focusable element in the panel
    requestAnimationFrame(() => {
      if (_closeBtn) _closeBtn.focus();
    });
    document.addEventListener('keydown', _trapFocus);
  }

  function closePanel() {
    if (!_open) return;
    _open = false;
    _panel.classList.remove('settings-open');
    _gearBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', _trapFocus);
    _gearBtn.focus();
  }

  function togglePanel() {
    _open ? closePanel() : openPanel();
  }

  // ── Focus trap (a11y) ──────────────────────────────────────────────────────

  function _trapFocus(e) {
    if (!_open) return;

    const focusable = _panel.querySelectorAll(
      'button, input, select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
    }
  }

  // ── Sync controls → Settings values ───────────────────────────────────────

  function _syncControlsFromSettings() {
    _setControl('sp-mute-preset',      Settings.get('mutePreset'));
    _setControl('sp-break-interval',   String(Settings.get('breakInterval')));
    _setControl('sp-companion-size',   Settings.get('companionSize'));
    _setControl('sp-brightness',       String(Settings.get('brightness')));
    _setControl('sp-sensitivity',      Settings.get('sensitivity'));
    _setControl('sp-phone-detection',  Settings.get('phoneDetection'),  true);
    _setControl('sp-drone-enabled',    Settings.get('droneEnabled'),    true);
    _setControl('sp-night-auto-volume',Settings.get('nightAutoVolume'), true);
    // Refresh mute description to match current preset
    const desc = document.getElementById('sp-mute-desc');
    if (desc) desc.textContent = _MUTE_DESCRIPTIONS[Settings.get('mutePreset')] || '';
  }

  function _setControl(id, value, isCheckbox) {
    const el = document.getElementById(id);
    if (!el) return;
    if (isCheckbox) {
      el.checked = !!value;
    } else {
      el.value = value;
    }
  }

  // ── Wire a control to a Settings key ──────────────────────────────────────

  function _bindSelect(id, key, applyFn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      Settings.set(key, e.target.value);
      if (applyFn) applyFn(e.target.value);
    });
  }

  function _bindRange(id, key, applyFn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      Settings.set(key, v);
      if (applyFn) applyFn(v);
    });
  }

  function _bindCheckbox(id, key, applyFn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      Settings.set(key, e.target.checked);
      if (applyFn) applyFn(e.target.checked);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    _panel   = document.getElementById('settings-panel');
    _gearBtn = document.getElementById('settings-gear-btn');
    _closeBtn = document.getElementById('settings-close-btn');

    if (!_panel || !_gearBtn) return;

    // Button handlers
    _gearBtn.addEventListener('click',  () => togglePanel());
    if (_closeBtn) _closeBtn.addEventListener('click', () => closePanel());

    // Close when clicking the backdrop outside the panel in full-mode
    document.addEventListener('mousedown', (e) => {
      if (_open && !_panel.contains(e.target) && e.target !== _gearBtn) {
        closePanel();
      }
    });

    // Wire controls → Settings + live apply
    _bindSelect('sp-mute-preset',       'mutePreset',      _applyMutePreset);
    _bindSelect('sp-companion-size',    'companionSize',   _applyCompanionSize);
    _bindRange ('sp-brightness',        'brightness',      _applyBrightness);
    _bindSelect('sp-sensitivity',       'sensitivity',     _applySensitivity);
    _bindCheckbox('sp-phone-detection', 'phoneDetection',  _applyPhoneDetection);
    _bindCheckbox('sp-drone-enabled',   'droneEnabled',    _applyDroneEnabled);
    _bindCheckbox('sp-night-auto-volume','nightAutoVolume', _applyNightAutoVolume);

    // Break interval needs integer coercion before storing
    const breakEl = document.getElementById('sp-break-interval');
    if (breakEl) {
      breakEl.addEventListener('change', (e) => {
        const mins = parseInt(e.target.value, 10);
        Settings.set('breakInterval', mins);
        if (window.Timer && Timer.init) Timer.init(mins || 25);
      });
    }
    // Note: startup application of all settings is handled by _wireSettings()
    // in renderer.js; SettingsPanel is a UI controller only.
  }

  return { init, openPanel, closePanel, togglePanel, isOpen: () => _open };
})();
