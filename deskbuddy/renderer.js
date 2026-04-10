/**
 * Renderer — main frontend entry point.
 *
 * Boot order: Sounds → Session → Timer → Companion → SpriteAnimator →
 *             Particles → Status → Camera/Perception → Brain → wire
 *
 * Cross-module communication rule: no module calls another directly.
 * All inter-module wiring lives exclusively in the four _wire* functions below.
 */
(function main() {
  const world     = document.getElementById('world');
  const statusBar = document.getElementById('status-bar');

  // 1. Audio context — register gesture listeners so AudioContext can resume
  Sounds.init();

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

  // The companion is always in compact-overlay mode — apply the class once,
  // at startup, before any wiring so CSS transitions don't flash.
  document.body.classList.add('pip-mode');

  // 10. Wire cross-module communication
  _wireUI();
  _wireTimerToSounds();
  _wireTimerToCompanion();
  _wireBrainToSounds();
  _wireSessionToUI();
  _wireWindowControls();

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


  // ── Compact window — size presets + mode toggle + mouse pass-through ─────
  // The companion starts as a small floating overlay.  A toggle button
  // (and Ctrl/Cmd+Shift+P) switches between compact and full-screen mode.
  // S / M / L buttons resize the compact window via IPC.
  // In compact mode, clicks pass through the window when the cursor is away.

  const SIZE_PRESETS = { S: 150, M: 200, L: 270 };
  let _currentPreset  = 'M';
  let _isFullMode     = false;

  // ── Mode toggle ───────────────────────────────────────────────────────────

  function _enterFullMode() {
    if (_isFullMode) return;
    _isFullMode = true;
    document.body.classList.remove('pip-mode');
    document.body.classList.add('full-mode');
    // Full mode is always interactive — kill pass-through immediately.
    if (window.electronAPI) {
      window.electronAPI.setIgnoreMouseEvents(false);
      window.electronAPI.enterFullMode();
    }
  }

  function _exitFullMode() {
    if (!_isFullMode) return;
    _isFullMode = false;
    document.body.classList.remove('full-mode');
    document.body.classList.add('pip-mode');
    if (window.electronAPI) window.electronAPI.exitFullMode();
    // Re-enable pass-through for compact mode.
    _setupMousePassThrough();
  }

  // ── Size presets (compact mode only) ─────────────────────────────────────

  function _applySize(preset) {
    if (!SIZE_PRESETS[preset]) return;
    _currentPreset = preset;
    _markActiveSizeBtn(preset);
    if (window.electronAPI) window.electronAPI.resizeWindow(preset);
  }

  function _markActiveSizeBtn(preset) {
    document.querySelectorAll('.pip-size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === preset);
    });
  }

  // ── Mouse pass-through (compact mode only) ────────────────────────────────
  // Default: clicks pass through the window so the companion is non-intrusive.
  // As soon as the cursor enters the window area (mousemove fires even with
  // { forward: true } active), we re-enable interactions for dragging / buttons.

  function _setupMousePassThrough() {
    if (!window.electronAPI || _isFullMode) return;
    window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
  }

  function _wireWindowControls() {
    // Keyboard shortcut: Ctrl/Cmd + Shift + P → toggle compact / full
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === 'P') { e.preventDefault(); _isFullMode ? _exitFullMode() : _enterFullMode(); }
        if (e.key === 'S') { e.preventDefault(); if (!_isFullMode) _applySize('S'); }
        if (e.key === 'M') { e.preventDefault(); if (!_isFullMode) _applySize('M'); }
        if (e.key === 'L') { e.preventDefault(); if (!_isFullMode) _applySize('L'); }
      }
    });

    // Toggle buttons
    const expandBtn   = document.getElementById('compact-expand-btn');
    const collapseBtn = document.getElementById('full-collapse-btn');
    if (expandBtn)   expandBtn.addEventListener('click',   () => _enterFullMode());
    if (collapseBtn) collapseBtn.addEventListener('click', () => _exitFullMode());

    // S / M / L click handlers
    document.querySelectorAll('.pip-size-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!_isFullMode) _applySize(btn.dataset.size);
      });
    });

    // Sync active-button state when main reports the current size
    // (covers initial load and OS drag-handle resize).
    if (window.electronAPI) {
      window.electronAPI.onWindowReady((data) => {
        if (data && data.preset) { _currentPreset = data.preset; _markActiveSizeBtn(data.preset); }
      });
      window.electronAPI.onWindowResized((data) => {
        if (data && data.preset) { _currentPreset = data.preset; _markActiveSizeBtn(data.preset); }
      });
      window.electronAPI.onFullModeEntered(() => {
        _isFullMode = true;
        document.body.classList.remove('pip-mode');
        document.body.classList.add('full-mode');
      });
      window.electronAPI.onFullModeExited(() => {
        _isFullMode = false;
        document.body.classList.remove('full-mode');
        document.body.classList.add('pip-mode');
        _setupMousePassThrough();
      });
    }

    // Mark the default preset button while waiting for onWindowReady.
    _markActiveSizeBtn(_currentPreset);

    // Mouse pass-through — mousemove enables interaction, mouseleave restores it.
    // These listeners stay registered permanently; _setupMousePassThrough() is
    // called to (re)activate the pass-through state whenever compact mode starts.
    document.addEventListener('mousemove', () => {
      if (!_isFullMode && window.electronAPI)
        window.electronAPI.setIgnoreMouseEvents(false);
    }, { passive: true });
    document.addEventListener('mouseleave', () => {
      if (!_isFullMode && window.electronAPI)
        window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
    });

    // Start in compact pass-through mode.
    _setupMousePassThrough();
  }
})();
