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
  //
  // Architecture: renderer.js owns all module wiring via Settings.onChange().
  // These helpers handle only UI side-effects that the settings panel itself
  // must manage (description text, control enabled/disabled state, etc.).
  // They must NOT call live modules — that would double-fire every change.

  const _MUTE_DESCRIPTIONS = {
    ALL_ON:         'All sounds: ticks, emotions, sessions, breaks',
    ESSENTIAL:      'Session & break sounds only — no tick or emotion chatter',
    REMINDERS_ONLY: 'Break reminders only — everything else is silent',
    ALL_OFF:        'Complete silence — no sounds at all',
  };

  function _applyMutePreset(preset) {
    // UI only — update the description line below the select
    const desc = document.getElementById('sp-mute-desc');
    if (desc) desc.textContent = _MUTE_DESCRIPTIONS[preset] || '';
  }

  function _applyBreakReminderEnabled(enabled) {
    // UI only — dim and disable the interval row when reminders are off
    const intervalEl  = document.getElementById('sp-break-interval');
    const intervalRow = document.getElementById('sp-break-interval-row');
    if (intervalEl)  intervalEl.disabled = !enabled;
    if (intervalRow) intervalRow.style.opacity = enabled ? '' : '0.4';
  }

  function _applyCompanionSize(size) {
    // No renderer.js onChange for companionSize — must call IPC here
    if (window.electronAPI && electronAPI.resizeWindow) {
      electronAPI.resizeWindow(size);
    }
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
    _setControl('sp-mute-preset',             Settings.get('mutePreset'));
    _setControl('sp-break-reminder-enabled',  Settings.get('breakReminderEnabled'), true);
    _setControl('sp-break-interval',          String(Settings.get('breakInterval')));
    _setControl('sp-companion-size',          Settings.get('companionSize'));
    _setControl('sp-brightness',              String(Settings.get('brightness')));
    _setControl('sp-sensitivity',             Settings.get('sensitivity'));
    _setControl('sp-phone-detection',         Settings.get('phoneDetection'),  true);
    _setControl('sp-drone-enabled',           Settings.get('droneEnabled'),    true);
    _setControl('sp-night-auto-volume',       Settings.get('nightAutoVolume'), true);
    // Refresh mute description to match current preset
    const desc = document.getElementById('sp-mute-desc');
    if (desc) desc.textContent = _MUTE_DESCRIPTIONS[Settings.get('mutePreset')] || '';
    // Reflect break reminder enabled state on the interval row
    const enabled = Settings.get('breakReminderEnabled');
    const intervalEl  = document.getElementById('sp-break-interval');
    const intervalRow = document.getElementById('sp-break-interval-row');
    if (intervalEl)  intervalEl.disabled = !enabled;
    if (intervalRow) intervalRow.style.opacity = enabled ? '' : '0.4';
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
    // Passing null where there is no UI-only side-effect — renderer.js
    // Settings.onChange handlers own all live module calls.
    _bindSelect('sp-mute-preset',       'mutePreset',      _applyMutePreset);
    _bindSelect('sp-companion-size',    'companionSize',   _applyCompanionSize);
    _bindRange ('sp-brightness',        'brightness',      null);
    _bindSelect('sp-sensitivity',       'sensitivity',     null);
    _bindCheckbox('sp-phone-detection', 'phoneDetection',  null);
    _bindCheckbox('sp-drone-enabled',   'droneEnabled',    null);
    _bindCheckbox('sp-night-auto-volume','nightAutoVolume', null);
    _bindCheckbox('sp-break-reminder-enabled', 'breakReminderEnabled', _applyBreakReminderEnabled);

    // Break interval — integer coercion before storing
    const breakEl = document.getElementById('sp-break-interval');
    if (breakEl) {
      breakEl.addEventListener('change', (e) => {
        Settings.set('breakInterval', parseInt(e.target.value, 10) || 25);
        // No UI side-effect here — renderer.js onChange handles BreakReminder.setInterval
      });
    }
    // Note: startup application of all settings is handled by _wireSettings()
    // in renderer.js; SettingsPanel is a UI controller only.
  }

  return { init, openPanel, closePanel, togglePanel, isOpen: () => _open };
})();
