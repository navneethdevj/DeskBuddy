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

  // 10. Wire cross-module communication
  _wireUI();
  _wireTimerToSounds();
  _wireTimerToCompanion();
  _wireBrainToSounds();
  _wireSessionToUI();
  _wirePip();

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

  // ── PiP (Picture-in-Picture) ──────────────────────────────────────────────
  // Purely a visual/window mode: shrinks to 120×120 overlay so the user can
  // work in another app while the companion keeps watching.
  // Timer, Brain, Perception, Sounds — all continue unchanged.

  let _isPipMode = false;

  function _enterPip() {
    if (_isPipMode) return;
    _isPipMode = true;
    document.body.classList.add('pip-mode');
    if (window.electronAPI) window.electronAPI.enterPip();
    _enablePipDrag();
  }

  function _exitPip() {
    if (!_isPipMode) return;
    _isPipMode = false;
    document.body.classList.remove('pip-mode');
    if (window.electronAPI) window.electronAPI.exitPip();
  }

  // Snap window to the nearest corner after a drag, with a 20px margin.
  function _snapToCorner(x, y) {
    const screenWidth  = screen.width;
    const screenHeight = screen.height;
    const windowWidth  = 280;  // must match PIP_SIZE.width in main.js
    const windowHeight = 240;  // must match PIP_SIZE.height in main.js
    const margin = 20;
    const corners = [
      { x: margin,                       y: margin                        },  // top-left
      { x: screenWidth - windowWidth - margin, y: margin                  },  // top-right
      { x: margin,                       y: screenHeight - windowHeight - margin },  // bottom-left
      { x: screenWidth - windowWidth - margin, y: screenHeight - windowHeight - margin },  // bottom-right
    ];
    const best = corners.reduce((nearest, corner) => {
      const d = Math.hypot(corner.x - x, corner.y - y);
      return d < nearest.dist ? { ...corner, dist: d } : nearest;
    }, { ...corners[0], dist: Infinity });
    return { x: best.x, y: best.y };
  }

  function _enablePipDrag() {
    const el = document.getElementById('world');
    if (!el) return;
    let isDragging  = false;
    let dragStart   = { x: 0, y: 0 };
    let winStart    = { x: 0, y: 0 };
    // Read the last-known stored position from localStorage as window origin
    const stored = JSON.parse(localStorage.getItem('deskbuddy_pip_pos') || 'null');
    winStart = stored || { x: 40, y: 40 };

    function onMouseDown(e) {
      if (!_isPipMode) return;
      isDragging = true;
      dragStart  = { x: e.screenX, y: e.screenY };
      // current window position at drag start
      const s = JSON.parse(localStorage.getItem('deskbuddy_pip_pos') || 'null');
      winStart = s || { x: 40, y: 40 };
      e.preventDefault();
    }

    function onMouseMove(e) {
      if (!isDragging || !_isPipMode) return;
      const dx = e.screenX - dragStart.x;
      const dy = e.screenY - dragStart.y;
      const newX = winStart.x + dx;
      const newY = winStart.y + dy;
      if (window.electronAPI) window.electronAPI.savePipPosition({ x: newX, y: newY });
    }

    function onMouseUp(e) {
      if (!isDragging) return;
      isDragging = false;
      const dx = e.screenX - dragStart.x;
      const dy = e.screenY - dragStart.y;
      const rawX = winStart.x + dx;
      const rawY = winStart.y + dy;
      const snapped = _snapToCorner(rawX, rawY);
      localStorage.setItem('deskbuddy_pip_pos', JSON.stringify(snapped));
      if (window.electronAPI) window.electronAPI.savePipPosition(snapped);
    }

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function _wirePip() {
    // Keyboard shortcut: Ctrl/Cmd + Shift + P
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        _isPipMode ? _exitPip() : _enterPip();
      }
    });

    // Collapse button (full mode → PiP)
    const collapseBtn = document.getElementById('pip-collapse-btn');
    if (collapseBtn) collapseBtn.addEventListener('click', () => _enterPip());

    // Expand button (PiP → full mode)
    const expandBtn = document.getElementById('pip-expand-btn');
    if (expandBtn) expandBtn.addEventListener('click', () => _exitPip());

    // Double-click companion in PiP → exit PiP
    const worldEl = document.getElementById('world');
    if (worldEl) {
      worldEl.addEventListener('dblclick', () => {
        if (_isPipMode) _exitPip();
      });
    }

    // IPC confirmation callbacks (from main process after window resize).
    // localStorage tracks the drag-origin for the current render session;
    // main.js JSON file provides cross-session persistence. Both are kept in
    // sync via savePipPosition so they never diverge.
    if (window.electronAPI) {
      window.electronAPI.onPipEntered(() => {
        // Window has been resized to PiP — no additional renderer work needed.
      });
      window.electronAPI.onPipExited(() => {
        // Window has been restored to full — no additional renderer work needed.
      });
    }
  }
})();
