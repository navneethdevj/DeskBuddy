/**
 * Renderer — main frontend entry point.
 *
 * Boot order: Settings → Sounds → Session → Timer → Companion → SpriteAnimator →
 *             Particles → Status → Camera/Perception → Brain → wire
 *
 * Cross-module communication rule: no module calls another directly.
 * All inter-module wiring lives exclusively in the _wire* functions below.
 */
(function main() {
  const world     = document.getElementById('world');
  const statusBar = document.getElementById('status-bar');

  // 0. Settings — load persisted preferences (synchronous from localStorage)
  Settings.init();

  // 1. Audio context — register gesture listeners so AudioContext can resume
  Sounds.init();
  // Soundscape drone — passes saved enabled state so drone respects user preference from startup
  Soundscape.init(Settings.get('droneEnabled'));

  // Apply saved mute preset before any sounds play
  Sounds.setMutePreset(Settings.get('mutePreset'));
  // Apply saved master volume
  Sounds.setVolume(Settings.get('volume'));

  // 2. Session — load localStorage history
  Session.init();

  // 3. Timer — set up default 25-min session (not started yet)
  Timer.init(25);

  // 4. Companion DOM
  Companion.create(world);

  // 5. Sprite animation engine
  SpriteAnimator.init(Companion.getElement());

  // 6. Particle effects
  Particles.init(world);

  // 7. Status UI
  Status.init(statusBar);

  // 8. Face tracking (async, non-blocking — app works without camera)
  Camera.init()
    .then(() => Perception.init())
    .catch((err) => {
      console.warn('[Renderer] Camera init failed:', err);
      Perception.init();
    });

  // 9. Brain loop
  Brain.start();

  // Apply saved sensitivity and phone-detection from Settings
  Brain.setSensitivity(Settings.get('sensitivity'));
  if (Brain.setPhoneDetectionEnabled) Brain.setPhoneDetectionEnabled(Settings.get('phoneDetection'));

  // 10. Break reminder — init with saved interval (0 = disabled)
  BreakReminder.init(Settings.get('breakInterval'));

  // The companion starts in full-screen mode on launch.
  // The user can switch to compact PiP overlay via the collapse button.
  document.body.classList.add('full-mode');

  // Apply saved companion size and brightness before wiring UI
  {
    const size = Settings.get('companionSize') || 'M';
    document.body.classList.add(`companion-size-${size}`);
    const brightness = Settings.get('brightness') || 1.0;
    const worldEl = document.getElementById('world');
    if (worldEl) worldEl.style.filter = `brightness(${brightness})`;
    // Pre-fill start-screen duration with saved default
    const durEl = document.getElementById('duration-select');
    if (durEl) durEl.value = String(Settings.get('sessionLength') || 25);
    // Pre-fill session panel break interval from saved settings
    const breakSel = document.getElementById('session-break-select');
    if (breakSel) {
      const saved = Settings.get('breakInterval');
      // Snap to nearest option value; fall back to 25 if the saved value isn't listed
      const opts = Array.from(breakSel.options).map(o => o.value);
      breakSel.value = opts.includes(String(saved)) ? String(saved) : '25';
    }
  }

  // 11. Wire cross-module communication
  _wireUI();
  _wireTimerToSounds();
  _wireTimerToCompanion();
  _wireBrainToSounds();
  _wireSessionToUI();
  _wireWindowControls();
  _wireKeybinds();
  _wireSettings();
  _wireBreakReminder();

  // ── _wireUI ───────────────────────────────────────────────────────────────
  // Button handlers, sensitivity selector, goal overlay.
  // All handlers guard against acting in wrong session state.

  function _wireUI() {
    // Start session button
    const startBtn = document.getElementById('start-session');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const stats = Session.getCurrentStats();
        if (stats && stats.state !== 'IDLE') return;
        const goalEl = document.getElementById('goal-input');
        const durEl  = document.getElementById('duration-select');
        const goal   = goalEl?.value?.trim() || null;
        const mins   = parseInt(durEl?.value || '25', 10);

        // Sync break interval from session panel if present
        const breakSel = document.getElementById('session-break-select');
        if (breakSel) {
          const breakMins = parseInt(breakSel.value, 10);
          BreakReminder.setInterval(breakMins);
        }

        Timer.init(mins);
        Session.startNew(mins, goal);
        Timer.start();
        const overlay = document.getElementById('goal-overlay');
        if (overlay) overlay.style.display = 'none';
      });
    }

    // Pause / break button
    const pauseBtn = document.getElementById('pause-session');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        if (Session.getCurrentStats()?.state !== 'ACTIVE') return;
        Session.pause();
        Timer.pause();
      });
    }

    // Resume button
    const resumeBtn = document.getElementById('resume-session');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        if (Session.getCurrentStats()?.state !== 'PAUSED') return;
        Session.resume();
        Timer.resume();
      });
    }

    // Abandon button (active state)
    const abandonBtn = document.getElementById('abandon-session');
    if (abandonBtn) {
      abandonBtn.addEventListener('click', () => {
        const s = Session.getCurrentStats()?.state;
        if (s !== 'ACTIVE' && s !== 'PAUSED') return;
        Session.abandon();
        Timer.reset();
      });
    }

    // Abandon button (break/paused state — separate DOM button)
    const abandonBreakBtn = document.getElementById('abandon-session-break');
    if (abandonBreakBtn) {
      abandonBreakBtn.addEventListener('click', () => {
        if (Session.getCurrentStats()?.state !== 'PAUSED') return;
        Session.abandon();
        Timer.reset();
      });
    }

    // "New session" button on the outcome screen → reset back to IDLE
    const newSessionBtn = document.getElementById('new-session-btn');
    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', () => {
        Session.reset();
        Timer.reset();
        // Clear goal input for fresh start
        const goalEl = document.getElementById('goal-input');
        if (goalEl) goalEl.value = '';
      });
    }

    // Goal achieved buttons (outcome screen)
    const goalYes = document.getElementById('goal-achieved-yes');
    const goalNo  = document.getElementById('goal-achieved-no');
    if (goalYes) goalYes.addEventListener('click', () => Session.setGoalAchieved(true));
    if (goalNo)  goalNo.addEventListener('click',  () => Session.setGoalAchieved(false));

    // Sensitivity selector (legacy — kept for any external HTML using it)
    const sensitivitySel = document.getElementById('sensitivity-select');
    if (sensitivitySel) {
      sensitivitySel.value = localStorage.getItem('deskbuddy_sensitivity') || 'NORMAL';
      sensitivitySel.addEventListener('change', (e) => Brain.setSensitivity(e.target.value));
    }
  }

  // ── _wireTimerToSounds ────────────────────────────────────────────────────
  // Tick sounds (one per logical timer-second) + notable state transitions.

  function _wireTimerToSounds() {
    Timer.onTick(() => {
      const state = Timer.getState();
      // CRITICAL ticks much less often (0.08× speed) — same sound but rare is intentional
      const tickMap = {
        FOCUSED:    'focused_tick',
        DRIFTING:   'drifting_tick',
        DISTRACTED: 'distracted_tick',
        CRITICAL:   'distracted_tick',
        FAILED:     null,
      };
      const sound = tickMap[state];
      if (sound) Sounds.play(sound);
    });

    Timer.onStateChange((newState, oldState) => {
      // session_start / session_complete / session_fail / break_start / break_end
      // are fired by session.js internally so we don't duplicate them here.
      // Only timer-level transition sounds belong here.
      if (newState === 'FOCUSED' && oldState !== 'FOCUSED') {
        // refocus is also fired by session.js for DISTRACTED/CRITICAL→FOCUSED;
        // session.js guards against playing it twice via its state machine.
        // No-op here to avoid double-play.
      }
    });
  }

  // ── _wireTimerToCompanion ─────────────────────────────────────────────────
  // Map timer state to companion emotion overrides.
  // brain.js applyFocusEmotion() runs every rAF frame and may subsequently
  // override these; that's intentional — brain adjusts for perception nuance.

  function _wireTimerToCompanion() {
    Timer.onStateChange((newState) => {
      const emotionMap = {
        FOCUSED:    null,         // brain handles normally
        DRIFTING:   'suspicious',
        DISTRACTED: 'pouty',
        CRITICAL:   'grumpy',
        FAILED:     'crying',
      };
      const emotion = emotionMap[newState];
      if (emotion) Emotion.setState(emotion);
      // Expose timer state as a data attribute so CSS can colour the focus dot
      document.body.dataset.timerState = newState;
    });
  }

  // ── _wireBrainToSounds ────────────────────────────────────────────────────
  // Brain callbacks → audio responses.

  function _wireBrainToSounds() {
    Brain.onPhoneDetected(() => {
      // suspicious_squint is already played inside brain.js; this hook is for
      // any additional renderer-level side-effects (UI flash, logging, etc.).
      // Playing here would double-play — intentionally a no-op.
    });

    Brain.onMilestone((mins) => {
      // overjoyed_chirp is played inside brain.js _fireMilestone.
      // Renderer hook available for UI milestone badges etc.
      const badge = document.getElementById('milestone-badge');
      if (badge) {
        badge.textContent = `${mins} min ✦`;
        badge.classList.add('visible');
        setTimeout(() => badge.classList.remove('visible'), 3000);
      }
    });
  }

  // ── _wireSessionToUI ──────────────────────────────────────────────────────
  // Session state changes → DOM visibility / content updates.

  let _breakCountdownInterval = null;

  function _wireSessionToUI() {
    Session.onSessionStateChange((newState) => {
      const stats = Session.getCurrentStats();

      // Panel visibility
      _setVisible('session-idle',    newState === 'IDLE');
      _setVisible('session-active',  newState === 'ACTIVE');
      _setVisible('session-paused',  newState === 'PAUSED');
      _setVisible('outcome-screen',
        newState === 'COMPLETED' || newState === 'FAILED' || newState === 'ABANDONED');

      // Session countdown timer — show during active/paused, hide otherwise
      const sessionTimerEl = document.getElementById('session-timer');
      if (sessionTimerEl) {
        sessionTimerEl.style.display =
          (newState === 'ACTIVE' || newState === 'PAUSED') ? '' : 'none';
      }

      // Break countdown — start/stop the live update interval
      if (newState === 'PAUSED') {
        _startBreakCountdown();
      } else {
        _stopBreakCountdown();
      }

      // Goal display in active panel
      const goalDisplay = document.getElementById('goal-display');
      if (goalDisplay) {
        const txt = stats?.goalText || '';
        goalDisplay.textContent = txt;
        goalDisplay.style.display = (newState === 'ACTIVE' && txt) ? '' : 'none';
      }

      // Goal achievement prompt on outcome screen
      const goalPrompt = document.getElementById('goal-prompt');
      if (goalPrompt) {
        const hasGoal = !!(stats?.goalText || Session.getHistory()[0]?.goalText);
        const isEnd   = newState === 'COMPLETED' || newState === 'FAILED';
        goalPrompt.style.display = (isEnd && hasGoal) ? '' : 'none';
      }

      // Outcome label
      const outcomeLabel = document.getElementById('outcome-label');
      if (outcomeLabel) {
        if      (newState === 'COMPLETED')  outcomeLabel.textContent = '✦ session complete!';
        else if (newState === 'FAILED')     outcomeLabel.textContent = 'session ended early.';
        else if (newState === 'ABANDONED')  outcomeLabel.textContent = 'session abandoned.';
        else                                outcomeLabel.textContent = '';
      }

      // Reset timer state body attribute when session ends
      if (newState === 'IDLE' || newState === 'COMPLETED' || newState === 'FAILED' || newState === 'ABANDONED') {
        delete document.body.dataset.timerState;
      }
    });
  }

  // ── Break countdown helpers ───────────────────────────────────────────────

  function _startBreakCountdown() {
    _stopBreakCountdown();
    _updateBreakCountdown();
    _breakCountdownInterval = setInterval(_updateBreakCountdown, 1000);
  }

  function _stopBreakCountdown() {
    if (_breakCountdownInterval !== null) {
      clearInterval(_breakCountdownInterval);
      _breakCountdownInterval = null;
    }
  }

  function _updateBreakCountdown() {
    const el = document.getElementById('break-countdown');
    if (!el) return;
    const ms = Session.getBreakTimeRemaining();
    const totalSecs = Math.max(0, Math.ceil(ms / 1000));
    const m = String(Math.floor(totalSecs / 60));
    const s = String(totalSecs % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  function _setVisible(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }


  // ── Compact window — mode toggle ────────────────────────────────────────
  // The companion starts as a small floating overlay (PiP mode).
  // A toggle button (or Ctrl/Cmd+Shift+P) switches between compact and full.
  // The window is always interactive in PiP mode — no click-through.

  let _isFullMode = true;  // starts in full-screen

  // ── Mode toggle ───────────────────────────────────────────────────────────

  function _enterFullMode() {
    if (_isFullMode) return;
    _isFullMode = true;
    document.body.classList.remove('pip-mode');
    document.body.classList.add('full-mode');
    if (window.electronAPI) window.electronAPI.enterFullMode();
  }

  function _exitFullMode() {
    if (!_isFullMode) return;
    _isFullMode = false;
    document.body.classList.remove('full-mode');
    document.body.classList.add('pip-mode');
    if (window.electronAPI) window.electronAPI.exitFullMode();
  }

  function _wireWindowControls() {
    // Keyboard shortcut registered via Keybinds in _wireKeybinds() below

    // Toggle buttons
    const expandBtn   = document.getElementById('compact-expand-btn');
    const collapseBtn = document.getElementById('full-collapse-btn');
    if (expandBtn)   expandBtn.addEventListener('click', () => _enterFullMode());
    if (collapseBtn) collapseBtn.addEventListener('click', () => _exitFullMode());

    // Sync mode state when main reports transitions (covers IPC-initiated toggles).
    if (window.electronAPI) {
      window.electronAPI.onFullModeEntered(() => {
        _isFullMode = true;
        document.body.classList.remove('pip-mode');
        document.body.classList.add('full-mode');
      });
      window.electronAPI.onFullModeExited(() => {
        _isFullMode = false;
        document.body.classList.remove('full-mode');
        document.body.classList.add('pip-mode');
      });
    }
  }

  // ── _wireKeybinds ─────────────────────────────────────────────────────────
  // Register all keyboard shortcuts in the central registry, then install the
  // single keydown listener.  Raw keydown handlers for these combos are removed
  // from _wireWindowControls / _wireSettings so there is exactly one listener.

  function _wireKeybinds() {
    Keybinds.register({
      id: 'toggle-pip',
      label: 'Toggle compact overlay',
      defaultKey: 'Ctrl+Shift+P',
      fn: () => _isFullMode ? _exitFullMode() : _enterFullMode(),
    });

    Keybinds.register({
      id: 'toggle-settings',
      label: 'Open / close settings',
      defaultKey: 'Ctrl+Shift+Comma',
      fn: () => document.getElementById('settings-gear-btn')?.click(),
    });

    Keybinds.register({
      id: 'cycle-mute-preset',
      label: 'Cycle mute preset',
      defaultKey: 'Ctrl+Shift+M',
      fn: () => {
        const order = ['ALL_ON', 'ESSENTIAL', 'REMINDERS_ONLY', 'ALL_OFF'];
        const cur   = Settings.get('mutePreset');
        Settings.set('mutePreset', order[(order.indexOf(cur) + 1) % order.length]);
      },
    });

    Keybinds.register({
      id: 'dismiss-break-reminder',
      label: 'Dismiss break reminder',
      defaultKey: 'Ctrl+Shift+B',
      fn: () => { if (BreakReminder.isActive()) BreakReminder.dismiss(); },
    });

    Keybinds.init();
  }

  // ── _wireSettings ─────────────────────────────────────────────────────────
  // Settings panel open/close/focus-trap + live change listeners.

  function _wireSettings() {
    const panel     = document.getElementById('settings-panel');
    const gearBtn   = document.getElementById('settings-gear-btn');
    const closeBtn  = document.getElementById('settings-close-btn');
    if (!panel || !gearBtn) return;

    // ── Open / close ────────────────────────────────────────────────────
    function openPanel() {
      panel.classList.add('settings-open');
      gearBtn.setAttribute('aria-expanded', 'true');
      // Focus first focusable inside the panel
      const first = _focusable(panel)[0];
      if (first) first.focus();
    }

    function closePanel() {
      panel.classList.remove('settings-open');
      gearBtn.setAttribute('aria-expanded', 'false');
      gearBtn.focus();
    }

    gearBtn.addEventListener('click', () => {
      panel.classList.contains('settings-open') ? closePanel() : openPanel();
    });

    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    // Escape closes the panel
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closePanel(); }
    });

    // Focus trap — Tab cycles within the panel
    panel.addEventListener('keydown', _trapFocusHandler);

    // ── Populate + wire settings controls ───────────────────────────────

    // Mute preset
    const muteSelect = document.getElementById('mute-preset-select');
    const muteDesc   = document.getElementById('mute-preset-desc');
    const PRESET_DESCS = {
      ALL_ON:         'All sounds enabled',
      ESSENTIAL:      'Session & break sounds only',
      REMINDERS_ONLY: 'Break sounds only',
      ALL_OFF:        'Completely silent',
    };
    if (muteSelect) {
      muteSelect.value = Settings.get('mutePreset');
      if (muteDesc) muteDesc.textContent = PRESET_DESCS[muteSelect.value] || '';
      muteSelect.addEventListener('change', (e) => {
        Settings.set('mutePreset', e.target.value);
        if (muteDesc) muteDesc.textContent = PRESET_DESCS[e.target.value] || '';
      });
    }

    // Break reminder toggle + interval
    const breakToggle   = document.getElementById('break-reminder-toggle');
    const breakInterval = document.getElementById('break-interval-select');
    const breakRow      = document.getElementById('break-interval-row');
    let _lastNonZeroInterval = Settings.get('breakInterval') || 25;

    function _syncBreakUI(interval) {
      const on = interval > 0;
      if (breakToggle) breakToggle.checked = on;
      if (breakInterval) {
        breakInterval.value = on ? String(interval) : String(_lastNonZeroInterval);
        breakInterval.disabled = !on;
      }
      if (breakRow) breakRow.style.opacity = on ? '1' : '0.4';
    }

    _syncBreakUI(Settings.get('breakInterval'));

    if (breakToggle) {
      breakToggle.addEventListener('change', () => {
        if (breakToggle.checked) {
          Settings.set('breakInterval', _lastNonZeroInterval);
        } else {
          const cur = parseInt(breakInterval?.value || '25', 10);
          if (cur > 0) _lastNonZeroInterval = cur;
          Settings.set('breakInterval', 0);
        }
      });
    }

    if (breakInterval) {
      breakInterval.addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        _lastNonZeroInterval = v;
        if (breakToggle?.checked) Settings.set('breakInterval', v);
      });
    }

    // Drone toggle
    const droneToggle = document.getElementById('drone-toggle');
    if (droneToggle) {
      droneToggle.checked = Settings.get('droneEnabled');
      droneToggle.addEventListener('change', () => Settings.set('droneEnabled', droneToggle.checked));
    }

    // Night volume toggle
    const nightToggle = document.getElementById('night-volume-toggle');
    if (nightToggle) {
      nightToggle.checked = Settings.get('nightAutoVolume');
      nightToggle.addEventListener('change', () => Settings.set('nightAutoVolume', nightToggle.checked));
    }

    // Sensitivity select
    const sensitivitySel = document.getElementById('settings-sensitivity-select');
    if (sensitivitySel) {
      sensitivitySel.value = Settings.get('sensitivity');
      sensitivitySel.addEventListener('change', (e) => Settings.set('sensitivity', e.target.value));
    }

    // Phone detection toggle
    const phoneToggle = document.getElementById('phone-detection-toggle');
    if (phoneToggle) {
      phoneToggle.checked = Settings.get('phoneDetection');
      phoneToggle.addEventListener('change', () => Settings.set('phoneDetection', phoneToggle.checked));
    }

    // ── Live change listeners ────────────────────────────────────────────
    Settings.onChange('mutePreset', (v) => {
      Sounds.setMutePreset(v);
      if (muteSelect) muteSelect.value = v;
      if (muteDesc)   muteDesc.textContent = PRESET_DESCS[v] || '';
    });

    Settings.onChange('breakInterval', (v) => {
      BreakReminder.setInterval(v);
      _syncBreakUI(v);
    });

    Settings.onChange('sensitivity', (v) => {
      Brain.setSensitivity(v);
      if (sensitivitySel) sensitivitySel.value = v;
    });

    Settings.onChange('phoneDetection', (v) => {
      if (window.Brain?.setPhoneDetectionEnabled) Brain.setPhoneDetectionEnabled(v);
      if (phoneToggle) phoneToggle.checked = v;
    });

    Settings.onChange('nightAutoVolume', (v) => {
      if (!v) Sounds.setNightGainMult(1.0);
      if (nightToggle) nightToggle.checked = v;
    });

    Settings.onChange('droneEnabled', (v) => {
      Soundscape.setEnabled(v);
      if (droneToggle) droneToggle.checked = v;
    });

    // ── Volume slider ────────────────────────────────────────────────────
    const volumeSlider  = document.getElementById('volume-slider');
    const volumeSubLabel = document.getElementById('volume-sublabel');

    function _applyVolume(v) {
      Sounds.setVolume(v);
      if (volumeSlider)   volumeSlider.value = Math.round(v * 100);
      if (volumeSubLabel) volumeSubLabel.textContent = `${Math.round(v * 100)}%`;
    }

    _applyVolume(Settings.get('volume'));

    if (volumeSlider) {
      volumeSlider.addEventListener('input', () => {
        const v = parseInt(volumeSlider.value, 10) / 100;
        Settings.set('volume', v);
      });
    }

    Settings.onChange('volume', (v) => _applyVolume(v));

    // ── Brightness slider ────────────────────────────────────────────────
    const brightnessSlider   = document.getElementById('brightness-slider');
    const brightnessSubLabel = document.getElementById('brightness-sublabel');

    function _applyBrightness(v) {
      const world = document.getElementById('world');
      if (world) world.style.filter = `brightness(${v})`;
      if (brightnessSlider)   brightnessSlider.value = Math.round(v * 100);
      if (brightnessSubLabel) brightnessSubLabel.textContent = `${Math.round(v * 100)}%`;
    }

    _applyBrightness(Settings.get('brightness'));

    if (brightnessSlider) {
      brightnessSlider.addEventListener('input', () => {
        const v = parseInt(brightnessSlider.value, 10) / 100;
        Settings.set('brightness', v);
      });
    }

    Settings.onChange('brightness', (v) => _applyBrightness(v));

    // ── Companion size ───────────────────────────────────────────────────
    const sizeBtnsContainer = document.getElementById('companion-size-btns');

    function _applyCompanionSize(size) {
      document.body.classList.remove('companion-size-S', 'companion-size-M', 'companion-size-L');
      document.body.classList.add(`companion-size-${size}`);
      if (sizeBtnsContainer) {
        sizeBtnsContainer.querySelectorAll('.settings-size-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.size === size);
        });
      }
    }

    _applyCompanionSize(Settings.get('companionSize'));

    if (sizeBtnsContainer) {
      sizeBtnsContainer.querySelectorAll('.settings-size-btn').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('companionSize', btn.dataset.size));
      });
    }

    Settings.onChange('companionSize', (v) => _applyCompanionSize(v));

    // ── Default session length ───────────────────────────────────────────
    const sessionLengthSel = document.getElementById('session-length-select');

    if (sessionLengthSel) {
      sessionLengthSel.value = String(Settings.get('sessionLength'));
      sessionLengthSel.addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        Settings.set('sessionLength', v);
        // Also update the start-screen duration selector if visible
        const durEl = document.getElementById('duration-select');
        if (durEl) durEl.value = String(v);
      });
    }

    Settings.onChange('sessionLength', (v) => {
      if (sessionLengthSel) sessionLengthSel.value = String(v);
      const durEl = document.getElementById('duration-select');
      if (durEl) durEl.value = String(v);
    });

    // Pre-fill start-screen duration selector with saved default now
    {
      const durEl = document.getElementById('duration-select');
      if (durEl) durEl.value = String(Settings.get('sessionLength'));
    }

    // ── Session stats (today) ────────────────────────────────────────────
    function _refreshSessionStats() {
      const todayLabel  = document.getElementById('sessions-today-label');
      const focusLabel  = document.getElementById('focus-today-label');
      if (!todayLabel && !focusLabel) return;

      const history = Session.getHistory ? Session.getHistory() : [];
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      let sessions = 0;
      let focusSec = 0;
      history.forEach(s => {
        const ts = s.date ? new Date(s.date).getTime() : 0;
        if (ts >= todayMs) {
          sessions++;
          focusSec += s.actualFocusedSeconds || 0;
        }
      });

      const focusMins = Math.round(focusSec / 60);
      if (todayLabel) todayLabel.textContent = `${sessions} session${sessions !== 1 ? 's' : ''} today`;
      if (focusLabel) focusLabel.textContent  = `${focusMins} min focused today`;
    }

    _refreshSessionStats();
    // Refresh stats each time the panel opens
    gearBtn.addEventListener('click', _refreshSessionStats);


    const emotionGrid = document.getElementById('emotion-grid');
    if (emotionGrid) {
      const GLOW = {
        idle: '155,135,255', curious: '115,125,245', focused: '110,130,225',
        sleepy: '130,140,210', suspicious: '115,120,240', happy: '160,140,245',
        scared: '195,218,255', sad: '100,145,210', crying: '75,120,195',
        pouty: '255,188,118', grumpy: '255,138,128', overjoyed: '255,240,198',
        sulking: '205,138,192', embarrassed: '255,120,155', forgiven: '255,160,190',
        excited: '255,228,120', shy: '255,142,198', love: '255,138,180',
        startled: '200,220,255',
      };
      const SOUND_MAP = {
        happy: 'happy_coo', curious: 'curious_ooh', overjoyed: 'overjoyed_chirp',
        excited: 'excited_chirp', shy: 'shy_squeak', love: 'love_purr',
        suspicious: 'suspicious_squint', pouty: 'pouty_mweh', grumpy: 'grumpy_hmph',
        scared: 'scared_eep', sad: 'sad_whimper', crying: 'crying_sob',
        startled: 'startled_gasp',
      };
      let _activeBtn = null;

      emotionGrid.style.cssText =
        'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:0 10px 10px;';

      Emotion.getStates().forEach(state => {
        const btn = document.createElement('button');
        btn.className = 'emotion-test-btn';
        btn.textContent = state;
        btn.title = `Preview: ${state}`;
        btn.style.setProperty('--glow-color', GLOW[state] || '155,135,255');
        btn.addEventListener('click', () => {
          if (_activeBtn) _activeBtn.classList.remove('active');
          btn.classList.add('active');
          _activeBtn = btn;
          const sound = SOUND_MAP[state];
          if (sound) Sounds.play(sound);
          Emotion.preview(state, 3000, () => {
            btn.classList.remove('active');
            if (_activeBtn === btn) _activeBtn = null;
          });
        });
        emotionGrid.appendChild(btn);
      });
    }

    // ── Shortcuts display ────────────────────────────────────────────────
    const shortcutsList = document.getElementById('shortcuts-list');
    if (shortcutsList) {
      Keybinds.getAll().forEach(({ label, currentKey }) => {
        const row = document.createElement('div');
        row.className = 'settings-row';
        const labelEl = document.createElement('div');
        labelEl.className = 'settings-row-label';
        labelEl.textContent = label;
        const chip = document.createElement('kbd');
        chip.className = 'shortcut-chip';
        chip.textContent = Keybinds.prettyKey(currentKey);
        row.appendChild(labelEl);
        row.appendChild(chip);
        shortcutsList.appendChild(row);
      });
    }
  }

  // ── _wireBreakReminder ────────────────────────────────────────────────────
  // BreakReminder lifecycle tied to session state.

  function _wireBreakReminder() {
    Session.onSessionStateChange((newState) => {
      if (newState === 'ACTIVE') {
        // If reminder was active during a session start, dismiss it first
        if (BreakReminder.isActive()) {
          BreakReminder.dismiss();
        }
        BreakReminder.start();
      } else if (newState === 'PAUSED') {
        BreakReminder.pause();
      } else {
        // IDLE | COMPLETED | FAILED | ABANDONED
        BreakReminder.stop();
      }
    });

    // When user resumes, dismiss any active reminder
    Session.onSessionStateChange((newState) => {
      if (newState === 'ACTIVE' && BreakReminder.isActive()) {
        BreakReminder.dismiss();
      }
    });

    // ── Break toast helpers ────────────────────────────────────────────────
    const breakToast        = document.getElementById('break-toast');
    const breakToastDismiss = document.getElementById('break-toast-dismiss');

    function _showBreakToast() {
      if (!breakToast) return;
      breakToast.classList.remove('break-toast-hiding');
      breakToast.classList.add('break-toast-visible');
    }

    function _hideBreakToast() {
      if (!breakToast) return;
      breakToast.classList.add('break-toast-hiding');
      // Wait for the slide-out animation to finish before fully hiding
      breakToast.addEventListener('animationend', (e) => {
        if (e.animationName !== 'breakToastOut') return;
        breakToast.classList.remove('break-toast-visible', 'break-toast-hiding');
      }, { once: true });
    }

    if (breakToastDismiss) {
      breakToastDismiss.addEventListener('click', () => BreakReminder.dismiss());
    }

    BreakReminder.onTrigger(() => {
      Sounds.play('break_start');
      Emotion.setState('excited');  // companion perks up: "hey, take a break!"
      _showBreakToast();
      setTimeout(() => {
        if (BreakReminder.isActive()) Emotion.setState(null);
      }, 3000);
    });

    BreakReminder.onDismiss(() => {
      Sounds.play('break_end');
      _hideBreakToast();
    });
  }

  // ── Focus trap helpers ────────────────────────────────────────────────────

  function _focusable(container) {
    return Array.from(container.querySelectorAll(
      'button, input, select, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.disabled && el.offsetParent !== null);
  }

  function _trapFocusHandler(e) {
    const panel     = document.getElementById('settings-panel');
    const focusable = _focusable(panel);
    const first     = focusable[0];
    const last      = focusable[focusable.length - 1];
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }
})();
