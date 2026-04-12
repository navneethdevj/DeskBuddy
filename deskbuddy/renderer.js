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
    // Pre-fill HH:MM:SS fields with saved default (sessionLength is in minutes)
    _setDurationSeconds((Settings.get('sessionLength') || 25) * 60);
    // Pre-fill session panel break interval from saved settings
    const breakSel = document.getElementById('session-break-select');
    if (breakSel) {
      const saved = Settings.get('breakInterval');
      breakSel.value = String(saved !== undefined ? saved : 25);
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
  _wireSidebar();

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
        Session.startNew(mins, goal);
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

        // Immediate companion reaction — only on a fresh start (not resume from pause)
        if (oldState === 'IDLE') _fireSessionStartAnim();
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

      // Goal achievement prompt on outcome screen (only for FAILED — goal still relevant)
      const goalPrompt = document.getElementById('goal-prompt');
      if (goalPrompt) {
        const hasGoal = !!(stats?.goalText || Session.getHistory()[0]?.goalText);
        const isEnd   = newState === 'FAILED';
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

        // Show share card modal after the companion's celebration animation has room to play
        setTimeout(() => {
          if (typeof ShareCard !== 'undefined' && lastSession) {
            ShareCard.show(lastSession, emotion);
          }
        }, 1800);
      }

      if (newState === 'FAILED' || newState === 'ABANDONED') {
        // Companion shows sad/crying for both failed and abandoned sessions
        Emotion.setState('crying');
        // session.js plays no sound for ABANDONED — renderer fills the gap here.
        if (newState === 'ABANDONED' && typeof Sounds !== 'undefined') Sounds.play('session_fail');
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

  // ── _wireSidebar ──────────────────────────────────────────────────────────
  // Auto-hide session sidebar: hover the brain icon to slide the panel in;
  // leave the panel to slide it away.
  // The brain icon fades out when the panel is open so it doesn't overlap.

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

})();
