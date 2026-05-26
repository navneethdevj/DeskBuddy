/**
 * apple-border.js — Apple Intelligence Animated Border
 * 
 * Injects rotating conic-gradient rings around the session and history panels.
 * Self-contained: reads Settings, injects its own UI into the settings panel.
 * No external deps. Pure DOM + CSS custom properties.
 */
(function AppleBorder() {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────────────────── */
  const SETTING_KEYS = {
    enabled:   'appleBorderEnabled',
    intensity: 'appleBorderIntensity',
    speed:     'appleBorderSpeed',
    palette:   'appleBorderPalette',
  };

  const DEFAULTS = {
    enabled:   false,
    intensity: 'normal',
    speed:     'normal',
    palette:   'apple',
  };

  const PANEL_IDS = [
    'session-idle',
    'session-active',
    'session-paused',
    'history-card',
  ];

  /* ── Utility: read / write settings safely ───────────────────────────────── */
  function get(k) {
    if (typeof Settings !== 'undefined' && Settings.get) {
      const v = Settings.get(k);
      return (v !== undefined && v !== null) ? v : DEFAULTS[k];
    }
    // Fallback to localStorage
    try {
      const raw = localStorage.getItem('ab_' + k);
      return raw !== null ? JSON.parse(raw) : DEFAULTS[k];
    } catch { return DEFAULTS[k]; }
  }

  function set(k, v) {
    if (typeof Settings !== 'undefined' && Settings.set) {
      Settings.set(k, v);
    } else {
      try { localStorage.setItem('ab_' + k, JSON.stringify(v)); } catch {}
    }
  }

  /* ── Ring injection ──────────────────────────────────────────────────────── */
  const _rings = new Map();

  function _injectRings() {
    PANEL_IDS.forEach(id => {
      const panel = document.getElementById(id);
      if (!panel || _rings.has(id)) return;

      // Ensure panel is positioned (needed for absolute children)
      const cs = getComputedStyle(panel);
      if (cs.position === 'static') panel.style.position = 'relative';

      const ring = document.createElement('div');
      ring.className = 'apple-border-ring';
      ring.id = id + '-ab-ring';
      ring.setAttribute('aria-hidden', 'true');

      const glow = document.createElement('div');
      glow.className = 'apple-border-glow';
      glow.id = id + '-ab-glow';
      glow.setAttribute('aria-hidden', 'true');

      panel.prepend(glow);
      panel.prepend(ring);
      _rings.set(id, { ring, glow });
    });
  }

  /* ── Apply settings to DOM ───────────────────────────────────────────────── */
  function _applyAll() {
    const enabled   = get(SETTING_KEYS.enabled);
    const intensity = get(SETTING_KEYS.intensity);
    const speed     = get(SETTING_KEYS.speed);
    const palette   = get(SETTING_KEYS.palette);

    // Body classes drive CSS
    document.body.classList.toggle('apple-border-enabled', enabled);
    document.body.dataset.abIntensity = intensity;
    document.body.dataset.abSpeed     = speed;
    document.body.dataset.abPalette   = palette;

    // Sync settings UI if it exists
    _syncUI();
  }

  /* ── Settings UI injection ───────────────────────────────────────────────── */
  const SETTINGS_INJECTION_ID = 'ab-settings-group';

  function _injectSettingsUI() {
    if (document.getElementById(SETTINGS_INJECTION_ID)) return;

    // Find the settings body to append to
    const settingsBody = document.getElementById('settings-body') ||
                         document.querySelector('.settings-body');
    if (!settingsBody) return;

    const group = document.createElement('div');
    group.className = 'settings-group';
    group.id = SETTINGS_INJECTION_ID;
    group.innerHTML = `
      <button class="settings-group-title" aria-expanded="false">
        <span class="settings-section-icon">✦</span>Panel Border Effect<span class="settings-chevron" aria-hidden="true"></span>
      </button>
      <div class="settings-group-body">

        <!-- Enable toggle -->
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Apple Intelligence Border</div>
            <div class="settings-row-sublabel">Rotating gradient ring on session &amp; history panels</div>
          </div>
          <label class="settings-toggle" id="ab-toggle-wrap">
            <input type="checkbox" id="ab-enabled-toggle">
            <span class="settings-toggle-track"></span>
          </label>
        </div>

        <!-- Palette -->
        <div class="settings-row-col" id="ab-controls" style="gap:10px;display:flex;flex-direction:column;padding-bottom:6px;">

          <div>
            <div class="settings-row-label" style="margin-bottom:6px;">Color palette</div>
            <div class="ab-palette-chips">
              <div class="ab-palette-chip" data-palette="apple">
                <span class="ab-chip-name">Apple</span>
              </div>
              <div class="ab-palette-chip" data-palette="arctic">
                <span class="ab-chip-name">Arctic</span>
              </div>
              <div class="ab-palette-chip" data-palette="ember">
                <span class="ab-chip-name">Ember</span>
              </div>
              <div class="ab-palette-chip" data-palette="cosmos">
                <span class="ab-chip-name">Cosmos</span>
              </div>
              <div class="ab-palette-chip" data-palette="pastel">
                <span class="ab-chip-name">Pastel</span>
              </div>
            </div>
          </div>

          <div>
            <div class="settings-row-label" style="margin-bottom:5px;">Intensity</div>
            <div class="ab-intensity-chips">
              <button class="ab-chip" data-intensity="subtle">Subtle</button>
              <button class="ab-chip" data-intensity="normal">Normal</button>
              <button class="ab-chip" data-intensity="vivid">Vivid</button>
            </div>
          </div>

          <div>
            <div class="settings-row-label" style="margin-bottom:5px;">Speed</div>
            <div class="ab-speed-chips">
              <button class="ab-chip" data-speed="slow">Slow</button>
              <button class="ab-chip" data-speed="normal">Normal</button>
              <button class="ab-chip" data-speed="fast">Fast</button>
            </div>
          </div>

        </div>

      </div>
    `;

    settingsBody.appendChild(group);
    _wireSettingsUI(group);
    _syncUI();

    // Wire the group accordion (matches renderer's pattern)
    const btn = group.querySelector('.settings-group-title');
    const body = group.querySelector('.settings-group-body');
    if (btn && body) {
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        body.classList.toggle('expanded', !open);
      });
    }
  }

  function _wireSettingsUI(container) {
    // Enable toggle
    const toggle = container.querySelector('#ab-enabled-toggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        set(SETTING_KEYS.enabled, toggle.checked);
        _applyAll();
      });
    }

    // Palette chips
    container.querySelectorAll('.ab-palette-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        set(SETTING_KEYS.palette, chip.dataset.palette);
        _applyAll();
      });
    });

    // Intensity chips
    container.querySelectorAll('[data-intensity]').forEach(chip => {
      chip.addEventListener('click', () => {
        set(SETTING_KEYS.intensity, chip.dataset.intensity);
        _applyAll();
      });
    });

    // Speed chips
    container.querySelectorAll('[data-speed]').forEach(chip => {
      chip.addEventListener('click', () => {
        set(SETTING_KEYS.speed, chip.dataset.speed);
        _applyAll();
      });
    });
  }

  function _syncUI() {
    const enabled   = get(SETTING_KEYS.enabled);
    const intensity = get(SETTING_KEYS.intensity);
    const speed     = get(SETTING_KEYS.speed);
    const palette   = get(SETTING_KEYS.palette);

    // Toggle
    const toggle = document.getElementById('ab-enabled-toggle');
    if (toggle) toggle.checked = enabled;

    // Controls visibility
    const controls = document.getElementById('ab-controls');
    if (controls) controls.style.opacity = enabled ? '1' : '0.38';

    // Palette chips
    document.querySelectorAll('.ab-palette-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.palette === palette);
    });

    // Intensity chips
    document.querySelectorAll('[data-intensity]').forEach(c => {
      c.classList.toggle('active', c.dataset.intensity === intensity);
    });

    // Speed chips
    document.querySelectorAll('[data-speed]').forEach(c => {
      c.classList.toggle('active', c.dataset.speed === speed);
    });
  }

  /* ── Listen for settings changes (from renderer's Settings module) ────────── */
  function _subscribeSettings() {
    if (typeof Settings === 'undefined' || !Settings.onChange) return;
    Object.values(SETTING_KEYS).forEach(k => {
      Settings.onChange(k, () => _applyAll());
    });
  }

  /* ── Register defaults with Settings module ──────────────────────────────── */
  function _registerDefaults() {
    if (typeof Settings === 'undefined') return;
    // Only set if not already stored
    Object.entries(DEFAULTS).forEach(([key, val]) => {
      const settingKey = SETTING_KEYS[key];
      if (Settings.get(settingKey) === undefined || Settings.get(settingKey) === null) {
        // Don't overwrite — just ensure the key exists
        // Settings.set will be called when user changes
      }
    });
  }

  /* ── Init ────────────────────────────────────────────────────────────────── */
  function init() {
    _registerDefaults();
    _injectRings();
    _applyAll();
    _subscribeSettings();

    // Inject settings UI after a small delay to ensure settings panel is ready
    requestAnimationFrame(() => {
      setTimeout(() => {
        _injectSettingsUI();
      }, 800);
    });

    // Re-inject rings when panels appear (they may not exist at init time)
    const observer = new MutationObserver(() => {
      _injectRings();
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  /* ── Wait for DOM ────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for renderer.js to call if needed
  window.AppleBorder = { apply: _applyAll, syncUI: _syncUI };

})();
