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
  if (Brain.setIdleSpeed)      Brain.setIdleSpeed(Settings.get('idleSpeed') || 2);
  if (Brain.setExpressiveness) Brain.setExpressiveness(Settings.get('expressiveness') || 2);
  if (Brain.setPettingMode)    Brain.setPettingMode(Settings.get('pettingMode') || 2);

  // Apply saved blink rate
  if (Companion.setBlinkRate) Companion.setBlinkRate(Settings.get('blinkRate') || 'normal');

  // 10. Break reminder — init with saved interval (0 = disabled)
  BreakReminder.init(Settings.get('breakInterval'));

  // 11. DND module — init click-to-cancel on the indicator
  DND.init();

  // The companion starts in full-screen mode on launch.
  // The user can switch to compact PiP overlay via the collapse button.
  document.body.classList.add('full-mode');

  // Apply saved companion size and brightness before wiring UI
  {
    const size = Settings.get('companionSize') || 'M';
    document.body.classList.add(`companion-size-${size}`);

    // Brightness: apply to <html> so the body background (full-mode themes) is
    // also dimmed — not just #world content.
    const brightness = Settings.get('brightness') || 1.0;
    document.documentElement.style.filter = brightness < 1.0 ? `brightness(${brightness})` : '';

    // Apply saved appearance classes at boot (before first paint)
    const theme = Settings.get('fullTheme') || 'galaxy';
    document.body.classList.add(`theme-${theme}`);

    const eyeColor = Settings.get('eyeColor') || 'periwinkle';
    if (eyeColor !== 'periwinkle') document.body.classList.add(`eye-${eyeColor}`);

    const noseStyle = Settings.get('noseStyle') || 'triangle';
    if (noseStyle !== 'triangle') document.body.classList.add(`nose-${noseStyle}`);

    const mouthStyle = Settings.get('mouthStyle') || 'arc';
    if (mouthStyle !== 'arc') document.body.classList.add(`mouth-${mouthStyle}`);

    const companionPos = Settings.get('companionPos') || 'center';
    if (companionPos !== 'center') document.body.classList.add(`companion-pos-${companionPos}`);

    const eyeSpacing = Settings.get('eyeSpacing') || 'normal';
    if (eyeSpacing !== 'normal') document.body.classList.add(`eye-spacing-${eyeSpacing}`);

    if (!Settings.get('showEyebrows')) document.body.classList.add('hide-eyebrows');

    const pipOpacity = Settings.get('pipOpacity') != null ? Settings.get('pipOpacity') : 78;
    const worldEl = document.getElementById('world');
    if (worldEl) worldEl.style.setProperty('--pip-bg-opacity', (pipOpacity / 100).toFixed(2));

    // Pre-fill HH:MM:SS fields with saved default (sessionLength is in minutes)
    _setDurationSeconds((Settings.get('sessionLength') || 25) * 60);
    // Pre-fill session panel break interval from saved settings
    const breakSel = document.getElementById('session-break-select');
    if (breakSel) {
      const saved = Settings.get('breakInterval');
      breakSel.value = String(saved !== undefined ? saved : 25);
    }
  }

  // 12. Wire cross-module communication
  _wireUI();
  _wireTimerToSounds();
  _wireTimerToCompanion();
  _wireBrainToSounds();
  _wireSessionToUI();
  _wireWindowControls();
  _wireKeybinds();
  _wireSettings();
  _wireBreakReminder();
  _wireDND();
  _wireSidebar();
  _wireHistorySidebar();

  // 12. Sync main-process window state with the initial full-mode.
  // Without this, createWindow()'s alwaysOnTop=false is fine but the
  // main process doesn't know we're in full-mode until the user first
  // manually toggles.  Sending enterFullMode() now ensures alwaysOnTop
  // stays false in full mode and the initial skipTaskbar=false is set.
  if (window.electronAPI) window.electronAPI.enterFullMode();

  // ── Duration HH:MM:SS helpers ─────────────────────────────────────────────
  // Read/write the three HH:MM:SS number fields as a single total-seconds value.

  function _getDurationSeconds() {
    const h = parseInt(document.getElementById('duration-h')?.value, 10) || 0;
    const m = parseInt(document.getElementById('duration-m')?.value, 10) || 0;
    const s = parseInt(document.getElementById('duration-s')?.value, 10) || 0;
    return h * 3600 + m * 60 + s;
  }

  function _setDurationSeconds(totalSecs) {
    totalSecs = Math.max(0, Math.min(86399, Math.round(totalSecs)));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const hEl = document.getElementById('duration-h');
    const mEl = document.getElementById('duration-m');
    const sEl = document.getElementById('duration-s');
    if (hEl) hEl.value = String(h);
    if (mEl) mEl.value = String(m);
    if (sEl) sEl.value = String(s);
  }

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
        const goal   = goalEl?.value?.trim() || null;
        const mins   = _getDurationMinutes();

        // Sync break interval from session panel
        BreakReminder.setInterval(_getBreakMinutes());

        Timer.init(mins);
        // Read currently selected category pill
        const activeCatPill = document.querySelector('.sp-cat-pill.active');
        const category = activeCatPill ? activeCatPill.dataset.cat : (Settings.get('sessionCategory') || 'study');
        Settings.set('sessionCategory', category);
        Session.startNew(mins, goal, category);
        Timer.start();
        const overlay = document.getElementById('goal-overlay');
        if (overlay) overlay.style.display = 'none';
      });
    }

    _wireSteppers();

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

    // "New session" button on the outcome screen (FAILED / ABANDONED) → reset back to IDLE
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

    // ── Category pills ─────────────────────────────────────────────────────
    // Wire activity category buttons, pre-select saved category, and update daily goal arc.
    const catPillsContainer = document.getElementById('sp-category-pills');
    if (catPillsContainer) {
      const savedCat = Settings.get('sessionCategory') || 'study';
      catPillsContainer.querySelectorAll('.sp-cat-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.cat === savedCat);
        pill.addEventListener('click', () => {
          catPillsContainer.querySelectorAll('.sp-cat-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          Settings.set('sessionCategory', pill.dataset.cat);
        });
      });
    }

    // ── Daily goal arc — initial render ───────────────────────────────────
    _updateDailyGoalArc();

    // ── Quick-preset duration pills (mouseenter on session icon triggers panel open)
    // Re-render the daily goal whenever the panel becomes visible (via mouseover)
    const spIcon = document.getElementById('sp-icon');
    if (spIcon) spIcon.addEventListener('mouseenter', () => _updateDailyGoalArc());
  }

  // ── Stepper helpers ───────────────────────────────────────────────────────
  // Convert the stepper number + unit-select into fractional minutes consumed
  // by Timer.init() and BreakReminder.setInterval().

  function _getDurationMinutes() {
    const totalSecs = _getDurationSeconds();
    return Math.max(1 / 60, totalSecs / 60);
  }

  function _getBreakMinutes() {
    const h = parseInt(document.getElementById('break-h')?.value, 10) || 0;
    const m = parseInt(document.getElementById('break-m')?.value, 10) || 0;
    const s = parseInt(document.getElementById('break-s')?.value, 10) || 0;
    const totalSecs = h * 3600 + m * 60 + s;
    if (totalSecs <= 0) return 0;
    return totalSecs / 60;
  }

  function _setBreakSeconds(totalSecs) {
    totalSecs = Math.max(0, Math.min(86399, Math.round(totalSecs)));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const hEl = document.getElementById('break-h');
    const mEl = document.getElementById('break-m');
    const sEl = document.getElementById('break-s');
    if (hEl) hEl.value = String(h);
    if (mEl) mEl.value = String(m);
    if (sEl) sEl.value = String(s);
  }

  function _getBreakSeconds() {
    const h = parseInt(document.getElementById('break-h')?.value, 10) || 0;
    const m = parseInt(document.getElementById('break-m')?.value, 10) || 0;
    const s = parseInt(document.getElementById('break-s')?.value, 10) || 0;
    return h * 3600 + m * 60 + s;
  }

  // ── _wireSteppers ─────────────────────────────────────────────────────────
  // Wire +/− buttons and unit-select changes for all sp-stepper inputs.
  // Unit change converts the current value to the new unit (rounded to step).

  function _wireSteppers() {
    // ── HH:MM:SS duration +/− buttons ────────────────────────────────────
    function _clampHmsFields(hId, mId, sId) {
      const hEl = document.getElementById(hId);
      const mEl = document.getElementById(mId);
      const sEl = document.getElementById(sId);
      if (hEl) hEl.value = String(Math.max(0, Math.min(23, parseInt(hEl.value, 10) || 0)));
      if (mEl) mEl.value = String(Math.max(0, Math.min(59, parseInt(mEl.value, 10) || 0)));
      if (sEl) sEl.value = String(Math.max(0, Math.min(59, parseInt(sEl.value, 10) || 0)));
    }

    // Clamp individual fields on manual edit
    ['duration-h', 'duration-m', 'duration-s'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => _clampHmsFields('duration-h', 'duration-m', 'duration-s'));
    });
    ['break-h', 'break-m', 'break-s'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => _clampHmsFields('break-h', 'break-m', 'break-s'));
    });

    const decBtn = document.getElementById('duration-dec');
    const incBtn = document.getElementById('duration-inc');

    if (decBtn) {
      decBtn.addEventListener('click', () => {
        const stepSecs = (Settings.get('timerStep') || 5) * 60;
        const cur  = _getDurationSeconds();
        const next = Math.max(0, cur - stepSecs);
        _setDurationSeconds(next);
      });
    }

    if (incBtn) {
      incBtn.addEventListener('click', () => {
        const stepSecs = (Settings.get('timerStep') || 5) * 60;
        const cur  = _getDurationSeconds();
        const next = Math.min(86399, cur + stepSecs);
        _setDurationSeconds(next);
      });
    }

    const breakDecBtn = document.getElementById('break-dec');
    const breakIncBtn = document.getElementById('break-inc');
    const BREAK_STEP_SECS = 5 * 60; // 5 min default step for break

    if (breakDecBtn) {
      breakDecBtn.addEventListener('click', () => {
        const cur  = _getBreakSeconds();
        const next = Math.max(0, cur - BREAK_STEP_SECS);
        _setBreakSeconds(next);
      });
    }

    if (breakIncBtn) {
      breakIncBtn.addEventListener('click', () => {
        const cur  = _getBreakSeconds();
        const next = Math.min(86399, cur + BREAK_STEP_SECS);
        _setBreakSeconds(next);
      });
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
  // Expose timer state on <body> so CSS and brain.js can react to it.
  // Emotion selection for DRIFTING/DISTRACTED/CRITICAL is handled inside
  // brain.js applyFocusEmotion() — setting it here too causes a race where
  // the rAF emotion loop immediately overrides whatever we set.
  // FAILED emotion is handled in _wireSessionToUI via the session outcome.

  function _wireTimerToCompanion() {
    Timer.onStateChange((newState) => {
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

  /** Format seconds as H:MM:SS (hours omitted when 0). */
  function _fmtSecs(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  let _breakCountdownInterval = null;
  let _sessionTotalSeconds    = 0;   // set on ACTIVE; used for progress ring
  let _dailyGoalLastTick      = 0;   // throttle daily goal arc updates during sessions
  let _budgetWarnedAt         = -1;  // distraction count at which we last warned

  // ── Live focus heatmap — 90 per-second coloured blocks ────────────────────
  const HEATMAP_MAX_BLOCKS = 90;
  const _heatmapData       = [];
  let   _heatmapInterval   = null;

  function _heatmapPush() {
    const state = (typeof Timer !== 'undefined' && Timer.getState?.()) || 'FOCUSED';
    _heatmapData.push(state.toLowerCase());
    if (_heatmapData.length > HEATMAP_MAX_BLOCKS) _heatmapData.shift();
    _heatmapRender();
  }

  function _heatmapRender() {
    const strip = document.getElementById('focus-heatmap-strip');
    if (!strip) return;
    strip.innerHTML = '';
    const empties = HEATMAP_MAX_BLOCKS - _heatmapData.length;
    for (let i = 0; i < empties; i++) {
      const b = document.createElement('div');
      b.className = 'fh-block fh-empty';
      strip.appendChild(b);
    }
    _heatmapData.forEach(s => {
      const b = document.createElement('div');
      b.className = `fh-block fh-${s}`;
      strip.appendChild(b);
    });
  }

  function _heatmapStart() {
    _heatmapData.length = 0;
    if (_heatmapInterval) clearInterval(_heatmapInterval);
    _heatmapInterval = setInterval(_heatmapPush, 1000);
    _heatmapRender();
  }

  function _heatmapStop() {
    if (_heatmapInterval) { clearInterval(_heatmapInterval); _heatmapInterval = null; }
  }
  // ─────────────────────────────────────────────────────────────────────────

  function _wireSessionToUI() {
    Session.onSessionStateChange((newState, oldState) => {
      const stats = Session.getCurrentStats();

      // Panel visibility (sidebar panels)
      _setVisible('session-idle',    newState === 'IDLE');
      _setVisible('session-active',  newState === 'ACTIVE');
      _setVisible('session-paused',  newState === 'PAUSED');

      // Outcome popup — shown only for FAILED / ABANDONED.
      // COMPLETED uses the share-card modal instead (see below).
      const outcomeEl = document.getElementById('outcome-screen');
      if (outcomeEl) {
        const isOutcome = newState === 'FAILED' || newState === 'ABANDONED';
        outcomeEl.classList.toggle('outcome-visible', isOutcome);
        outcomeEl.setAttribute('aria-hidden', String(!isOutcome));
      }

      // Session countdown timer — show during active/paused, hide otherwise
      const sessionTimerEl = document.getElementById('session-timer');
      if (sessionTimerEl) {
        sessionTimerEl.style.display =
          (newState === 'ACTIVE' || newState === 'PAUSED') ? '' : 'none';
      }

      // ── On session start: snapshot total duration for progress ring ──
      if (newState === 'ACTIVE') {
        _sessionTotalSeconds = _getDurationMinutes() * 60;
        // Reset ring to full
        const ring = document.getElementById('sp-ring-progress');
        if (ring) ring.style.strokeDashoffset = '0';
        const inlineTimer = document.getElementById('sp-inline-timer');
        if (inlineTimer) {
          inlineTimer.textContent = _fmtSecs(_sessionTotalSeconds);
        }
        // Reset focus stat bar on fresh start
        if (oldState === 'IDLE') {
          const fill  = document.getElementById('sp-focus-stat-fill');
          const pctEl = document.getElementById('sp-focus-stat-pct');
          if (fill)  fill.style.width = '0%';
          if (pctEl) pctEl.textContent = '–';
        }

        // Start live focus heatmap on fresh session start
        if (oldState === 'IDLE') _heatmapStart();

        // Immediate companion reaction — only on a fresh start (not resume from pause)
        if (oldState === 'IDLE') _fireSessionStartAnim();

        // Initialize distraction budget display
        if (oldState === 'IDLE') {
          const budget = Settings.get('distractionBudget') || 0;
          _renderBudgetDots(0, budget);
        }
      }

      // Break countdown — start/stop the live update interval
      if (newState === 'PAUSED') {
        _startBreakCountdown();
        if (Settings.get('breakAnimEnabled')) {
          // Teal glow sweeps up from the bottom
          const glow = document.getElementById('break-glow');
          if (glow) {
            glow.classList.add('active');
            setTimeout(() => glow.classList.remove('active'), 3500);
          }
          // Context-aware break card overlay + companion emotion
          _fireBreakCard(stats);
        }
        // Auto-open panel so user sees the break countdown
        _panelOpen();
      } else if (newState === 'ACTIVE' && oldState === 'PAUSED') {
        _stopBreakCountdown();
        _fireBreakEndAnim();
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

      // Goal achievement prompt on outcome screen (FAILED and ABANDONED — goal still relevant)
      const goalPrompt = document.getElementById('goal-prompt');
      if (goalPrompt) {
        const hasGoal = !!(stats?.goalText || Session.getHistory()[0]?.goalText);
        const isEnd   = newState === 'FAILED' || newState === 'ABANDONED';
        goalPrompt.style.display = (isEnd && hasGoal) ? '' : 'none';
      }

      // Outcome label + effects
      const outcomeLabel = document.getElementById('outcome-label');
      if (outcomeLabel) {
        if      (newState === 'COMPLETED')  outcomeLabel.textContent = '✦ session complete!';
        // Both FAILED and ABANDONED share the same user-facing message intentionally —
        // the distinction (distraction vs. manual exit) is captured in session history.
        else if (newState === 'FAILED')     outcomeLabel.textContent = 'session ended early.';
        else if (newState === 'ABANDONED')  outcomeLabel.textContent = 'session ended early.';
        else                                outcomeLabel.textContent = '';
      }

      if (newState === 'COMPLETED') {
        // Capture session data + emotion snapshot before reset
        const lastSession = Session.getHistory()[0];
        const emotion     = (typeof Emotion !== 'undefined' && Emotion.getState?.()) || 'happy';

        // Confetti celebration
        setTimeout(() => _fireCelebration('complete'), 400);

        // Auto-reset to IDLE so the session panel is immediately ready for a new session
        setTimeout(() => {
          Session.reset();
          Timer.reset();
        }, 50);

        // Show share card modal after the companion's celebration animation has room to play.
        // If in PiP mode, defer until the user returns to full-screen so the modal
        // doesn't cover the PiP window and block the expand button.
        setTimeout(() => {
          if (typeof ShareCard !== 'undefined' && lastSession) {
            if (_isFullMode) {
              ShareCard.show(lastSession, emotion);
            } else {
              _pendingShareCard = { sessionData: lastSession, emotion };
            }
          }
        }, 1800);
      }

      if (newState === 'FAILED' || newState === 'ABANDONED') {
        // Companion shows sad/crying for both failed and abandoned sessions
        Emotion.setState('crying');
        // session.js plays no sound for ABANDONED — renderer fills the gap here.
        if (newState === 'ABANDONED' && typeof Sounds !== 'undefined') Sounds.play('session_fail');
      }

      // After any session end, refresh the daily goal arc and hide budget display
      if (newState === 'COMPLETED' || newState === 'FAILED' || newState === 'ABANDONED') {
        setTimeout(() => _updateDailyGoalArc(), 200);
        const budgetRow = document.getElementById('sp-budget-row');
        if (budgetRow) budgetRow.style.display = 'none';
        _heatmapStop();
      }

      // Reset timer state body attribute when session ends
      if (newState === 'IDLE' || newState === 'FAILED' || newState === 'ABANDONED') {
        delete document.body.dataset.timerState;
      }
    });

    // ── Inline panel timer + progress ring (updated each logical timer-second) ──
    Timer.onTick(() => {
      const remaining = Timer.getRemainingSeconds();
      const inlineTimer = document.getElementById('sp-inline-timer');
      if (inlineTimer) inlineTimer.textContent = _fmtSecs(remaining);

      const ring = document.getElementById('sp-ring-progress');
      if (ring && _sessionTotalSeconds > 0) {
        const CIRC    = 138.23; // 2π × r=22
        const elapsed = _sessionTotalSeconds - remaining;
        ring.style.strokeDashoffset = String(CIRC * (elapsed / _sessionTotalSeconds));
      }

      // Live focus stat bar
      const stats = Session.getCurrentStats ? Session.getCurrentStats() : null;
      if (stats && stats.elapsed > 0) {
        const pct = Math.round((stats.focusedSeconds / stats.elapsed) * 100);
        const fill = document.getElementById('sp-focus-stat-fill');
        const pctEl = document.getElementById('sp-focus-stat-pct');
        if (fill) fill.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
      }

      // Distraction budget live update
      const budget = Settings.get('distractionBudget') || 0;
      if (budget > 0 && stats) {
        _renderBudgetDots(stats.distractionCount || 0, budget);
      }

      // Daily goal arc live update (only every 30s to avoid redraws on every tick)
      if (!_dailyGoalLastTick || Date.now() - _dailyGoalLastTick > 30000) {
        _dailyGoalLastTick = Date.now();
        _updateDailyGoalArc();
      }
    });

    // ── Distraction budget: warn when new distraction crosses the budget threshold ──
    Timer.onStateChange((newState, oldState) => {
      const budget = Settings.get('distractionBudget') || 0;
      if (budget <= 0) return;
      const isDistraction = (newState === 'DISTRACTED' || newState === 'CRITICAL') &&
                            (oldState === 'FOCUSED'    || oldState === 'DRIFTING');
      if (!isDistraction) return;

      // Give session.js a tick to increment the count first, then check
      setTimeout(() => {
        const s = Session.getCurrentStats ? Session.getCurrentStats() : null;
        if (!s) return;
        const used = s.distractionCount || 0;
        _renderBudgetDots(used, budget);
        if (used >= budget && used !== _budgetWarnedAt) {
          _budgetWarnedAt = used;
          _fireBudgetExceeded();
        }
      }, 50);
    });
  }

  // ── Helper: open the panel programmatically (auto-reveal on completion/break) ──
  function _panelOpen() {
    const panel = document.getElementById('session-panel');
    const icon  = document.getElementById('sp-icon');
    if (panel) panel.classList.add('sidebar-open');
    if (icon)  icon.classList.add('sp-icon-hidden');
  }

  // ── Session-start animation — fires immediately when a new session begins ──
  // Gives the companion an instant, rewarding reaction with zero lag.

  function _fireSessionStartAnim() {
    // Companion goes excited immediately — no setTimeout, no lag
    if (typeof Emotion !== 'undefined') Emotion.preview('excited', 2800);

    // Particle burst — spawn multiple excited particles in a rapid staggered burst
    if (typeof Particles !== 'undefined') {
      for (let i = 0; i < 8; i++) {
        setTimeout(() => Particles.spawn('excited'), i * 55);
      }
    }

    // Companion bounce — force-retrigger even if class is already set
    const buddy = typeof Companion !== 'undefined' ? Companion.getElement() : null;
    if (buddy) {
      buddy.classList.remove('session-start-bounce');
      void buddy.offsetWidth; // reflow so animation re-triggers cleanly
      buddy.classList.add('session-start-bounce');
      setTimeout(() => buddy.classList.remove('session-start-bounce'), 900);
    }

    // Gold radial flash across the screen
    const flash = document.getElementById('session-start-flash');
    if (flash) {
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 1200);
    }

    // Time-of-day aware banner text
    const msgEl = document.getElementById('session-start-msg');
    if (msgEl) {
      const period = (typeof Brain !== 'undefined' && Brain.getTimePeriod)
        ? Brain.getTimePeriod() : 'AFTERNOON';
      const MSGS = {
        MORNING:   'good morning ✦ let\'s focus!',
        AFTERNOON: 'let\'s focus! ✦',
        EVENING:   'time to focus ✦',
        NIGHT:     'late-night grind ✦',
      };
      msgEl.textContent = MSGS[period] || 'let\'s go! ✦';
      msgEl.classList.remove('active');
      void msgEl.offsetWidth;
      msgEl.classList.add('active');
      setTimeout(() => msgEl.classList.remove('active'), 2400);
    }
  }


  function _fireCelebration(type) {
    if (!Settings.get('celebrationEnabled')) return;
    const overlay = document.getElementById('celebration-overlay');
    const msg     = document.getElementById('celebration-message');
    const world   = document.getElementById('world');
    if (!overlay) return;

    // Screen flash
    if (world) {
      world.classList.add('session-complete-flash');
      setTimeout(() => world.classList.remove('session-complete-flash'), 1500);
    }

    // ── Confetti falls from above the screen ──────────────────────────────
    // Symbols — mix of glyphs and emoji for a festive feel
    const symbols = ['🎉', '🎊', '✦', '✦', '✧', '★', '·', '◆', '♡', '⬡', '▲', '●'];
    const colors  = [
      'rgba(175, 155, 255, 0.95)',
      'rgba(100, 220, 180, 0.95)',
      'rgba(255, 205, 80,  0.95)',
      'rgba(245, 185, 255, 0.95)',
      'rgba(140, 215, 255, 0.95)',
      'rgba(255, 145, 165, 0.95)',
      'rgba(255, 220, 100, 0.95)',
      'rgba(160, 255, 200, 0.95)',
    ];

    const count = type === 'complete' ? 72 : 36;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-particle';

      // Use rectangles for ~30% of pieces (paper confetti effect)
      const useRect = Math.random() < 0.30;
      if (useRect) {
        const w = 6 + Math.random() * 6;
        const h = 4 + Math.random() * 4;
        const col = colors[Math.floor(Math.random() * colors.length)];
        p.style.width  = `${w}px`;
        p.style.height = `${h}px`;
        p.style.borderRadius = '2px';
        p.style.background   = col;
        p.textContent = '';
      } else {
        p.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        p.style.color    = colors[Math.floor(Math.random() * colors.length)];
        p.style.fontSize = `${11 + Math.random() * 14}px`;
      }

      // Start ABOVE the viewport — top: -5% to -18%
      const x0  = Math.random() * 100;          // spread across full width
      const y0  = -(5 + Math.random() * 13);    // -5% to -18% (above screen)
      // Fall DOWN through the screen (700–1100 px)
      const dy  = 700 + Math.random() * 400;
      // Slight horizontal drift
      const dx  = (Math.random() - 0.5) * 140;
      const rot = (Math.random() - 0.5) * 1080;
      const dur = 2.4 + Math.random() * 2.0;
      const del = Math.random() * 1.4;

      p.style.left = `${x0}%`;
      p.style.top  = `${y0}%`;
      p.style.setProperty('--dx',  `${dx}px`);
      p.style.setProperty('--dy',  `${dy}px`);
      p.style.setProperty('--rot', `${rot}deg`);
      p.style.setProperty('--dur', `${dur}s`);
      p.style.setProperty('--del', `${del}s`);

      overlay.appendChild(p);
      setTimeout(() => p.remove(), (dur + del + 0.6) * 1000);
    }

    // Banner
    if (msg) {
      const titleEl = msg.querySelector('.cel-title');
      const subEl   = msg.querySelector('.cel-sub');
      if (titleEl) titleEl.textContent = '🎉 session complete 🎉';
      if (subEl)   subEl.textContent   = 'great work — you absolutely did it ✦';
      msg.classList.add('active');
    }

    // Companion overjoyed
    Emotion.preview('overjoyed', 5000);
    Sounds.play('overjoyed_chirp');

    // Clean up banner
    setTimeout(() => {
      if (msg) msg.classList.remove('active');
      setTimeout(() => { overlay.innerHTML = ''; }, 700);
    }, 4000);
  }

  // ── Break card — context-aware modal with emoji + message ────────────────

  function _fireBreakCard(stats) {
    const card     = document.getElementById('break-card');
    const emojiEl  = document.getElementById('break-card-emoji');
    const titleEl  = document.getElementById('break-card-title');
    const bodyEl   = document.getElementById('break-card-body');
    const budgetEl = document.getElementById('break-card-budget');
    if (!card) return;

    // ── Context resolution ──────────────────────────────────────────────────
    const period  = (typeof Brain !== 'undefined' && Brain.getTimePeriod) ? Brain.getTimePeriod() : 'AFTERNOON';
    const elapsed = stats ? (stats.elapsed || 0) : 0;           // wall-clock seconds
    const focused = stats ? (stats.focusedSeconds || 0) : 0;    // seconds in focused state
    const focusPct = elapsed > 0 ? (focused / elapsed) : 0;

    // ── Emoji + message selection ────────────────────────────────────────────
    let emoji, title, body;

    // Night — always hydrate + rest
    if (period === 'NIGHT') {
      emoji = '🌙';
      title = 'late-night session ✦';
      body  = 'drink some water and rest your eyes\na little — you deserve it';

    // Morning — energise
    } else if (period === 'MORNING') {
      if (elapsed >= 3600) {
        // More than an hour — push toward breakfast
        emoji = '🥐';
        title = 'time for a real break';
        body  = "you've been at it for a while — go\nget breakfast, seriously";
      } else {
        emoji = '☕';
        title = 'coffee time ✦';
        body  = "grab a coffee and stretch —\nyou're crushing the morning";
      }

    // Evening — wind down
    } else if (period === 'EVENING') {
      emoji = '🍵';
      title = 'herbal tea time ✦';
      body  = 'wind down a little — maybe some\nchamomile or green tea?';

    // Afternoon — main working hours
    } else {
      if (focusPct >= 0.82) {
        // Highly focused session — warm reward
        emoji = '🌊';
        title = "you've been in the zone \u2726";
        body  = 'seriously impressive focus — go\nget your favourite drink';
      } else if (elapsed >= 5400) {
        // 90+ minutes — longer break needed
        emoji = '🧘';
        title = 'proper break time';
        body  = 'step away from the screen — stretch,\nwalk, breathe for a bit';
      } else if (elapsed >= 2700) {
        // 45+ minutes
        emoji = '☕';
        title = 'tea or coffee? ✦';
        body  = 'well earned — grab something warm\nand give your eyes a rest';
      } else {
        emoji = '✨';
        title = 'quick breather ✦';
        body  = 'take a moment — look away from\nthe screen and breathe';
      }
    }

    if (emojiEl) emojiEl.textContent = emoji;
    if (titleEl) titleEl.textContent = title;
    if (bodyEl)  bodyEl.textContent  = body;

    // Break elapsed time
    if (budgetEl) {
      const elapsedMs   = Session.getBreakElapsedMs ? Session.getBreakElapsedMs() : 0;
      const elapsedSecs = Math.floor(elapsedMs / 1000);
      const bm = Math.floor(elapsedSecs / 60);
      const bs = String(elapsedSecs % 60).padStart(2, '0');
      budgetEl.textContent = `on break · ${bm}:${bs}`;
    }

    // Companion — enthusiastic, celebratory start to the break
    Emotion.preview('overjoyed', 3000);

    // Show card
    card.setAttribute('aria-hidden', 'false');
    card.classList.add('active');

    // Auto-dismiss after 6 s
    let _bkTimer = setTimeout(() => _dismissBreakCard(), 6000);

    // Dismiss button
    const dismissBtn = document.getElementById('break-card-dismiss');
    function _dismissBreakCard() {
      clearTimeout(_bkTimer);
      card.classList.remove('active');
      card.setAttribute('aria-hidden', 'true');
      // Remove listener to avoid stacking
      if (dismissBtn) dismissBtn.removeEventListener('click', _dismissBreakCard);
    }
    if (dismissBtn) {
      dismissBtn.removeEventListener('click', _dismissBreakCard); // guard
      dismissBtn.addEventListener('click', _dismissBreakCard, { once: true });
    }
  }

  // ── Break-end animation — fired when the user resumes from a break ─────────

  function _fireBreakEndAnim() {
    // Teal flash across the screen
    const flash = document.getElementById('break-end-flash');
    if (flash) {
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 1200);
    }

    // "welcome back ✦" text overlay
    const msg = document.getElementById('break-end-msg');
    if (msg) {
      msg.classList.add('active');
      setTimeout(() => msg.classList.remove('active'), 2600);
    }

    // Companion perks up
    if (typeof Emotion !== 'undefined') Emotion.preview('excited', 2500);
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
    const ms = Session.getBreakElapsedMs();
    const totalSecs = Math.floor(ms / 1000);
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
  let _autoPipActive = false; // true when auto-PiP triggered the collapse
  let _autoPipTimer  = null;  // pending delay timer for deferred collapse
  let _pendingShareCard = null; // queued when session ends while in PiP mode

  // ── Mode toggle ───────────────────────────────────────────────────────────

  function _enterFullMode() {
    if (_isFullMode) return;
    // Cancel any pending deferred auto-collapse (e.g. user expands before timer fires).
    if (_autoPipTimer) { clearTimeout(_autoPipTimer); _autoPipTimer = null; }
    _autoPipActive = false;
    _isFullMode = true;
    document.body.classList.remove('pip-mode');
    document.body.classList.add('full-mode');
    if (window.electronAPI) window.electronAPI.enterFullMode();
    // Show share card that was deferred because the session ended while in PiP mode
    if (_pendingShareCard) {
      const { sessionData, emotion } = _pendingShareCard;
      _pendingShareCard = null;
      setTimeout(() => {
        if (typeof ShareCard !== 'undefined') ShareCard.show(sessionData, emotion);
      }, 400);
    }
  }

  function _exitFullMode() {
    if (!_isFullMode) return;
    _isFullMode = false;
    document.body.classList.remove('full-mode');
    document.body.classList.add('pip-mode');
    // Apply the one-shot entrance animation class; remove it after the animation duration.
    document.body.classList.add('pip-entering');
    setTimeout(() => document.body.classList.remove('pip-entering'), 400);
    if (window.electronAPI) window.electronAPI.exitFullMode();
  }

  function _exitFullModeManual() {
    // Cancel any pending deferred auto-collapse timer.
    if (_autoPipTimer) { clearTimeout(_autoPipTimer); _autoPipTimer = null; }
    // Clear auto-pip flag so a subsequent focus event doesn't auto-restore.
    _autoPipActive = false;
    _exitFullMode();
  }

  function _wireWindowControls() {
    // Keyboard shortcut registered via Keybinds in _wireKeybinds() below

    // Toggle buttons
    const expandBtn   = document.getElementById('compact-expand-btn');
    const collapseBtn = document.getElementById('full-collapse-btn');
    if (expandBtn)   expandBtn.addEventListener('click', () => _enterFullMode());
    if (collapseBtn) collapseBtn.addEventListener('click', () => _exitFullModeManual());

    // WhatsApp-style PiP hover overlay: click the expand button to restore
    const pipExpandBtn = document.getElementById('pip-expand-btn');
    if (pipExpandBtn) pipExpandBtn.addEventListener('click', () => _enterFullMode());

    // Clicking anywhere on the circular bubble (that isn't an eye / interactive
    // child) also expands back to full mode — same as tapping a WhatsApp call bubble.
    const worldEl = document.getElementById('world');
    if (worldEl) {
      worldEl.addEventListener('click', (e) => {
        if (!document.body.classList.contains('pip-mode')) return;
        // Don't expand if the click hit an interactive child (eye, button, etc.)
        if (e.target !== worldEl) return;
        _enterFullMode();
      });
    }

    // Sync mode state when main reports transitions (covers IPC-initiated toggles).
    if (window.electronAPI) {
      window.electronAPI.onFullModeEntered(() => {
        _isFullMode = true;
        document.body.classList.remove('pip-mode');
        document.body.classList.add('full-mode');
        if (_pendingShareCard) {
          const { sessionData, emotion } = _pendingShareCard;
          _pendingShareCard = null;
          setTimeout(() => {
            if (typeof ShareCard !== 'undefined') ShareCard.show(sessionData, emotion);
          }, 400);
        }
      });
      window.electronAPI.onFullModeExited(() => {
        _isFullMode = false;
        document.body.classList.remove('full-mode');
        document.body.classList.add('pip-mode');
      });

      // Auto-PiP: collapse to compact overlay when the user switches away
      window.electronAPI.onAppBlur(() => {
        if (!_isFullMode || !Settings.get('autoPipOnBlur')) return;

        // Skip collapse when a focus session is active and the user has opted in
        if (Settings.get('autoPipSkipSession') && typeof Session !== 'undefined' &&
            Session.getState && Session.getState() === 'ACTIVE') return;

        const delaySec = Settings.get('autoPipDelay') || 0;
        if (delaySec > 0) {
          // Deferred collapse — cancel any previously scheduled one first
          clearTimeout(_autoPipTimer);
          _autoPipTimer = setTimeout(() => {
            _autoPipTimer = null;
            // Re-check: window may have been focused again before timer fired
            if (_isFullMode && Settings.get('autoPipOnBlur')) {
              _autoPipActive = true;
              _exitFullMode();
            }
          }, delaySec * 1000);
        } else {
          _autoPipActive = true;
          _exitFullMode();
        }
      });

      // Auto-PiP: restore full mode when the user comes back (only if we auto-collapsed)
      window.electronAPI.onAppFocus(() => {
        // Cancel a pending delayed collapse if the user returned quickly
        if (_autoPipTimer) {
          clearTimeout(_autoPipTimer);
          _autoPipTimer = null;
        }

        if (_autoPipActive && !_isFullMode && Settings.get('autoPipRestore')) {
          _autoPipActive = false;
          _enterFullMode();
          // Welcome-back reaction: give Brain a nudge so the companion reacts
          setTimeout(() => {
            if (typeof Brain !== 'undefined' && Brain.triggerWelcomeBack) {
              Brain.triggerWelcomeBack();
            }
          }, 350);
        }
      });
    }

    // ── Emotion glow ring for PiP bubble ─────────────────────────────────
    // Poll Brain's current emotion every 500 ms and mirror it onto
    // #world[data-pip-emotion] so the CSS glow keyframes can react.
    {
      const worldEl = document.getElementById('world');
      if (worldEl) {
        setInterval(() => {
          const em = (window._lastEmotion || 'idle').toLowerCase();
          if (worldEl.dataset.pipEmotion !== em) {
            worldEl.dataset.pipEmotion = em;
          }
        }, 500);
      }
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
      fn: () => _isFullMode ? _exitFullModeManual() : _enterFullMode(),
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

    Keybinds.register({
      id: 'toggle-history',
      label: 'Open session / history panel',
      defaultKey: 'Ctrl+Shift+H',
      fn: () => {
        const hpIcon = document.getElementById('hp-icon');
        if (hpIcon) hpIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      },
    });

    Keybinds.register({
      id: 'toggle-dnd',
      label: 'Toggle Do Not Disturb',
      defaultKey: 'Ctrl+Shift+D',
      fn: () => DND.toggle(Settings.get('dndDuration') || 25),
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
      // Collapse all accordion sections
      panel.querySelectorAll('.settings-section-title[aria-expanded="true"]').forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
        const body = btn.nextElementSibling;
        if (body) body.classList.remove('expanded');
      });
      gearBtn.focus();
    }

    gearBtn.addEventListener('click', () => {
      panel.classList.contains('settings-open') ? closePanel() : openPanel();
    });

    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    // ── Accordion section toggles ────────────────────────────────────────
    panel.querySelectorAll('.settings-section-title').forEach((btn) => {
      btn.addEventListener('click', () => {
        const isOpen = btn.getAttribute('aria-expanded') === 'true';
        const body   = btn.nextElementSibling;
        btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        if (body) body.classList.toggle('expanded', !isOpen);
      });
    });

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

    // Ticks enabled toggle
    const ticksToggle = document.getElementById('ticks-enabled-toggle');
    if (ticksToggle) {
      ticksToggle.checked = Settings.get('ticksEnabled');
      ticksToggle.addEventListener('change', () => Settings.set('ticksEnabled', ticksToggle.checked));
    }

    // Break over alarm toggle — removed (breaks have no time limit)
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

    // Auto-PiP on app switch toggle + sub-options
    const autoPipToggle = document.getElementById('auto-pip-toggle');
    const autoPipDelayRow       = document.getElementById('auto-pip-delay-row');
    const autoPipRestoreRow     = document.getElementById('auto-pip-restore-row');
    const autoPipSkipSessionRow = document.getElementById('auto-pip-skip-session-row');

    function _syncAutoPipSubrows(enabled) {
      const display = enabled ? '' : 'none';
      if (autoPipDelayRow)       autoPipDelayRow.style.display       = display;
      if (autoPipRestoreRow)     autoPipRestoreRow.style.display     = display;
      if (autoPipSkipSessionRow) autoPipSkipSessionRow.style.display = display;
    }

    if (autoPipToggle) {
      autoPipToggle.checked = Settings.get('autoPipOnBlur');
      _syncAutoPipSubrows(autoPipToggle.checked);
      autoPipToggle.addEventListener('change', () => {
        Settings.set('autoPipOnBlur', autoPipToggle.checked);
        _syncAutoPipSubrows(autoPipToggle.checked);
      });
    }
    Settings.onChange('autoPipOnBlur', (v) => {
      if (autoPipToggle) autoPipToggle.checked = v;
      _syncAutoPipSubrows(v);
    });

    // Collapse delay select
    const autoPipDelaySel = document.getElementById('auto-pip-delay-select');
    if (autoPipDelaySel) {
      autoPipDelaySel.value = String(Settings.get('autoPipDelay'));
      autoPipDelaySel.addEventListener('change', () =>
        Settings.set('autoPipDelay', parseInt(autoPipDelaySel.value, 10)));
    }
    Settings.onChange('autoPipDelay', (v) => {
      if (autoPipDelaySel) autoPipDelaySel.value = String(v);
    });

    // Restore on return toggle
    const autoPipRestoreToggle = document.getElementById('auto-pip-restore-toggle');
    if (autoPipRestoreToggle) {
      autoPipRestoreToggle.checked = Settings.get('autoPipRestore');
      autoPipRestoreToggle.addEventListener('change', () =>
        Settings.set('autoPipRestore', autoPipRestoreToggle.checked));
    }
    Settings.onChange('autoPipRestore', (v) => {
      if (autoPipRestoreToggle) autoPipRestoreToggle.checked = v;
    });

    // Stay full during sessions toggle
    const autoPipSkipSessionToggle = document.getElementById('auto-pip-skip-session-toggle');
    if (autoPipSkipSessionToggle) {
      autoPipSkipSessionToggle.checked = Settings.get('autoPipSkipSession');
      autoPipSkipSessionToggle.addEventListener('change', () =>
        Settings.set('autoPipSkipSession', autoPipSkipSessionToggle.checked));
    }
    Settings.onChange('autoPipSkipSession', (v) => {
      if (autoPipSkipSessionToggle) autoPipSkipSessionToggle.checked = v;
    });

    // PiP overlay shape chip picker
    const VALID_SHAPES = ['square', 'rounded', 'circle'];
    function _applyPipShape(shape) {
      VALID_SHAPES.forEach(s =>
        document.body.classList.toggle('pip-shape-' + s, s === shape));
    }
    function _syncShapeChips(shape) {
      document.querySelectorAll('#pip-shape-picker .pip-shape-chip').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.shape === shape);
      });
    }
    _applyPipShape(Settings.get('pipShape'));
    _syncShapeChips(Settings.get('pipShape'));
    document.querySelectorAll('#pip-shape-picker .pip-shape-chip').forEach(btn => {
      btn.addEventListener('click', () => Settings.set('pipShape', btn.dataset.shape));
    });
    Settings.onChange('pipShape', (v) => {
      _applyPipShape(v);
      _syncShapeChips(v);
    });

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

    // Celebration toggle
    const celebrationToggle = document.getElementById('celebration-toggle');
    if (celebrationToggle) {
      celebrationToggle.checked = Settings.get('celebrationEnabled');
      celebrationToggle.addEventListener('change', () => Settings.set('celebrationEnabled', celebrationToggle.checked));
    }

    // Break animation toggle
    const breakAnimToggle = document.getElementById('break-anim-toggle');
    if (breakAnimToggle) {
      breakAnimToggle.checked = Settings.get('breakAnimEnabled');
      breakAnimToggle.addEventListener('change', () => Settings.set('breakAnimEnabled', breakAnimToggle.checked));
    }

    // Anti-cheat toggle
    const antiCheatToggle = document.getElementById('anti-cheat-toggle');
    if (antiCheatToggle) {
      antiCheatToggle.checked = Settings.get('antiCheatEnabled');
      antiCheatToggle.addEventListener('change', () => {
        Settings.set('antiCheatEnabled', antiCheatToggle.checked);
        if (typeof HistoryPanel !== 'undefined' && HistoryPanel.refresh) HistoryPanel.refresh();
      });
    }

    // ── Live change listeners ────────────────────────────────────────────
    Settings.onChange('antiCheatEnabled', (v) => {
      if (antiCheatToggle) antiCheatToggle.checked = v;
      if (typeof HistoryPanel !== 'undefined' && HistoryPanel.refresh) HistoryPanel.refresh();
    });
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
      if (typeof Brain !== 'undefined' && Brain.setPhoneDetectionEnabled) Brain.setPhoneDetectionEnabled(v);
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

    Settings.onChange('ticksEnabled', (v) => {
      Sounds.setTicksEnabled(v);
      if (ticksToggle) ticksToggle.checked = v;
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
    Sounds.setTicksEnabled(Settings.get('ticksEnabled'));

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
      // Apply to <html> so the body background (full-mode themes) is also dimmed
      document.documentElement.style.filter = v < 1.0 ? `brightness(${v})` : '';
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
        // Also update the start-screen HH:MM:SS duration fields if visible
        _setDurationSeconds(v * 60);
      });
    }

    Settings.onChange('sessionLength', (v) => {
      if (sessionLengthSel) sessionLengthSel.value = String(v);
      _setDurationSeconds(v * 60);
    });

    // Pre-fill start-screen HH:MM:SS fields with saved default now
    {
      _setDurationSeconds(Settings.get('sessionLength') * 60);
    }

    // ── Timer step (duration stepper +/− increment) ─────────────────────
    const timerStepSel = document.getElementById('timer-step-select');
    if (timerStepSel) {
      timerStepSel.value = String(Settings.get('timerStep') || 5);
      timerStepSel.addEventListener('change', (e) => {
        Settings.set('timerStep', parseInt(e.target.value, 10));
      });
    }
    Settings.onChange('timerStep', (v) => {
      if (timerStepSel) timerStepSel.value = String(v);
    });

    // ── Daily focus goal ─────────────────────────────────────────────────
    const dailyGoalSel = document.getElementById('daily-goal-select');
    if (dailyGoalSel) {
      dailyGoalSel.value = String(Settings.get('dailyFocusGoalMins') || 0);
      dailyGoalSel.addEventListener('change', (e) => {
        Settings.set('dailyFocusGoalMins', parseInt(e.target.value, 10));
        _updateDailyGoalArc();
      });
    }
    Settings.onChange('dailyFocusGoalMins', (v) => {
      if (dailyGoalSel) dailyGoalSel.value = String(v);
      _updateDailyGoalArc();
    });

    // ── Distraction budget ───────────────────────────────────────────────
    const distractionBudgetSel = document.getElementById('distraction-budget-select');
    if (distractionBudgetSel) {
      distractionBudgetSel.value = String(Settings.get('distractionBudget') || 0);
      distractionBudgetSel.addEventListener('change', (e) => {
        Settings.set('distractionBudget', parseInt(e.target.value, 10));
      });
    }
    Settings.onChange('distractionBudget', (v) => {
      if (distractionBudgetSel) distractionBudgetSel.value = String(v);
    });

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

    // ── Backup: export / import ──────────────────────────────────────────────
    const exportBtn    = document.getElementById('export-history-btn');
    const importBtn    = document.getElementById('import-history-btn');
    const backupStatus = document.getElementById('backup-status');

    function _updateExportCount() {
      const el = document.getElementById('export-session-count');
      if (el) el.textContent = `${Session.getHistory().length} session${Session.getHistory().length !== 1 ? 's' : ''} saved`;
    }
    _updateExportCount();
    gearBtn.addEventListener('click', _updateExportCount);

    function _showBackupStatus(msg, color) {
      if (!backupStatus) return;
      backupStatus.textContent   = msg;
      backupStatus.style.color   = color;
      backupStatus.style.display = '';
      setTimeout(() => { if (backupStatus) backupStatus.style.display = 'none'; }, 4000);
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        exportBtn.disabled    = true;
        exportBtn.textContent = 'exporting…';
        const json   = Session.exportHistory();
        const result = await window.electronAPI.exportHistory(json);
        exportBtn.disabled    = false;
        exportBtn.textContent = 'export';
        if (result.ok) {
          _showBackupStatus('exported ✓', 'rgba(68,232,176,0.80)');
        } else if (result.reason !== 'cancelled') {
          _showBackupStatus(`export failed: ${result.reason}`, 'rgba(255,100,100,0.80)');
        }
      });
    }

    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        importBtn.disabled    = true;
        importBtn.textContent = 'importing…';
        const fileResult = await window.electronAPI.importHistory();
        importBtn.disabled    = false;
        importBtn.textContent = 'import';
        if (!fileResult.ok) {
          if (fileResult.reason !== 'cancelled') {
            _showBackupStatus(`import failed: ${fileResult.reason}`, 'rgba(255,100,100,0.80)');
          }
          return;
        }
        const mergeResult = Session.importHistory(fileResult.data);
        if (mergeResult.success) {
          _updateExportCount();
          _refreshSessionStats();
          _showBackupStatus(
            `imported ${mergeResult.imported} new session${mergeResult.imported !== 1 ? 's' : ''} ✓`,
            'rgba(68,232,176,0.80)'
          );
        } else {
          _showBackupStatus(mergeResult.reason, 'rgba(255,100,100,0.80)');
        }
      });
    }

    // ── Settings backup: export / import ─────────────────────────────────────
    const exportSettingsBtn    = document.getElementById('export-settings-btn');
    const importSettingsBtn    = document.getElementById('import-settings-btn');
    const resetSettingsBtn     = document.getElementById('reset-settings-btn');
    const settingsBackupStatus = document.getElementById('settings-backup-status');

    function _showSettingsBackupStatus(msg, color) {
      if (!settingsBackupStatus) return;
      settingsBackupStatus.textContent   = msg;
      settingsBackupStatus.style.color   = color;
      settingsBackupStatus.style.display = '';
      setTimeout(() => { if (settingsBackupStatus) settingsBackupStatus.style.display = 'none'; }, 4000);
    }

    if (exportSettingsBtn) {
      exportSettingsBtn.addEventListener('click', async () => {
        exportSettingsBtn.disabled    = true;
        exportSettingsBtn.textContent = 'exporting…';
        const json   = Settings.exportSettings();
        const result = await window.electronAPI.exportSettings(json);
        exportSettingsBtn.disabled    = false;
        exportSettingsBtn.textContent = 'export';
        if (result.ok) {
          _showSettingsBackupStatus('settings exported ✓', 'rgba(68,232,176,0.80)');
        } else if (result.reason !== 'cancelled') {
          _showSettingsBackupStatus(`export failed: ${result.reason}`, 'rgba(255,100,100,0.80)');
        }
      });
    }

    if (importSettingsBtn) {
      importSettingsBtn.addEventListener('click', async () => {
        importSettingsBtn.disabled    = true;
        importSettingsBtn.textContent = 'importing…';
        const fileResult = await window.electronAPI.importSettings();
        importSettingsBtn.disabled    = false;
        importSettingsBtn.textContent = 'import';
        if (!fileResult.ok) {
          if (fileResult.reason !== 'cancelled') {
            _showSettingsBackupStatus(`import failed: ${fileResult.reason}`, 'rgba(255,100,100,0.80)');
          }
          return;
        }
        const mergeResult = Settings.importSettings(fileResult.data);
        if (mergeResult.success) {
          _showSettingsBackupStatus(
            `${mergeResult.applied} settings applied ✓`,
            'rgba(68,232,176,0.80)'
          );
        } else {
          _showSettingsBackupStatus(mergeResult.reason, 'rgba(255,100,100,0.80)');
        }
      });
    }

    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', () => {
        Settings.reset();
        _showSettingsBackupStatus('settings reset to defaults ✓', 'rgba(68,232,176,0.80)');
      });
    }

    // ── Clear history button ─────────────────────────────────────────────
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', () => {
        const count = Session.getHistory().length;
        if (count === 0) {
          _showBackupStatus('no sessions to clear', 'rgba(200,185,255,0.60)');
          return;
        }
        if (!confirm(`Complete reset: permanently delete all ${count} session${count !== 1 ? 's' : ''} and reset lifetime stats to zero?\n\nThis cannot be undone.`)) return;
        Session.hardClearHistory();
        _updateExportCount();
        if (typeof HistoryPanel !== 'undefined') HistoryPanel.refresh();
        _showBackupStatus(`cleared ${count} session${count !== 1 ? 's' : ''} + stats reset ✓`, 'rgba(248,113,113,0.80)');
      });
    }

    // ── Clear all cache button ───────────────────────────────────────────
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', () => {
        if (!confirm('Wipe ALL stored data (sessions + settings)? This cannot be undone.')) return;
        Session.clearAllCache();
        Settings.reset();
        _updateExportCount();
        if (typeof HistoryPanel !== 'undefined') HistoryPanel.refresh();
        _showBackupStatus('all cache wiped ✓ — restart recommended', 'rgba(248,113,113,0.80)');
      });
    }

    // ── Emotion preview duration slider ─────────────────────────────────
    const previewDurSlider   = document.getElementById('preview-dur-slider');
    const previewDurSubLabel = document.getElementById('preview-dur-sublabel');

    function _applyPreviewDur(v) {
      const n = parseInt(v, 10) || 3;
      if (previewDurSlider)   previewDurSlider.value = n;
      if (previewDurSubLabel) previewDurSubLabel.textContent = `${n} s`;
    }
    _applyPreviewDur(Settings.get('emotionPreviewDuration'));

    if (previewDurSlider) {
      previewDurSlider.addEventListener('input', () => {
        const v = parseInt(previewDurSlider.value, 10);
        Settings.set('emotionPreviewDuration', v);
        _applyPreviewDur(v);
      });
    }

    // ── Idle speed triple-btn ────────────────────────────────────────────
    const IDLE_SPEED_LABELS = { 1: 'Calm', 2: 'Default', 3: 'Hyper' };
    const idleSpeedBtns   = document.getElementById('idle-speed-btns');
    const idleSpeedLabel  = document.getElementById('idle-speed-sublabel');

    function _applyIdleSpeed(v) {
      const n = parseInt(v, 10) || 2;
      if (idleSpeedLabel) idleSpeedLabel.textContent = IDLE_SPEED_LABELS[n] || 'Default';
      if (idleSpeedBtns) {
        idleSpeedBtns.querySelectorAll('.settings-triple-btn-item').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.val, 10) === n);
        });
      }
      if (typeof Brain !== 'undefined' && Brain.setIdleSpeed) Brain.setIdleSpeed(n);
    }

    _applyIdleSpeed(Settings.get('idleSpeed'));

    if (idleSpeedBtns) {
      idleSpeedBtns.querySelectorAll('.settings-triple-btn-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = parseInt(btn.dataset.val, 10);
          Settings.set('idleSpeed', v);
        });
      });
    }

    Settings.onChange('idleSpeed', (v) => _applyIdleSpeed(v));

    // ── Expressiveness triple-btn ────────────────────────────────────────
    const EXPRESS_LABELS = { 1: 'Subtle', 2: 'Default', 3: 'Maximum drama' };
    const expressBtns  = document.getElementById('express-btns');
    const expressLabel = document.getElementById('express-sublabel');

    function _applyExpressiveness(v) {
      const n = parseInt(v, 10) || 2;
      if (expressLabel) expressLabel.textContent = EXPRESS_LABELS[n] || 'Default';
      if (expressBtns) {
        expressBtns.querySelectorAll('.settings-triple-btn-item').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.val, 10) === n);
        });
      }
      if (typeof Brain !== 'undefined' && Brain.setExpressiveness) Brain.setExpressiveness(n);
    }

    _applyExpressiveness(Settings.get('expressiveness'));

    if (expressBtns) {
      expressBtns.querySelectorAll('.settings-triple-btn-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = parseInt(btn.dataset.val, 10);
          Settings.set('expressiveness', v);
        });
      });
    }

    Settings.onChange('expressiveness', (v) => _applyExpressiveness(v));

    // ── Petting mode triple-btn ──────────────────────────────────────────
    const PETTING_LABELS = { 1: 'Gentle', 2: 'Default', 3: 'Eager' };
    const pettingBtns = document.getElementById('petting-btns');

    function _applyPettingMode(v) {
      const n = parseInt(v, 10) || 2;
      if (pettingBtns) {
        pettingBtns.querySelectorAll('.settings-triple-btn-item').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.val, 10) === n);
        });
      }
      if (typeof Brain !== 'undefined' && Brain.setPettingMode) Brain.setPettingMode(n);
    }

    _applyPettingMode(Settings.get('pettingMode'));

    if (pettingBtns) {
      pettingBtns.querySelectorAll('.settings-triple-btn-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = parseInt(btn.dataset.val, 10);
          Settings.set('pettingMode', v);
        });
      });
    }

    Settings.onChange('pettingMode', (v) => _applyPettingMode(v));
    const emotionGrid = document.getElementById('emotion-grid');
    if (emotionGrid) {
      const GLOW = {
        idle: '155,135,255', curious: '115,125,245', focused: '110,130,225',
        sleepy: '130,140,210', suspicious: '115,120,240', happy: '160,140,245',
        scared: '195,218,255', sad: '100,145,210', crying: '75,120,195',
        pouty: '255,188,118', grumpy: '255,138,128', overjoyed: '255,240,198',
        sulking: '205,138,192', embarrassed: '255,120,155', forgiven: '255,160,190',
        excited: '255,228,120', shy: '255,142,198', love: '255,138,180',
        startled: '200,220,255', cozy: '255,155,130', being_patted: '255,110,145',
        ecstatic: '255,230,60', dazed: '200,165,255',
      };
      const EMOJI = {
        idle: '○', curious: '◉', focused: '◎', sleepy: '◔',
        suspicious: '👁', happy: '◕‿◕', scared: '○!', sad: '◕︵◕',
        crying: '😢', pouty: '◣', grumpy: '◤', overjoyed: '★',
        sulking: '◷', embarrassed: '◕///◕', forgiven: '♡✓', excited: '◕!',
        shy: '///◕', love: '♡', startled: '◕‼', cozy: '◕‿◕♡', being_patted: 'UwU♡',
        ecstatic: '✦★✦', dazed: '◕~◕',
      };
      const SOUND_MAP = {
        happy: 'happy_coo', curious: 'curious_ooh', overjoyed: 'overjoyed_chirp',
        excited: 'excited_chirp', shy: 'shy_squeak', love: 'love_purr',
        suspicious: 'suspicious_squint', pouty: 'pouty_mweh', grumpy: 'grumpy_hmph',
        scared: 'scared_eep', sad: 'sad_whimper', crying: 'crying_sob',
        startled: 'startled_gasp', cozy: 'love_purr', being_patted: 'love_purr',
        ecstatic: 'overjoyed_chirp', dazed: 'love_purr',
      };

      // Rich per-emotion tooltip descriptions
      const DESC = {
        idle:        'Resting calmly',
        curious:     'Something caught its eye',
        focused:     'Deep in concentration',
        sleepy:      'Getting drowsy',
        suspicious:  'Something feels off…',
        happy:       'Warm and joyful',
        scared:      'Startled or anxious',
        sad:         'Feeling a little down',
        crying:      'Really sad',
        pouty:       'Mildly grumpy',
        grumpy:      'Properly grumpy',
        overjoyed:   'Pure unbridled joy',
        sulking:     'Sulking quietly',
        embarrassed: 'Flustered and blushing',
        forgiven:    'All is forgiven ♡',
        excited:     'Buzzing with energy',
        shy:         'Bashful from eye contact',
        love:        'Click-to-pet affection ♡',
        startled:    'Sudden scare!',
        cozy:        'Hold < 1.5 s — half-lidded warmth, heavy droopy eyes',
        being_patted:'Hold ≥ 1.5 s — eyes fully closed, bliss escalates the longer you hold ♡',
        ecstatic:    'Hold ≥ 16 s — golden star eyes, absolute peak joy — the creature has ascended ✦',
        dazed:       'Post-long-hold bliss fog — asymmetric dreamy eyes, floating on air ♡',
      };

      // Emotional categories
      const CATEGORIES = [
        { label: '✦ Positive',  states: ['happy', 'overjoyed', 'excited', 'love', 'cozy', 'being_patted', 'ecstatic', 'dazed', 'shy', 'forgiven'] },
        { label: '◎ Neutral',   states: ['idle', 'focused', 'curious', 'sleepy', 'embarrassed'] },
        { label: '◤ Negative',  states: ['suspicious', 'pouty', 'grumpy', 'sulking', 'scared', 'sad', 'crying', 'startled'] },
      ];

      let _activeBtn = null;

      emotionGrid.style.cssText = 'padding: 0 10px 10px;';

      CATEGORIES.forEach(cat => {
        // Category label
        const catLabel = document.createElement('div');
        catLabel.className = 'emotion-category-label';
        catLabel.textContent = cat.label;
        emotionGrid.appendChild(catLabel);

        // Grid row for this category
        const grid = document.createElement('div');
        grid.className = 'emotion-category-grid';
        emotionGrid.appendChild(grid);

        cat.states.forEach(state => {
          const btn = document.createElement('button');
          btn.className = 'emotion-test-btn';
          btn.dataset.emotion = state;
          btn.style.setProperty('--glow-color', GLOW[state] || '155,135,255');

          const icon = document.createElement('span');
          icon.className = 'emotion-btn-icon';
          icon.textContent = EMOJI[state] || '○';
          icon.setAttribute('aria-hidden', 'true');

          const name = document.createElement('span');
          name.className = 'emotion-btn-name';
          name.textContent = state;

          btn.appendChild(icon);
          btn.appendChild(name);
          btn.title = DESC[state] || `Preview: ${state}`;

          btn.addEventListener('click', () => {
            if (_activeBtn) _activeBtn.classList.remove('active');
            btn.classList.add('active');
            _activeBtn = btn;
            const sound = SOUND_MAP[state];
            if (sound) Sounds.play(sound);
            // Start side-effects that go beyond the CSS class swap
            if (state === 'crying' && typeof Brain !== 'undefined' && Brain.startTearEffect) {
              Brain.startTearEffect();
            }
            const durMs = (Settings.get('emotionPreviewDuration') || 3) * 1000;
            Emotion.preview(state, durMs, () => {
              btn.classList.remove('active');
              if (_activeBtn === btn) _activeBtn = null;
              // Always clean up tears when the preview ends
              if (typeof Brain !== 'undefined' && Brain.stopTearEffect) Brain.stopTearEffect();
            });
          });

          grid.appendChild(btn);
        });
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

    // ── Full-screen theme picker ─────────────────────────────────────────
    const THEME_CLASSES = ['theme-galaxy','theme-classic','theme-forest','theme-ocean',
                           'theme-sunset','theme-aurora','theme-cherry','theme-midnight'];

    function _applyFullTheme(theme) {
      document.body.classList.remove(...THEME_CLASSES);
      document.body.classList.add(`theme-${theme}`);
      const picker = document.getElementById('full-theme-picker');
      if (picker) {
        picker.querySelectorAll('.theme-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.theme === theme));
      }
    }

    _applyFullTheme(Settings.get('fullTheme') || 'galaxy');

    const themePicker = document.getElementById('full-theme-picker');
    if (themePicker) {
      themePicker.querySelectorAll('.theme-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('fullTheme', btn.dataset.theme));
      });
    }
    Settings.onChange('fullTheme', (v) => _applyFullTheme(v));

    // ── Eye colour picker ────────────────────────────────────────────────
    const EYE_COLOR_CLASSES = ['eye-periwinkle','eye-emerald','eye-rose','eye-amber',
                               'eye-lavender','eye-sky','eye-ruby','eye-teal'];

    function _applyEyeColor(color) {
      document.body.classList.remove(...EYE_COLOR_CLASSES);
      if (color && color !== 'periwinkle') document.body.classList.add(`eye-${color}`);
      const picker = document.getElementById('eye-color-picker');
      if (picker) {
        picker.querySelectorAll('.color-swatch').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.color === color));
      }
    }

    _applyEyeColor(Settings.get('eyeColor') || 'periwinkle');

    const eyeColorPicker = document.getElementById('eye-color-picker');
    if (eyeColorPicker) {
      eyeColorPicker.querySelectorAll('.color-swatch').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('eyeColor', btn.dataset.color));
      });
    }
    Settings.onChange('eyeColor', (v) => _applyEyeColor(v));

    // ── PiP opacity slider ───────────────────────────────────────────────
    const pipOpacitySlider   = document.getElementById('pip-opacity-slider');
    const pipOpacitySubLabel = document.getElementById('pip-opacity-sublabel');

    function _applyPipOpacity(pct) {
      const world = document.getElementById('world');
      if (world) world.style.setProperty('--pip-bg-opacity', (pct / 100).toFixed(2));
      if (pipOpacitySlider)   pipOpacitySlider.value = pct;
      if (pipOpacitySubLabel) pipOpacitySubLabel.textContent = `${pct}%`;
    }

    _applyPipOpacity(Settings.get('pipOpacity') != null ? Settings.get('pipOpacity') : 78);

    if (pipOpacitySlider) {
      pipOpacitySlider.addEventListener('input', () => {
        const v = parseInt(pipOpacitySlider.value, 10);
        Settings.set('pipOpacity', v);
      });
    }
    Settings.onChange('pipOpacity', (v) => _applyPipOpacity(v));

    // ── Companion position (full-mode) ───────────────────────────────────
    const POS_CLASSES = ['companion-pos-left','companion-pos-center','companion-pos-right'];

    function _applyCompanionPos(pos) {
      document.body.classList.remove(...POS_CLASSES);
      if (pos && pos !== 'center') document.body.classList.add(`companion-pos-${pos}`);
      const btns = document.getElementById('companion-pos-btns');
      if (btns) {
        btns.querySelectorAll('.style-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.pos === pos));
      }
    }

    _applyCompanionPos(Settings.get('companionPos') || 'center');

    const companionPosBtns = document.getElementById('companion-pos-btns');
    if (companionPosBtns) {
      companionPosBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('companionPos', btn.dataset.pos));
      });
    }
    Settings.onChange('companionPos', (v) => _applyCompanionPos(v));

    // ── Eye spacing ──────────────────────────────────────────────────────
    const EYE_SPACING_CLASSES = ['eye-spacing-narrow','eye-spacing-wide'];

    function _applyEyeSpacing(spacing) {
      document.body.classList.remove(...EYE_SPACING_CLASSES);
      if (spacing && spacing !== 'normal') document.body.classList.add(`eye-spacing-${spacing}`);
      const btns = document.getElementById('eye-spacing-btns');
      if (btns) {
        btns.querySelectorAll('.style-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.spacing === spacing));
      }
    }

    _applyEyeSpacing(Settings.get('eyeSpacing') || 'normal');

    const eyeSpacingBtns = document.getElementById('eye-spacing-btns');
    if (eyeSpacingBtns) {
      eyeSpacingBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('eyeSpacing', btn.dataset.spacing));
      });
    }
    Settings.onChange('eyeSpacing', (v) => _applyEyeSpacing(v));

    // ── Blink rate ───────────────────────────────────────────────────────
    function _applyBlinkRate(rate) {
      if (Companion.setBlinkRate) Companion.setBlinkRate(rate);
      const btns = document.getElementById('blink-rate-btns');
      if (btns) {
        btns.querySelectorAll('.style-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.blink === rate));
      }
    }

    _applyBlinkRate(Settings.get('blinkRate') || 'normal');

    const blinkRateBtns = document.getElementById('blink-rate-btns');
    if (blinkRateBtns) {
      blinkRateBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('blinkRate', btn.dataset.blink));
      });
    }
    Settings.onChange('blinkRate', (v) => _applyBlinkRate(v));

    // ── Eyebrows toggle ──────────────────────────────────────────────────
    const eyebrowsToggle = document.getElementById('eyebrows-toggle');

    function _applyShowEyebrows(show) {
      document.body.classList.toggle('hide-eyebrows', !show);
      if (eyebrowsToggle) eyebrowsToggle.checked = !!show;
    }

    _applyShowEyebrows(Settings.get('showEyebrows') !== false);

    if (eyebrowsToggle) {
      eyebrowsToggle.addEventListener('change', () =>
        Settings.set('showEyebrows', eyebrowsToggle.checked));
    }
    Settings.onChange('showEyebrows', (v) => _applyShowEyebrows(v));

    // ── Nose style ───────────────────────────────────────────────────────
    const NOSE_CLASSES = ['nose-dot','nose-none'];

    function _applyNoseStyle(style) {
      document.body.classList.remove(...NOSE_CLASSES);
      if (style && style !== 'triangle') document.body.classList.add(`nose-${style}`);
      const btns = document.getElementById('nose-style-btns');
      if (btns) {
        btns.querySelectorAll('.style-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.nose === style));
      }
    }

    _applyNoseStyle(Settings.get('noseStyle') || 'triangle');

    const noseStyleBtns = document.getElementById('nose-style-btns');
    if (noseStyleBtns) {
      noseStyleBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('noseStyle', btn.dataset.nose));
      });
    }
    Settings.onChange('noseStyle', (v) => _applyNoseStyle(v));

    // ── Mouth style ──────────────────────────────────────────────────────
    const MOUTH_CLASSES = ['mouth-perky','mouth-minimal','mouth-none'];

    function _applyMouthStyle(style) {
      document.body.classList.remove(...MOUTH_CLASSES);
      if (style && style !== 'arc') document.body.classList.add(`mouth-${style}`);
      const btns = document.getElementById('mouth-style-btns');
      if (btns) {
        btns.querySelectorAll('.style-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.mouth === style));
      }
    }

    _applyMouthStyle(Settings.get('mouthStyle') || 'arc');

    const mouthStyleBtns = document.getElementById('mouth-style-btns');
    if (mouthStyleBtns) {
      mouthStyleBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('mouthStyle', btn.dataset.mouth));
      });
    }
    Settings.onChange('mouthStyle', (v) => _applyMouthStyle(v));
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

  // ── _wireDND ──────────────────────────────────────────────────────────────
  // Wire the DND Settings section: toggle button, duration selector,
  // and live UI sync when DND activates / deactivates.

  // ── Screen Time helpers ───────────────────────────────────────────────────

  /**
   * _updateDailyGoalArc()
   * Reads today's total focused time (history + live session) and renders the
   * Screen Time-style progress arc and labels in the session idle panel.
   */
  function _updateDailyGoalArc() {
    const row     = document.getElementById('sp-daily-goal-row');
    const arcFill = document.getElementById('sp-dg-fill');
    const todayEl = document.getElementById('sp-dg-today');
    const goalEl  = document.getElementById('sp-dg-goal');
    if (!row) return;

    const goalMins = Settings.get('dailyFocusGoalMins') || 0;

    if (goalMins <= 0) {
      row.style.display = 'none';
      return;
    }
    row.style.display = '';

    // Today's accumulated focus from completed/active sessions
    const history    = Session.getHistory ? Session.getHistory() : [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs    = todayStart.getTime();

    const historySecs = history.reduce((acc, s) => {
      if (!s.date || new Date(s.date).getTime() < todayMs) return acc;
      return acc + (s.actualFocusedSeconds || 0);
    }, 0);

    // Add the currently active session's live focused seconds
    const live    = Session.getCurrentStats ? Session.getCurrentStats() : null;
    const liveSecs = (live && live.state === 'ACTIVE') ? (live.focusedSeconds || 0) : 0;

    const totalSecs = historySecs + liveSecs;
    const totalMins = Math.floor(totalSecs / 60);

    // Format label: "1h 25m today"
    const th = Math.floor(totalMins / 60);
    const tm = totalMins % 60;
    const timeStr = th > 0 ? (tm > 0 ? `${th}h ${tm}m` : `${th}h`) : `${tm}m`;
    if (todayEl) todayEl.textContent = `${timeStr} today`;

    // Goal label: "/ 2h goal"
    const gh = Math.floor(goalMins / 60);
    const gm = goalMins % 60;
    const goalStr = gh > 0 ? (gm > 0 ? `${gh}h ${gm}m` : `${gh}h`) : `${gm}m`;
    if (goalEl) goalEl.textContent = `/ ${goalStr} goal`;

    // Arc fill: circumference = 2π × 18 ≈ 113.1
    const CIRC     = 113.1;
    const fraction = Math.min(1, totalMins / goalMins);
    if (arcFill) {
      arcFill.style.strokeDasharray  = String(CIRC);
      arcFill.style.strokeDashoffset = String(CIRC * (1 - fraction));
      arcFill.classList.toggle('sp-dg-fill-done', fraction >= 1);
    }
    row.classList.toggle('goal-reached', fraction >= 1);

    // Celebrate the moment the goal is first reached today
    if (fraction >= 1 && !_dailyGoalCelebratedToday) {
      _dailyGoalCelebratedToday = true;
      _fireDailyGoalReached();
    }
  }

  let _dailyGoalCelebratedToday = (() => {
    // Reset on new day
    const key = 'deskbuddy_goal_celebrated';
    const stored = sessionStorage.getItem(key);
    const today = new Date().toDateString();
    if (stored === today) return true;
    // On each init, clear stale date and return false so goal can re-celebrate
    sessionStorage.removeItem(key);
    return false;
  })();

  function _fireDailyGoalReached() {
    sessionStorage.setItem('deskbuddy_goal_celebrated', new Date().toDateString());

    const badge = document.getElementById('milestone-badge');
    if (badge) {
      badge.textContent = '🎯 daily goal reached!';
      badge.classList.add('visible');
      setTimeout(() => badge.classList.remove('visible'), 4500);
    }

    if (typeof Sounds !== 'undefined')    Sounds.play('overjoyed_chirp');
    if (typeof Emotion !== 'undefined')   Emotion.preview('overjoyed', 3500);
    if (typeof Particles !== 'undefined') {
      for (let i = 0; i < 12; i++) {
        setTimeout(() => Particles.spawn('excited'), i * 60);
      }
    }
  }

  /**
   * _renderBudgetDots(used, budget)
   * Renders the distraction budget dot row in the active session panel.
   * Green dots = remaining; red dots = used; nothing shown if budget = 0.
   */
  function _renderBudgetDots(used, budget) {
    const row       = document.getElementById('sp-budget-row');
    const dotsEl    = document.getElementById('sp-budget-dots');
    const countEl   = document.getElementById('sp-budget-count');
    if (!row) return;

    if (!budget || budget <= 0) {
      row.style.display = 'none';
      return;
    }
    row.style.display = '';

    if (dotsEl) {
      dotsEl.innerHTML = '';
      const MAX_DOTS = Math.min(budget, 10); // cap visual dots at 10
      for (let i = 0; i < MAX_DOTS; i++) {
        const dot = document.createElement('div');
        dot.className = 'sp-budget-dot' +
          (i < used && used > budget  ? ' over' :
           i < used                   ? ' used' : '');
        dotsEl.appendChild(dot);
      }
    }

    const remaining = Math.max(0, budget - used);
    if (countEl) {
      countEl.textContent = `${remaining}/${budget}`;
      countEl.style.color = remaining === 0
        ? 'rgba(255, 90, 90, 0.80)'
        : remaining <= Math.ceil(budget * 0.4)
          ? 'rgba(255, 190, 60, 0.80)'
          : 'rgba(200, 220, 255, 0.55)';
    }
  }

  /**
   * _fireBudgetExceeded()
   * Flash a warning when the user has used all distraction budget slots.
   */
  function _fireBudgetExceeded() {
    const row = document.getElementById('sp-budget-row');
    if (row) {
      row.classList.remove('budget-exceeded');
      // Force reflow to restart animation
      void row.offsetWidth;
      row.classList.add('budget-exceeded');
    }

    if (typeof Sounds !== 'undefined')  Sounds.play('pouty_mweh');
    if (typeof Emotion !== 'undefined') Emotion.preview('pouty', 2200);

    const badge = document.getElementById('milestone-badge');
    if (badge) {
      badge.textContent = '⚠ distraction budget spent';
      badge.classList.add('visible');
      setTimeout(() => badge.classList.remove('visible'), 3000);
    }
  }

  /**
   * _getWeekBounds(weeksAgo)
   * Returns { start, end } for a calendar week (Mon–Sun) N weeks in the past.
   */
  function _getWeekBounds(weeksAgo) {
    const now     = new Date();
    const dow     = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
    const monday  = new Date(now);
    monday.setDate(now.getDate() - dow - weeksAgo * 7);
    monday.setHours(0, 0, 0, 0);
    const sunday  = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }

  /**
   * _checkWeeklyReport()
   * Shows the weekly report modal once per calendar week (Mon–Sun).
   * Report covers the previous completed week. Skips if no sessions that week.
   */
  function _checkWeeklyReport() {
    const now     = new Date();
    const dow     = (now.getDay() + 6) % 7;
    const monday  = new Date(now);
    monday.setDate(now.getDate() - dow);
    monday.setHours(0, 0, 0, 0);
    const thisWeekKey = monday.toDateString();

    const lastShown = Settings.get('weeklyReportLastShown') || '';
    if (lastShown === thisWeekKey) return; // already shown this week

    const history = Session.getHistory ? Session.getHistory() : [];
    if (!history.length) return;

    // Get previous week sessions
    const prev = _getWeekBounds(1);
    const prevSessions = history.filter(s => {
      if (!s.date) return false;
      const t = new Date(s.date).getTime();
      return t >= prev.start.getTime() && t <= prev.end.getTime();
    });

    if (!prevSessions.length) return; // nothing to report

    // Mark as shown for this week
    Settings.set('weeklyReportLastShown', thisWeekKey);

    // Populate and show the modal (slight delay so history panel animates in first)
    setTimeout(() => _showWeeklyReport(prevSessions, prev.start, prev.end, history), 500);
  }

  function _showWeeklyReport(sessions, weekStart, weekEnd, allHistory) {
    const modal = document.getElementById('weekly-report-modal');
    if (!modal) return;

    // Date range label: "Apr 7 – Apr 13"
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmtDate = d => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const dateRangeEl = document.getElementById('wr-date-range');
    if (dateRangeEl) dateRangeEl.textContent = `${fmtDate(weekStart)} – ${fmtDate(weekEnd)}`;

    // Total focus time
    const totalSecs = sessions.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0);
    const totalMins = Math.floor(totalSecs / 60);
    const th = Math.floor(totalMins / 60);
    const tm = totalMins % 60;
    const timeStr = th > 0 ? (tm > 0 ? `${th}h ${tm}m` : `${th}h`) : `${tm}m`;
    const totalEl = document.getElementById('wr-total-time');
    if (totalEl) totalEl.textContent = totalMins > 0 ? timeStr : '0m';

    // Comparison: previous-previous week
    const pp = _getWeekBounds(2);
    const ppSessions = allHistory.filter(s => {
      if (!s.date) return false;
      const t = new Date(s.date).getTime();
      return t >= pp.start.getTime() && t <= pp.end.getTime();
    });
    const ppSecs = ppSessions.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0);
    const changeEl = document.getElementById('wr-change');
    if (changeEl) {
      const diffMins = Math.round((totalSecs - ppSecs) / 60);
      const dh = Math.floor(Math.abs(diffMins) / 60);
      const dm = Math.abs(diffMins) % 60;
      const diffStr = dh > 0 ? (dm > 0 ? `${dh}h ${dm}m` : `${dh}h`) : `${dm}m`;
      if (diffMins > 5) {
        changeEl.textContent = `↑ ${diffStr} more than last week`;
        changeEl.className   = 'wr-change up';
      } else if (diffMins < -5) {
        changeEl.textContent = `↓ ${diffStr} less than last week`;
        changeEl.className   = 'wr-change down';
      } else {
        changeEl.textContent = '→ similar to last week';
        changeEl.className   = 'wr-change same';
      }
    }

    // Sessions count
    const sessionsEl = document.getElementById('wr-sessions');
    if (sessionsEl) sessionsEl.textContent = String(sessions.length);

    // Average focus score
    const completed = sessions.filter(s => s.outcome === 'COMPLETED');
    let avgScore = null;
    if (completed.length) {
      const sum = completed.reduce((acc, s) => {
        const total   = (s.durationMinutes || 0) * 60;
        const focused = s.actualFocusedSeconds || 0;
        return acc + (total > 0 ? (focused / total) * 100 : 0);
      }, 0);
      avgScore = Math.round(sum / completed.length);
    }
    const avgEl = document.getElementById('wr-avg-focus');
    if (avgEl) avgEl.textContent = avgScore !== null ? `${avgScore}%` : '—';

    // Best day
    const byDay = {};
    sessions.forEach(s => {
      if (!s.date) return;
      const d   = new Date(s.date);
      const key = d.toDateString();
      byDay[key] = (byDay[key] || 0) + (s.actualFocusedSeconds || 0);
    });
    let bestDay = null, bestDaySecs = 0;
    Object.entries(byDay).forEach(([day, secs]) => {
      if (secs > bestDaySecs) { bestDaySecs = secs; bestDay = new Date(day); }
    });
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const bestDayEl = document.getElementById('wr-best-day');
    if (bestDayEl) bestDayEl.textContent = bestDay ? DAYS[bestDay.getDay()] : '—';

    // Top category
    const CATEGORY_EMOJI = { study: '📚', work: '💼', creative: '🎨', reading: '📖', other: '⚙️' };
    const catCounts = {};
    sessions.forEach(s => {
      const c = s.category || 'other';
      catCounts[c] = (catCounts[c] || 0) + 1;
    });
    let topCat = null, topCatCount = 0;
    Object.entries(catCounts).forEach(([cat, cnt]) => {
      if (cnt > topCatCount) { topCatCount = cnt; topCat = cat; }
    });
    const topCatEl = document.getElementById('wr-top-cat');
    if (topCatEl) {
      topCatEl.textContent = topCat
        ? `${CATEGORY_EMOJI[topCat] || '⚙️'} ${topCat}`
        : '—';
    }

    // Wire close button (once)
    const closeBtn = document.getElementById('wr-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.setAttribute('aria-hidden', 'true');
      };
    }

    // Show
    modal.setAttribute('aria-hidden', 'false');
  }

  function _wireDND() {
    const toggleBtn  = document.getElementById('dnd-toggle-btn');
    const durSelect  = document.getElementById('dnd-duration-select');
    const durRow     = document.getElementById('dnd-duration-row');

    // Populate duration select from saved setting
    const savedDur = Settings.get('dndDuration') || 25;
    if (durSelect) durSelect.value = String(savedDur);

    // Persist chosen duration in Settings whenever it changes
    if (durSelect) {
      durSelect.addEventListener('change', () => {
        Settings.set('dndDuration', parseInt(durSelect.value, 10));
      });
    }

    function _syncDNDBtn() {
      if (!toggleBtn) return;
      const on = DND.isActive();
      toggleBtn.textContent = on ? 'cancel' : 'start';
      toggleBtn.classList.toggle('dnd-btn-active', on);
      if (durRow) durRow.style.opacity = on ? '0.45' : '1';
      if (durSelect) durSelect.disabled = on;
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const dur = parseInt(durSelect?.value || '25', 10);
        DND.toggle(dur);
      });
    }

    DND.onActivate(() => _syncDNDBtn());
    DND.onDeactivate(() => _syncDNDBtn());
    _syncDNDBtn();  // set initial state
  }

  // ── _wireSidebar ──────────────────────────────────────────────────────────
  // Auto-hide session sidebar: hover the brain icon to slide the panel in;
  // leave the panel to slide it away.
  // The brain icon fades out when the panel is open so it doesn't overlap.
  // History is now in a separate #history-panel triggered by #hp-icon.

  function _wireSidebar() {
    const panel = document.getElementById('session-panel');
    const icon  = document.getElementById('sp-icon');
    if (!panel) return;

    let _hideTimer = null;

    function _open() {
      if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
      panel.classList.add('sidebar-open');
      if (icon) icon.classList.add('sp-icon-hidden');
    }

    function _scheduleClose() {
      if (_hideTimer) return;
      _hideTimer = setTimeout(() => {
        _hideTimer = null;
        // Don't close while the user has keyboard focus inside the panel
        // (e.g. typing in the goal input — mouse may have drifted out)
        if (panel.contains(document.activeElement)) return;
        panel.classList.remove('sidebar-open');
        if (icon) icon.classList.remove('sp-icon-hidden');
      }, 380);
    }

    // Only the brain icon opens the panel
    if (icon) icon.addEventListener('mouseenter', _open);

    // Keep open while mouse is inside the panel
    panel.addEventListener('mouseenter', () => {
      if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    });

    // Cancel any pending close the moment focus enters the panel
    panel.addEventListener('focusin', () => {
      if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    });

    // Schedule close when mouse leaves the panel
    panel.addEventListener('mouseleave', _scheduleClose);
  }

  // ── _wireHistorySidebar ───────────────────────────────────────────────────
  // History panel is now a separate #history-panel sidebar triggered by #hp-icon.

  function _wireHistorySidebar() {
    // Init pill clicks, calendar mode buttons, and context menu inside the
    // history card.
    HistoryPanel.init();

    const panel = document.getElementById('history-panel');
    const icon  = document.getElementById('hp-icon');
    if (!panel || !icon) return;

    function _openHistory() {
      panel.classList.add('hp-panel-open');
      icon.classList.add('hp-icon-hidden');
      requestAnimationFrame(() => {
        if (typeof HistoryPanel !== 'undefined') HistoryPanel.refresh();
      });
    }

    function _closeHistory() {
      panel.classList.remove('hp-panel-open');
      icon.classList.remove('hp-icon-hidden');
    }

    function _toggleHistory() {
      if (panel.classList.contains('hp-panel-open')) {
        _closeHistory();
      } else {
        _openHistory();
      }
    }

    // Click-to-toggle: open/close on icon click
    icon.addEventListener('click', _toggleHistory);

    // Close when clicking outside the panel (but not the icon itself)
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('hp-panel-open')) return;
      if (panel.contains(e.target) || e.target === icon || icon.contains(e.target)) return;
      _closeHistory();
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('hp-panel-open')) {
        _closeHistory();
      }
    });
  }

})();
