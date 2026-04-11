/**
 * Renderer — main frontend entry point.
 *
 * Boot order: Sounds → Session → Timer → BreakReminder → Companion → SpriteAnimator →
 *             Particles → Status → Camera/Perception → Brain → wire
 *
 * Cross-module communication rule: no module calls another directly.
 * All inter-module wiring lives exclusively in the four _wire* functions below.
 */
(function main() {
  const world     = document.getElementById('world');
  const statusBar = document.getElementById('status-bar');

  // 0. Settings — load persisted prefs before any module reads them
  Settings.init();

  // 1. Audio context — register gesture listeners so AudioContext can resume
  Sounds.init();

  // 2. Session — load localStorage history
  Session.init();

  // 3. Timer — set up default 25-min session (not started yet)
  Timer.init(25);

  // 4. Break reminder — init with saved interval (starts on session ACTIVE)
  BreakReminder.init(
    Settings.get('breakReminderEnabled') ? Settings.get('breakInterval') : 0
  );

  // 5. Companion DOM
  Companion.create(world);

  // 6. Sprite animation engine
  SpriteAnimator.init(Companion.getElement());

  // 7. Particle effects
  Particles.init(world);

  // 8. Status UI
  Status.init(statusBar);

  // 9. Face tracking (async, non-blocking — app works without camera)
  Camera.init()
    .then(() => Perception.init())
    .catch((err) => {
      console.warn('[Renderer] Camera init failed:', err);
      Perception.init();
    });

  // 10. Brain loop
  Brain.start();

  // The companion starts in full-screen mode on launch.
  // The user can switch to compact PiP overlay via the collapse button.
  document.body.classList.add('full-mode');

  // 11. Wire cross-module communication
  _wireUI();
  _wireTimerToSounds();
  _wireTimerToCompanion();
  _wireBrainToSounds();
  _wireSessionToUI();
  _wireWindowControls();
  _wireSettings();
  _wireBreakReminder();

  // 12. Settings panel — must come after all modules are initialised
  SettingsPanel.init();

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

    // Abandon button
    const abandonBtn = document.getElementById('abandon-session');
    if (abandonBtn) {
      abandonBtn.addEventListener('click', () => {
        const s = Session.getCurrentStats()?.state;
        if (s !== 'ACTIVE' && s !== 'PAUSED') return;
        Session.abandon();
        Timer.reset();
      });
    }

    // Goal achieved buttons (outcome screen)
    const goalYes = document.getElementById('goal-achieved-yes');
    const goalNo  = document.getElementById('goal-achieved-no');
    if (goalYes) goalYes.addEventListener('click', () => Session.setGoalAchieved(true));
    if (goalNo)  goalNo.addEventListener('click',  () => Session.setGoalAchieved(false));

    // Sensitivity selector
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

  function _wireSessionToUI() {
    Session.onSessionStateChange((newState) => {
      const stats = Session.getCurrentStats();

      // Panel visibility
      _setVisible('session-idle',    newState === 'IDLE');
      _setVisible('session-active',  newState === 'ACTIVE');
      _setVisible('session-paused',  newState === 'PAUSED');
      _setVisible('outcome-screen',
        newState === 'COMPLETED' || newState === 'FAILED' || newState === 'ABANDONED');

      // Goal display below timer
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
    });
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  function _setVisible(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }


  // ── _wireSettings ─────────────────────────────────────────────────────────
  // Apply persisted settings to live modules on startup and keep them in sync.

  function _wireSettings() {
    // Apply saved mute preset to Sounds on startup
    Sounds.setMutePreset(Settings.get('mutePreset'));

    // Apply live changes whenever a setting is updated (from panel or keybind)
    Settings.onChange('mutePreset',           (v) => Sounds.setMutePreset(v));
    Settings.onChange('droneEnabled',         (v) => {
      if (window.Soundscape) { v ? Soundscape.resume() : Soundscape.stop(); }
    });
    Settings.onChange('brightness',           (v) => {
      const world = document.getElementById('world');
      if (world) world.style.filter = `brightness(${v})`;
    });
    Settings.onChange('sensitivity',          (v) => Brain.setSensitivity(v));
    Settings.onChange('phoneDetection',       (v) => Brain.setPhoneDetectionEnabled(v));
    Settings.onChange('nightAutoVolume',      (v) => {
      if (!v) Sounds.setNightGainMult(1.0);  // disable night reduction
      // If re-enabled, Brain's next applyTimePeriod call will restore 0.8 at NIGHT
    });
    Settings.onChange('breakReminderEnabled', (v) => {
      BreakReminder.setInterval(v ? Settings.get('breakInterval') : 0);
    });
    Settings.onChange('breakInterval',        (v) => {
      if (Settings.get('breakReminderEnabled')) BreakReminder.setInterval(v);
    });
  }

  // ── _wireBreakReminder ────────────────────────────────────────────────────
  // Connect BreakReminder lifecycle to Session and wire audio/emotion responses.

  function _wireBreakReminder() {
    // Start / pause / stop the accumulator with session state
    Session.onSessionStateChange((state) => {
      if (state === 'ACTIVE') {
        // On resume: dismiss any leftover active reminder, then restart accumulation
        if (BreakReminder.isActive()) BreakReminder.dismiss();
        BreakReminder.resume();
      } else if (state === 'PAUSED') {
        BreakReminder.pause();
      } else {
        // IDLE / COMPLETED / FAILED / ABANDONED — stop fully and reset
        BreakReminder.stop();
      }
    });

    // When reminder fires — visual handled inside break-reminder.js (CSS vars)
    BreakReminder.onTrigger(() => {
      Sounds.play('break_start');
      Emotion.setState('excited');  // companion perks up: "hey, take a break!"
      Brain.showWhisper('hey, take a break! you earned it ✦', 5000);
      setTimeout(() => {
        if (BreakReminder.isActive()) Emotion.setState(null);
      }, 3000);
    });

    // When reminder is dismissed (user pressed pause/resume or session ended)
    BreakReminder.onDismiss(() => {
      Sounds.play('break_end');
    });
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
    // Keyboard shortcut: Ctrl/Cmd + Shift + P → toggle compact / full
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        _isFullMode ? _exitFullMode() : _enterFullMode();
      }

      // Ctrl/Cmd + Shift + M → cycle mute preset
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        const order = ['ALL_ON', 'ESSENTIAL', 'REMINDERS_ONLY', 'ALL_OFF'];
        const current = Settings.get('mutePreset');
        const next = order[(order.indexOf(current) + 1) % order.length];
        Settings.set('mutePreset', next);
      }
    });

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
})();
