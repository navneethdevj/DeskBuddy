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
  // Purely a visual/window mode: shrinks to a small overlay so the user can
  // work in another app while the companion keeps watching.
  // Timer, Brain, Perception, Sounds — all continue unchanged.

  let _isPipMode = false;
  // Guard: ensure drag listeners are registered only once for the window
  // lifetime so that enter/exit/enter cycles don't accumulate duplicate handlers.
  let _pipDragSetUp = false;

  // Mirrors the current pixel dimension sent from main.js on pip-entered /
  // pip-resized. Used to calculate correct snap corners and position clamping.
  const PIP_SIZES      = { small: 160, medium: 200, large: 260 };
  const PIP_SNAP_MARGIN = 20;  // px gap between snapped window edge and screen edge
  let   _pipDim        = PIP_SIZES.medium;
  let   _pipSizeName   = 'medium';

  function _enterPip() {
    if (_isPipMode) return;
    _isPipMode = true;
    document.body.classList.add('pip-mode');
    document.body.setAttribute('data-pip-size', _pipSizeName);
    if (window.electronAPI) window.electronAPI.enterPip();
    _enablePipDrag();
  }

  function _exitPip() {
    if (!_isPipMode) return;
    _isPipMode = false;
    document.body.classList.remove('pip-mode');
    document.body.removeAttribute('data-pip-size');
    if (window.electronAPI) window.electronAPI.exitPip();
  }

  function _applyPipSize(sizeName) {
    if (!PIP_SIZES[sizeName]) return;
    _pipSizeName = sizeName;
    _pipDim = PIP_SIZES[sizeName];
    // Update active button highlight
    document.querySelectorAll('.pip-size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === sizeName);
    });
    document.body.setAttribute('data-pip-size', sizeName);
    if (window.electronAPI) window.electronAPI.setPipSize(sizeName);
  }

  // Snap window to the nearest corner after a drag, with a 20px margin.
  // Use availWidth/availHeight (work area) so the window never snaps under
  // the OS taskbar or dock.
  function _snapToCorner(x, y) {
    const sw  = screen.availWidth;
    const sh  = screen.availHeight;
    const dim = _pipDim;
    const m   = PIP_SNAP_MARGIN;
    const corners = [
      { x: m,            y: m            },  // top-left
      { x: sw - dim - m, y: m            },  // top-right
      { x: m,            y: sh - dim - m },  // bottom-left
      { x: sw - dim - m, y: sh - dim - m },  // bottom-right
    ];
    const best = corners.reduce((nearest, corner) => {
      const d = Math.hypot(corner.x - x, corner.y - y);
      return d < nearest.dist ? { ...corner, dist: d } : nearest;
    }, { ...corners[0], dist: Infinity });
    // Clamp to valid screen area before returning so the window can never
    // be snapped off-screen regardless of screen.availWidth accuracy.
    return {
      x: Math.max(0, Math.min(best.x, sw - dim)),
      y: Math.max(0, Math.min(best.y, sh - dim)),
    };
  }

  function _enablePipDrag() {
    // Only register listeners once. Handlers already check _isPipMode so they
    // are dormant when PiP is inactive — re-registering on every entry would
    // accumulate duplicate handlers causing double IPC calls and double snaps.
    if (_pipDragSetUp) return;
    _pipDragSetUp = true;

    const el = document.getElementById('world');
    if (!el) return;
    let isDragging  = false;
    let dragStart   = { x: 0, y: 0 };
    let winStart    = { x: 0, y: 0 };

    /** Parse and validate a stored PiP position from localStorage. Returns null on invalid data. */
    function _loadStoredPos() {
      try {
        const raw = JSON.parse(localStorage.getItem('deskbuddy_pip_pos') || 'null');
        if (raw && typeof raw.x === 'number' && typeof raw.y === 'number'
                && isFinite(raw.x) && isFinite(raw.y)) return raw;
      } catch (_) {}
      return null;
    }

    // Read the last-known stored position from localStorage as window origin
    winStart = _loadStoredPos() || { x: 40, y: 40 };

    function onMouseDown(e) {
      if (!_isPipMode) return;
      // Ignore clicks on the control buttons so they don't start a drag
      if (e.target.closest('#pip-expand-btn, #pip-size-controls')) return;
      isDragging = true;
      dragStart  = { x: e.screenX, y: e.screenY };
      // current window position at drag start
      winStart = _loadStoredPos() || { x: 40, y: 40 };
      e.preventDefault();
    }

    function onMouseMove(e) {
      if (!isDragging || !_isPipMode) return;
      const dx = e.screenX - dragStart.x;
      const dy = e.screenY - dragStart.y;
      // Clamp during live drag so window never goes off-screen mid-move.
      const raw = { x: winStart.x + dx, y: winStart.y + dy };
      const clamped = {
        x: Math.max(0, Math.min(raw.x, screen.availWidth  - _pipDim)),
        y: Math.max(0, Math.min(raw.y, screen.availHeight - _pipDim)),
      };
      if (window.electronAPI) window.electronAPI.savePipPosition(clamped);
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

    // Size buttons — S / M / L
    document.querySelectorAll('.pip-size-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_isPipMode) _applyPipSize(btn.dataset.size);
      });
    });
    // Mark the default size button active
    const defaultSizeBtn = document.querySelector(`.pip-size-btn[data-size="${_pipSizeName}"]`);
    if (defaultSizeBtn) defaultSizeBtn.classList.add('active');

    // Double-click companion in PiP → exit PiP
    const worldEl = document.getElementById('world');
    if (worldEl) {
      worldEl.addEventListener('dblclick', (e) => {
        if (_isPipMode && !e.target.closest('#pip-expand-btn, #pip-size-controls')) _exitPip();
      });
    }

    // IPC confirmation callbacks (from main process after window resize).
    // localStorage tracks the drag-origin for the current render session;
    // main.js JSON file provides cross-session persistence. Both are kept in
    // sync via savePipPosition so they never diverge.
    if (window.electronAPI) {
      window.electronAPI.onPipEntered((data) => {
        // Sync local dim tracker with what main reported
        if (data && data.size) _pipDim = data.size;
      });
      window.electronAPI.onPipExited(() => {
        // Window has been restored to full — no additional renderer work needed.
      });
      window.electronAPI.onPipResized((data) => {
        if (data && data.size) _pipDim = data.size;
        // Re-read current position into localStorage after resize so the next
        // drag origin is correct.
        if (window.electronAPI) {
          // The main process has already moved+sized the window; persist pos.
          const stored = localStorage.getItem('deskbuddy_pip_pos');
          if (stored) window.electronAPI.savePipPosition(JSON.parse(stored));
        }
      });
    }
  }
})();
