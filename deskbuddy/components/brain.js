/**
 * Creature Brain — attention-based behavior state machine with focus meter.
 * Cycles through states (observe, curious, idle, sleepy) on a timer and
 * switches to followCursor when the mouse cursor is nearby.
 *
 * Tracks user activity (mouse + keyboard) via a focus meter (0–100).
 * Focus level drives emotional expression: focused (>70), idle (30–70),
 * sleepy (<30).
 *
 * Owns the main requestAnimationFrame loop and coordinates Movement,
 * SpriteAnimator, Companion, Emotion, Particles, and Status modules.
 *
 * Idle life system fires spontaneous pet-like behaviors every 14-32s so
 * the companion never feels like a static program.
 */
const Brain = (() => {
  const STATES = ['observe', 'curious', 'idle', 'sleepy'];
  const STATE_MIN = 2000;
  const STATE_MAX = 3800;
  const MAX_DRIFT = 40;

  // Face gaze — two layer system (face position + iris direction)
  const FACE_GAZE_SOFTNESS = 0.55;  // how much face position shifts gaze (higher = more pronounced following)
  const IRIS_AMPLIFY       = 120;   // scale iris gazeX/Y to screen pixels
  const IRIS_VERT_SCALE    = 0.6;   // vertical iris needs less amplification (eyes are wider than tall)

  // Neko-style body lean (https://github.com/mirandadam/neko)
  // Adapted from Neko's lerp-toward-cursor — we use face position instead
  const LEAN_STRENGTH = 0.18;  // how much body drifts toward face (keep low)
  const LEAN_LERP     = 0.04;  // momentum — Neko uses similar low values

  // Focus meter tuning
  const FOCUS_INCREASE_MOUSE = 0.4;
  const FOCUS_INCREASE_KEY = 0.8;
  const FOCUS_DECAY_RATE = 0.04; // per frame when inactive

  // Activity detection thresholds
  const MOUSE_ACTIVITY_TIMEOUT = 500;
  const KEY_ACTIVITY_TIMEOUT = 1000;

  // Idle look timing
  const IDLE_LOOK_MIN_WAIT = 3000;
  const IDLE_LOOK_MAX_WAIT = 6000;
  const IDLE_LOOK_MIN_DURATION = 1000;
  const IDLE_LOOK_MAX_DURATION = 2000;

  // Curious trigger: sustained focused attention for this long → curious state
  const CURIOUS_ATTENTION_MS  = 14000;  // 14s focused + high attention → curious
  const CURIOUS_COOLDOWN_MS   = 50000;  // 50s before curious can fire again after exiting

  // Emotion timing thresholds (ms) — tuned for snappy, responsive feel
  const LOOKING_AWAY_SUSPICIOUS_MS =  4000;   //  4s → suspicious
  const LOOKING_AWAY_POUTY_MS      = 12000;   // 12s → pouty
  const LOOKING_AWAY_GRUMPY_MS     = 28000;   // 28s → grumpy
  const NOFACE_SCARED_MS           =  2500;   //  2.5s → scared
  const NOFACE_SAD_MS              = 12000;   // 12s → sad
  const NOFACE_CRYING_MS           = 25000;   // 25s → crying

  // ── NEW PERSONALITY CONSTANTS ──────────────────────────────────────────────

  // Excited: rapid typing triggers it
  const KEYPRESS_WINDOW_MS     = 1400;  // rolling window to measure typing speed
  const KEYPRESS_EXCITED_COUNT = 7;     // keypresses within window → excited
  const EXCITED_HOLD_MS        = 3200;  // stays excited this long after last burst

  // Shy: sustained eye contact triggers it
  const EYE_CONTACT_SHY_MS     = 10000; // 10s continuous direct gaze → shy
  const SHY_HOLD_MS            = 4500;  // shy lasts this long before resolving
  const SHY_COOLDOWN_MS        = 20000; // min gap before triggering shy again

  // Love (petting): click near companion triggers it
  const PET_RADIUS             = 240;   // px from companion centre counts as pet
  const LOVE_HOLD_MS           = 3000;  // love lasts this long after click

  // Startled: sudden large mouse jerk triggers it
  const STARTLED_DIST_THRESHOLD = 280;  // px jump in a single mousemove event
  const STARTLED_HOLD_MS        = 550;  // brief flash

  // Idle life: spontaneous pet-like behaviors
  const IDLE_LIFE_MIN_WAIT     = 4000;  // 4s minimum between behaviors (at idleSpeed=2)
  const IDLE_LIFE_MAX_WAIT     = 10000; // 10s maximum (at idleSpeed=2)

  // ── Runtime-adjustable personality knobs (set via setIdleSpeed / setExpressiveness)
  let _idleSpeedMult     = 1.0;   // 1 = default; <1 = slower, >1 = faster
  let _expressMult       = 1.0;   // scales random thresholds in spontaneous pool

  // ── CHUNK 5 — new feature constants ───────────────────────────────────────

  // Phone detection: head bowed down = phone-checking posture.
  // NOTE: gazeY is head-pose *compensated* — it subtracts headPitch * 0.008, so
  // a 20° forward bow only produces ~0.16 raw correction and correctedGazeY never
  // reaches the old 0.6 threshold. headPitch alone is the reliable signal.
  const PHONE_DETECT_SUSTAIN_MS = 3000; // 3s sustained posture → trigger
  const PHONE_PITCH_THRESHOLD   = 20;   // degrees head bowed forward → phone posture
  const PHONE_PITCH_RESET       = 10;   // below this → head back up, reset timer

  // Study encouragement: reward deep focus
  const ENCOURAGEMENT_FOCUS_MIN    = 75;       // focusLevel threshold
  const ENCOURAGEMENT_GAP_MS       = 4 * 60 * 1000; // 4 minutes between encouragements

  // Milestone: celebrate every 5 continuous focused minutes
  const MILESTONE_INTERVAL_MINUTES = 5;
  const MILESTONE_MAX_MINUTES      = 25;

  // Sensitivity presets — used by timer.js via Brain.getSensitivityThresholds()
  // Thresholds: recalibrated so NORMAL/GENTLE tolerate natural study pauses.
  // Hold timers: how many seconds focus must stay below threshold before state
  //   transitions — longer for GENTLE (more patience), shorter for STRICT.
  // nofaceGraceMs: how long the face can be absent before focusLevel decays.
  // readingPitchMax: max head-pitch (°) treated as reading-a-book rather than
  //   phone use.  Students at a desk commonly reach 25–35°, so GENTLE and
  //   NORMAL widen this window well beyond the old hard-coded 20° limit.
  // readingPostureGraceMs: after leaving reading posture the focusLevel is
  //   held steady for this long before decay begins (covers glancing back up
  //   between paragraphs — "timer freeze delay" requested for book-studiers).
  // phoneDetectMs: sustained ms of headPitch > readingPitchMax required before
  //   the companion shows a suspicious reaction (phone-check animation).
  const SENSITIVITY_PRESETS = {
    GENTLE: {
      drifting: 20, distracted: 12, critical: 8,
      holdDrifting: 12, holdDistracted: 18, holdCritical: 35, holdFailed: 90,
      nofaceGraceMs: 15000,         // 15s — very forgiving
      readingPitchMax: 40,          // up to 40° = textbook on desk, wide lap reading
      readingPostureGraceMs: 10000, // 10s grace after looking back up
      phoneDetectMs: 8000,          // 8s before triggering suspicious reaction
    },
    NORMAL: {
      drifting: 30, distracted: 20, critical: 12,
      holdDrifting: 7,  holdDistracted: 12, holdCritical: 25, holdFailed: 60,
      nofaceGraceMs: 8000,          // 8s — reasonable
      readingPitchMax: 30,          // up to 30° = notes/tablet reading at a desk
      readingPostureGraceMs: 5000,  // 5s grace after looking back up
      phoneDetectMs: 5000,          // 5s before triggering suspicious reaction
    },
    STRICT: {
      drifting: 50, distracted: 38, critical: 25,
      holdDrifting: 4,  holdDistracted: 7,  holdCritical: 15, holdFailed: 40,
      nofaceGraceMs: 3000,          // 3s — quick to notice absence
      readingPitchMax: 20,          // 20° — original limit, phone detection is tight
      readingPostureGraceMs: 0,     // no grace — decay starts immediately on exit
      phoneDetectMs: 3000,          // 3s — quick phone detection (original)
    },
  };

  const STATE_LABELS = {
    observe:      'Focused',
    curious:      'Curious',
    idle:         'Idle — watching over you',
    followCursor: 'Watching You',
    sleepy:       'Getting sleepy...'
  };

  window._lastEmotion    = null;
  window._emotionChanged = null;

  let currentState = 'idle';
  let stateTimer = null;
  let animFrameId = null;
  let mouseX = -1000;
  let mouseY = -1000;

  // Activity tracking
  let focusLevel = 50;
  let lastMouseMoveTime = 0;
  let lastKeyTime = 0;

  // Idle look state
  let idleLookActive = false;
  let nextIdleLookTime = 0;

  // Tear drop spawning
  let tearInterval   = null;
  let _poolVh        = 0;         // current tear-pool height in vh units
  let _poolDrainInt  = null;      // interval that slowly drains the pool
  const POOL_MAX_VH       = 14;   // max pool fill height
  const POOL_PER_TEAR_VH  = 0.22; // how much each normal tear adds
  const POOL_DRAIN_RATE   = 0.20; // vh removed per drain tick
  const POOL_DRAIN_TICK   = 320;  // ms between drain ticks

  // Overjoyed/sulking sequence (Tamagotchi return-from-neglect concept)
  let overjoyedTimer    = null;
  let sulkCheckInterval = null;

  // Focus timer
  let _focusSecs  = 0;
  let _nofaceSecs = 0;
  let _timerInt   = null;

  // NoFace grace: ms the camera has had no face — focusLevel is frozen until
  // the grace period (from sensitivity preset) expires, then starts decaying.
  let _nofaceGraceMs = 0;

  // Reading-posture grace: track the post-reading cooldown so focusLevel is
  // held steady for readingPostureGraceMs after the student stops reading.
  let _readingPostureGraceMs = 0;   // accumulated ms since reading posture ended
  let _wasInReadingPosture   = false; // true if posture was active last frame

  // Whisper queue
  let _whisperQueue = [];
  let _whisperBusy  = false;

  // Face gaze interpolation removed — smoothing handled by
  // One Euro Filter in perception.js + lerp in companion.js (no double-lerp needed)

  // Neko-style lean state — body offset toward face
  let leanCurrentX = 0, leanCurrentY = 0;

  // Face dropout grace — hold last gaze when face detection drops.
  // 1500ms covers typical MediaPipe dropout bursts (1–3 frames at 15fps)
  // and prevents eyes from teleporting to center on brief face loss.
  let lastFaceGazeTime = 0;

  // ── NEW PERSONALITY STATE ─────────────────────────────────────────────────

  // Excited — rapid typing detection
  let _keyPressTimes  = [];      // rolling timestamps of recent keypresses
  let _excitedUntil   = 0;       // epoch ms when excited state expires

  // ── Typing rhythm state ────────────────────────────────────────────────────
  let _keyRhythmState  = 'idle';  // 'idle' | 'thinking' | 'flow' | 'frustrated'
  let _keyRhythmSince  = 0;       // epoch ms when current rhythm state started
  let _rhythmHoldTimer = null;    // debounce before committing to flow/thinking

  // Extended rolling window for rhythm measurement (needs 3s: 2s measure + 1s debounce)
  let _rhythmKeyTimes  = [];      // 3s rolling window — separate from _keyPressTimes
  let _backspaceTimes  = [];      // 3s rolling window of delete/backspace presses

  // Flow milestone tracking — reset each time flow state is entered
  let _flowMilestones  = new Set();   // which milestones (30, 60, 120, 300) have fired

  // DND (Do Not Disturb) — suppresses rhythm reactions and spontaneous behavior
  let _dndActive = false;

  // Shy — sustained eye contact detection
  let _eyeContactStart  = 0;     // epoch ms when continuous eye contact began
  let _shyUntil         = 0;     // epoch ms when shy state expires
  let _shyCooldownUntil    = 0;     // epoch ms after which shy can trigger again
  let _curiousCooldownUntil = 0;    // epoch ms after which curious can trigger again

  // Love (petting) — click interaction
  let _loveUntil = 0;            // epoch ms when love state expires

  // Cozy (long-press snuggle) — hold mouse near companion
  let _cozyUntil       = 0;      // epoch ms when cozy state expires
  let _mousedownNear   = false;  // true if mousedown happened near companion
  let _mousedownTime   = 0;      // epoch ms when mousedown near companion started
  const LONG_PRESS_MS  = 800;    // ms held = long press → cozy
  const COZY_HOLD_MS   = 5000;   // cozy lasts this long after release

  // Rapid-pet burst — multiple quick clicks
  let _petClickTimes      = [];  // rolling timestamps of pet-zone clicks
  const PET_BURST_COUNT   = 3;   // clicks within window → burst reaction
  const PET_BURST_WINDOW_MS = 1500; // rolling window (ms)

  // Status text cache — avoids redundant DOM writes
  let _lastStatusText = '';

  // Startled — sudden mouse jerk
  let _startledUntil = 0;        // epoch ms when startled state expires
  let _prevMouseX    = -1000;    // previous mousemove X for speed detection
  let _prevMouseY    = -1000;

  // Idle life timer
  let _idleLifeTimer = null;
  const FACE_GAZE_HOLD_MS = 500;

  // ── CHUNK 5 — new private state ────────────────────────────────────────────

  // Phone detection
  let _phoneDetectionEnabled = localStorage.getItem('deskbuddy_phone_detect') !== 'false';
  let _phoneCheckMs          = 0;    // ms phone posture has been held continuously
  const _phoneCallbacks      = [];

  // Study encouragement
  let _lastEncouragementTime = 0;

  // Sleepy-user nudge — rate-limit wake-up whispers to avoid spam
  let _lastSleepyNudge = 0;
  // Happy flash during observe state — rate-limit so it stays special
  let _lastHappyFlashTime = 0;

  // Milestone celebration
  let _continuousFocusedMs    = 0;
  let _nextMilestoneMinutes   = MILESTONE_INTERVAL_MINUTES;
  const _milestoneCallbacks   = [];

  // Welcome-back sequence guards
  let _welcomeBackSeqId1 = null;
  let _welcomeBackSeqId2 = null;

  // Away-detection: track last confirmed face-present frame
  let _lastFacePresenceMs = 0;      // epoch ms of the last frame where facePresent was true
  let _absenceHandled     = false;  // prevents double-firing the return reaction

  // Curious look loop — continuous gaze scan while in curious state
  let _curiousLookTimer  = null;
  let _curiousChirpTimer = null;

  // Sensitivity
  let _sensitivityLevel = localStorage.getItem('deskbuddy_sensitivity') || 'NORMAL';

  // ── TIME-OF-DAY STATE ─────────────────────────────────────────────────────
  const _NIGHT_SESSIONS_KEY    = 'deskbuddy_night_sessions';
  const _NIGHT_WHISPER_KEY     = 'deskbuddy_night_whisper_date';
  let   _currentTimePeriod     = 'AFTERNOON'; // set at each session start
  // _runtimeSensitivity: temporary override that doesn't touch localStorage
  let   _runtimeSensitivity    = null;

  // ===== Activity Helpers =====

  function isMouseActive(now) {
    return (now - lastMouseMoveTime) < MOUSE_ACTIVITY_TIMEOUT;
  }

  function isKeyActive(now) {
    return (now - lastKeyTime) < KEY_ACTIVITY_TIMEOUT;
  }

  // ===== Public API =====

  function start() {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', _onScreenClick);
    document.addEventListener('mousedown', _onMouseDown);
    document.addEventListener('mouseup', _onMouseUp);
    Movement.init();
    enterState('idle');
    tick();
    _startFocusTimer();
    _startIdleLife();
  }

  function stop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (stateTimer) {
      clearTimeout(stateTimer);
      stateTimer = null;
    }
  }

  function getState() {
    return currentState;
  }

  function getFocusLevel() {
    return focusLevel;
  }

  // ===== Main Loop =====

  function tick() {
    animFrameId = requestAnimationFrame(tick);

    var now = Date.now();
    updateFocusMeter(now);

    // Smooth pupil interpolation every frame
    Companion.updatePupils();

    // Particle effects based on current emotion
    Particles.update(Emotion.getState());

    var mouseActive = isMouseActive(now);
    var keyActive = isKeyActive(now);

    switch (currentState) {
      case 'observe':
        Movement.update();
        if (window.perception?.facePresent) {
          _applyFaceGaze();
          _applyBodyLean();
          lastFaceGazeTime = now;
        } else if (now - lastFaceGazeTime >= FACE_GAZE_HOLD_MS) {
          // Gentle ambient gaze drift when face not detected
          var time = now * 0.001;
          var c = Companion.getCenter();
          Companion.lookAt(
            c.x + Math.sin(time * 0.5) * 80,
            c.y + Math.sin(time * 0.3) * 40
          );
        }
        break;
      case 'curious':
        Movement.decay();
        if (window.perception?.facePresent) {
          _applyFaceGaze();
          _applyBodyLean();
          lastFaceGazeTime = now;
        }
        break;
      case 'idle':
        Movement.decay();
        if (window.perception?.facePresent) {
          _applyFaceGaze();
          _applyBodyLean();
          lastFaceGazeTime = now;
        } else if (now - lastFaceGazeTime >= FACE_GAZE_HOLD_MS) {
          applyGaze(now, mouseActive, keyActive);
        }
        break;
      case 'followCursor':
        // followCursor is unused when face camera is active —
        // transition to a perception-driven state instead
        pickNextState();
        break;
      case 'sleepy':
        Movement.decay();
        if (window.perception?.facePresent) {
          _applyFaceGaze();
          _applyBodyLean();
          lastFaceGazeTime = now;
        } else if (now - lastFaceGazeTime >= FACE_GAZE_HOLD_MS) {
          applyGaze(now, mouseActive, keyActive);
        }
        break;
    }

    // Focus-driven emotion
    applyFocusEmotion();
  }

  // ===== Focus Meter =====

  function updateFocusMeter(now) {
    var mouseActive = isMouseActive(now);
    var keyActive = isKeyActive(now);

    if (mouseActive) focusLevel = Math.min(100, focusLevel + FOCUS_INCREASE_MOUSE);
    if (keyActive)   focusLevel = Math.min(100, focusLevel + FOCUS_INCREASE_KEY);

    if (!mouseActive && !keyActive) {
      const p = window.perception;
      const thr = SENSITIVITY_PRESETS[_runtimeSensitivity || _sensitivityLevel]
               || SENSITIVITY_PRESETS['NORMAL'];

      // Determine whether the camera currently sees the user's face
      const facePresent = window.cameraAvailable ? (p?.facePresent ?? true) : true;

      if (!facePresent) {
        // NoFace grace: freeze focusLevel for a sensitivity-dependent window
        // before we start penalising absence (handles looking away to write notes).
        _nofaceGraceMs += 16;  // ~60fps frame ≈ 16ms
        if (_nofaceGraceMs > thr.nofaceGraceMs) {
          focusLevel = Math.max(0, focusLevel - FOCUS_DECAY_RATE);
        }
        // During grace: hold steady — do not build, do not decay.
      } else {
        _nofaceGraceMs = 0;  // reset grace timer whenever face is present

        // When the camera confirms the user is facing forward with eyes open,
        // slowly build focus — covers physical book reading and any screen
        // activity that doesn't involve keyboard/mouse input.
        const cameraFocused = window.cameraAvailable && p?.facePresent
                           && p.userState === 'Focused' && p.attentionScore > 35;

        // Reading posture: head pitched between 10° and readingPitchMax downward.
        // readingPitchMax is sensitivity-dependent: GENTLE=40°, NORMAL=30°, STRICT=20°.
        // This covers students reading physical textbooks (typically 20–35° on a desk).
        // Phone detection starts above readingPitchMax, not at the old hard-coded 20°.
        // Treat as soft focus: freeze focusLevel (no reward, no penalty).
        const isReadingPosture = window.cameraAvailable && p?.facePresent
                              && p.headPitch > 10 && p.headPitch < thr.readingPitchMax;

        if (cameraFocused) {
          // Caps at 80 — leaves room for keyboard/mouse to push to 100 (deep focus)
          _wasInReadingPosture   = false;
          _readingPostureGraceMs = 0;
          focusLevel = Math.min(80, focusLevel + FOCUS_DECAY_RATE * 0.4);
        } else if (isReadingPosture) {
          // Reading notes — hold steady, neither reward nor penalise.
          // Reset grace accumulator while actively in reading posture.
          _wasInReadingPosture   = true;
          _readingPostureGraceMs = 0;
        } else if (_wasInReadingPosture && _readingPostureGraceMs < thr.readingPostureGraceMs) {
          // Just looked back up — hold focus steady for the grace window
          // (covers glancing up between paragraphs in a book).
          _readingPostureGraceMs += 16;  // ~60fps frame ≈ 16ms
        } else {
          // Grace expired (or never started) — normal focus decay.
          _wasInReadingPosture = false;
          focusLevel = Math.max(0, focusLevel - FOCUS_DECAY_RATE);
        }
      }
    }
  }

  /**
   * Update the status bar to reflect the currently displayed emotion.
   * Throttled via string comparison — only writes to DOM when text changes.
   */
  function _updateStatus(emotion) {
    const labels = {
      idle:        'Idle',
      focused:     'Focused',
      curious:     'Curious',
      sleepy:      'Sleepy',
      happy:       'Happy',
      scared:      'Scared',
      sad:         'Sad',
      crying:      'Crying',
      grumpy:      'Grumpy',
      pouty:       'Pouty',
      suspicious:  'Suspicious',
      sulking:     'Sulking',
      overjoyed:   'Overjoyed',
      excited:     'Excited',
      shy:         'Shy >/<',
      love:        'Loved ♡',
      startled:    'Startled !',
      cozy:        'Cozy ♡',
      embarrassed: 'Embarrassed',
      forgiven:    'Forgiven ♡',
    };
    const eLabel = labels[emotion] || emotion || 'Idle';
    const p = window.perception;
    const rhythmTag = _keyRhythmState === 'flow'
      ? ' · ' + _getTypingWpm() + ' wpm'
      : (_keyRhythmState === 'frustrated' ? ' · struggling...' : '');
    const text = (window.cameraAvailable && p && p.facePresent)
      ? eLabel + ' · ' + p.attentionScore + '%' + rhythmTag
      : eLabel + rhythmTag;
    if (text !== _lastStatusText) {
      _lastStatusText = text;
      Status.setText(text);
    }
  }

  /**
   * Quietly set an emotion without triggering the emotion-change arc logic.
   * Used for timed override states (love, startled, excited, shy, cozy) so normal
   * transition side-effects (overjoyed arc, tears, etc.) don't fire.
   */
  function _setQuiet(emotion) {
    if (window._lastEmotion !== emotion) {
      window._emotionChanged = { from: window._lastEmotion, to: emotion };
      window._lastEmotion    = emotion;
    }
    Emotion.setState(emotion);
    _updateStatus(emotion);
  }

  /**
   * Set emotion based on perception signals.
   * Expression reactions (smile, surprise) use face-api.js concept:
   *   https://github.com/justadudewhohacks/face-api.js
   * Implemented via MediaPipe blendshapes (face-api NOT installed).
   *
   * Priority order (highest first):
   *   love > startled > happy(smile) > excited > shy-hold >
   *   curious-state guard > overjoyed/sulk guard > shy-trigger > normal
   */
  function applyFocusEmotion() {
    const p   = window.perception;
    const now = Date.now();

    // Track last seen — resets absence guard so next departure gets fresh handling
    if (window.perception?.facePresent) {
      _lastFacePresenceMs = now;
      _absenceHandled     = false;
    }

    // 1. Love hold (petting click) — most intimate, highest priority
    if (now < _loveUntil) { _setQuiet('love'); return; }

    // 1b. Cozy (long-press snuggle) — deep affection hold
    if (now < _cozyUntil) { _setQuiet('cozy'); return; }

    // 2. Startled hold — brief flash that overrides everything except love
    if (now < _startledUntil) { _setQuiet('startled'); return; }

    // 3. Smile check — always reacts to user smiling
    if (window.cameraAvailable && p?.facePresent && p.userSmiling
        && !overjoyedTimer && !sulkCheckInterval) {
      _setQuiet('happy');
      return;
    }

    // 4. Excited hold — rapid typing energy
    if (now < _excitedUntil && !overjoyedTimer && !sulkCheckInterval) {
      _setQuiet('excited');
      return;
    }

    // 5. Shy hold — already in shy state
    if (now < _shyUntil && !overjoyedTimer && !sulkCheckInterval) {
      _setQuiet('shy');
      return;
    }

    if (currentState === 'curious') return;
    // Don't override during overjoyed→sulking→forgiven sequence
    if (overjoyedTimer || sulkCheckInterval) return;

    // No camera available — fall back to original focus meter logic
    if (!window.cameraAvailable || !p) {
      if      (focusLevel > 70) Emotion.setState('focused');
      else if (focusLevel < 30) Emotion.setState('sleepy');
      else                      Emotion.setState('idle');
      return;
    }

    const tms = p.timeInStateMs;
    let emotion;

    switch (p.userState) {
      case 'Focused':
        // face-api concept: react to user expressions
        // userSurprised from perception.js maps jawOpen+eyeWide blendshapes (face-api: surprise)
        // Both surprise (instant) and sustained attention trigger curious —
        // surprise is an immediate "what?" reaction, sustained is "you've been watching me"
        if (p.userSurprised && now >= _curiousCooldownUntil) {
          emotion = 'curious';
          // Stamp cooldown here so the emotion path doesn't loop curious every frame
          _curiousCooldownUntil = now + 18000;
        } else if (tms >= CURIOUS_ATTENTION_MS
              && p.attentionScore > 40
              && now >= _curiousCooldownUntil) {
          emotion = 'curious';
          // Stamp cooldown here so the emotion path doesn't loop curious every frame
          _curiousCooldownUntil = now + 18000;
        } else {
          // Shy trigger — sustained eye contact while companion would normally be 'focused'
          if (p.eyeContact) {
            if (!_eyeContactStart) _eyeContactStart = now;
            if ((now - _eyeContactStart) >= EYE_CONTACT_SHY_MS
                && now >= _shyCooldownUntil) {
              _shyUntil         = now + SHY_HOLD_MS;
              _shyCooldownUntil = now + SHY_COOLDOWN_MS;
              _eyeContactStart  = 0;
              const shyMsgs = ['...hi.', '*blushes*', 'h-hi there...', '/// ...',
                               '*looks away*', 'um...', 'don\'t stare...', '*fidgets*',
                               'h-hello...', '(*ノωノ)'];
              if (Math.random() < 0.7) {
                showWhisper(shyMsgs[Math.floor(Math.random() * shyMsgs.length)], 4000);
              }
              _setQuiet('shy');
              return;
            }
          } else {
            _eyeContactStart = 0;
          }
          emotion = 'focused';
        }
        break;

      case 'LookingAway':
        _eyeContactStart = 0;
        if      (tms >= LOOKING_AWAY_GRUMPY_MS)     emotion = 'grumpy';
        else if (tms >= LOOKING_AWAY_POUTY_MS)       emotion = 'pouty';
        else if (tms >= LOOKING_AWAY_SUSPICIOUS_MS)  emotion = 'suspicious';
        else                                         emotion = 'idle';
        break;

      case 'Sleepy':
        // Companion stays wide-awake and motivates the user — alternate emotions
        // to feel more alive rather than locked to a single expression.
        // Cycle: curious 10s → focused 8s → happy 4s → repeat (22s period)
        { const slot = Math.floor(now / 1000) % 22;
          if      (slot < 10) emotion = 'curious';
          else if (slot < 18) emotion = 'focused';
          else                emotion = 'happy';
        }
        if ((now - _lastSleepyNudge) >= 30000) {
          _lastSleepyNudge = now;
          const wakeUpMsgs = [
            'hey, don\'t sleep!', '*nudges you*', 'stay awake! 💪',
            'you can do it!', '*waves paw*', 'almost there, keep going!',
            'zzz? no no no!', '...hey!', '*pokes*', 'need a break?',
            'you\'re so close!', '*worried chirp*', 'don\'t give up!',
          ];
          if (Math.random() < 0.65) {
            showWhisper(wakeUpMsgs[Math.floor(Math.random() * wakeUpMsgs.length)], 4000);
          }
        }
        break;

      case 'NoFace':
        _eyeContactStart = 0;
        if      (tms >= NOFACE_CRYING_MS) emotion = 'crying';
        else if (tms >= NOFACE_SAD_MS)    emotion = 'sad';
        else if (tms >= NOFACE_SCARED_MS) emotion = 'scared';
        else                              emotion = 'idle';
        break;

      default:
        emotion = 'idle';
    }

    // ── Timer state priority ─────────────────────────────────────────────────
    // When a session is running and the timer is in a degraded state, bias
    // the companion's expression toward the timer-appropriate emotion rather
    // than showing 'focused'/'idle' (camera says "you're looking at screen"
    // but session logic says "you're drifting"). This is the root cause of
    // the "emotion delay" — the rAF loop was overriding timer-set emotions.
    const _ts = document.body.dataset.timerState;
    if (_ts && _ts !== 'FOCUSED' && _ts !== 'FAILED'
           && (emotion === 'focused' || emotion === 'idle')) {
      if      (_ts === 'CRITICAL')   emotion = 'grumpy';
      else if (_ts === 'DISTRACTED') emotion = 'pouty';
      else if (_ts === 'DRIFTING')   emotion = 'suspicious';
    }

    // Track changes for audio + manage tears
    if (emotion !== window._lastEmotion) {
      // Return-from-absence: face reappeared while still in distress emotion
      // applyFocusEmotion fires before enterState, so detect return here too
      const wasAbsent = window._lastEmotion === 'scared'
                     || window._lastEmotion === 'sad'
                     || window._lastEmotion === 'crying';
      if (wasAbsent && p.facePresent) {
        _welcomeBackSequence();
        return;
      }

      // Whisper a personality message for notable emotion transitions
      const whisper = _getWhisperFor(emotion);
      if (whisper && Math.random() < 0.42) {
        showWhisper(whisper[Math.floor(Math.random() * whisper.length)], 4000);
      }

      window._emotionChanged = { from: window._lastEmotion, to: emotion };
      window._lastEmotion    = emotion;

      // Start tears on crying, stop on any other emotion
      if (emotion === 'crying') {
        _startTears();
      } else if (tearInterval) {
        _stopTears();
      }
    }

    Emotion.setState(emotion);
    _updateStatus(emotion);

    // ── Typing pause detection ────────────────────────────────────────────────
    // Detects: was typing recently, now stopped, face is still present.
    // Transitions typing rhythm to idle, fires a small observational reaction.
    const timeSinceKey      = now - lastKeyTime;
    const wasTypingRecently = timeSinceKey > 5000 && timeSinceKey < 20000;
    // Fall back to true when no camera — assume face present
    const faceStillPresent  = window.cameraAvailable ? window.perception?.facePresent : true;

    if (wasTypingRecently && faceStillPresent && _keyRhythmState !== 'idle') {
      _setTypingRhythm('idle');
      // 40% chance of a small "noticed you stopped" reaction
      if (!_dndActive && Math.random() < 0.40) {
        setTimeout(() => {
          if (Date.now() - lastKeyTime > 4000) {
            _doIdleLook();  // glances sideways briefly
          }
        }, 800);
      }
    }
  }

  /**
   * Return an array of whisper messages for an emotion, or null if none.
   * These are shown occasionally (42% chance) when the emotion changes.
   */
  function _getWhisperFor(emotion) {
    const map = {
      curious:    ['*tilts head* ...?', 'hm...?', '...👀', 'what\'s that?',
                   'ooh?', '*squints curiously*', 'wait...', '...interesting.',
                   '*perks up*', 'tell me more~', '...oh?', 'i see something~',
                   '*ears perk up*', 'hmmmm...', '( •᷅ ᵕ •᷄ )?', '*leans forward*'],
      happy:      ['✨', '~♪', 'hehe~', '*tail wag*',
                   ':)', '*bounces*', 'yay~', '(*^▽^*)',
                   'this is nice~', '♪ la la~', 'i\'m happy~',
                   'everything is good ✦', '*glows softly*', '(◕‿◕)✨',
                   '...life is good~', 'wheee~♡'],
      scared:     ['...!', '*hides*', 'eep!',
                   '*clings to corner*', 'too scary...', 'w-wait...',
                   '*shaking*', 'i don\'t like this...', 'please no.',
                   '(´• ω •`)...', '*holds breath*', 'don\'t leave me here...'],
      sad:        ['...', '*sniffles*', 'come back...', '...please',
                   '*hugs knees*', 'i miss you...', 'don\'t leave.',
                   'it\'s so quiet...', '(╥_╥)', '*wipes eyes*',
                   '...lonely.', '*stares at the door*', 'where did you go...'],
      crying:     ['*sobbing quietly*', 'please...',  'don\'t go...',
                   'come back...', '*tears*', 'i can\'t stop...',
                   'why...', '*hiccups*', 'it\'s too much...',
                   '...i tried to be good...', '*gasps*', 'it hurts...'],
      grumpy:     ['hmph.', '*huffs*', '...fine.',
                   'whatever.', '*tail flick*', 'don\'t talk to me.',
                   '...annoying.', '*looks away*', 'i\'m fine. (i\'m not)',
                   '*grumbles*', 'not in the mood.', '...leave me alone.'],
      pouty:      ['hmph.', '...rude.', '*crosses arms*',
                   'that\'s not fair.', '*pouts*', 'you owe me.',
                   '...i\'m pouting.', '*sulk*', 'apologize first.',
                   'this is protest.', '*sticks tongue out*', 'nope.'],
      sulking:    ['*stares at wall*', 'i\'m not upset.', '...',
                   'don\'t look at me.', '*ignoring you*', 'totally fine.',
                   '...........', '*turns away*', 'just leave me alone.',
                   '*silence*', '...', '*very fine*'],
      sleepy:     ['*yawns*', 'zzz...', 'so sleepy...',
                   '*heavy eyelids*', 'five more minutes...', '...mmh.',
                   '*dozes off*', 'can\'t... keep... eyes... open...', 'zZz~',
                   '*blinks slowly*', '...tired...', '...just a nap~'],
      suspicious: ['...?', '*narrows eyes*', 'hmm.',
                   'something\'s off.', '*watches carefully*', 'i see you.',
                   '...sus.', '*squint*', 'explain.', 'not sure about this.',
                   '*slow blink*', '...i\'m watching you.', 'seems off...'],
      overjoyed:  ['🎉', 'you\'re back!!', '*zooms around*',
                   'YAAAY!!', '*happy spinning*', 'i missed you so much!!',
                   'eeeee!!', '(≧▽≦)/', '*cannot contain excitement*',
                   'best day EVER!!', '*happy tears*', '!!!!!'],
      excited:    ['!!!', '*vibrating*', 'let\'s go!!!', 'yesyesyes!',
                   'omg omg omg', '*bouncing off walls*', 'THIS IS AMAZING',
                   '(*≧▽≦)', 'so excited!!', 'LETSGOOO!!',
                   '*zooms*', '!!!!!!!', '*literally cannot*'],
      shy:        ['...hi.', '*blushes*', 'h-hi there...', '/// ...',
                   '*looks away*', 'um...', 'don\'t stare...', '*fidgets*',
                   'h-hello...', '(*ノωノ)', 'n-not like that...',
                   '*covers face*', '...you\'re looking at me...', '>///<'],
      love:       ['♡', '*purrs*', '*nuzzles*', '...♡',
                   'i like you~', '*rubs head on you*', 'stay forever.',
                   '♡♡♡', '*happy purr*', 'you\'re warm~',
                   '*slow blink* ♡', 'mine~', '...you smell nice.',
                   '*kneads happily*', 'i choose you.', '♡ always ♡'],
      startled:   ['!!', '*jumps*', 'w-what?!',
                   'AH!', '*startled floof*', 'you scared me!!',
                   '(*o*)!', 'don\'t do that!!', 'my heart...',
                   '*fur stands up*', 'WARNING!!', 'not cool!!!'],
      cozy:       ['...♡', 'mmh~', '*melts*', 'safe here.',
                   'don\'t move...', '...warm.', '*purrs softly*',
                   'this is perfect.', '...never leave.', '♡ cozy ♡',
                   '*snuggles deeper*', '...home.', 'staying like this forever~'],
    };
    return map[emotion] || null;
  }

  // ===== Gaze Logic (idle / sleepy states) =====

  /**
   * Determine where the eyes should look when face is not detected.
   * Falls through to idle random-look behavior.
   */
  function applyGaze(now, mouseActive, keyActive) {
    checkIdleLook(now);
  }

  /**
   * Two-layer face gaze — no brain-side lerp.
   * Layer 1: face position on screen (where IS the user's face)
   * Layer 2: iris offset from perception.gazeX/Y (where eyes are POINTING)
   *
   * Raw webcam faceX is horizontally flipped relative to the user's view
   * (user moves left → face appears on RIGHT of raw image). Mirror X so
   * the companion's eyes track toward the user's actual position.
   *
   * Smoothing is handled upstream (One Euro Filter in perception.js) and
   * downstream (gradient + pupil lerp in companion.js). No intermediate
   * lerp needed — removing double-lerp makes eyes responsive to face movement.
   *
   * Reference: https://github.com/arnaudlvq/Eye-Contact-RealTime-Detection
   * Combined face position + iris direction = more natural gaze than either alone.
   */
  function _applyFaceGaze() {
    const p = window.perception;
    if (!p?.facePresent) return;

    const center = Companion.getCenter();

    // Layer 1 — face position (One Euro filtered in perception.js).
    // Mirror X: raw webcam X is flipped relative to user's perspective.
    const facePosX = (1 - p.faceX) * window.innerWidth;
    const facePosY = p.faceY * window.innerHeight;
    const softX    = center.x + (facePosX - center.x) * FACE_GAZE_SOFTNESS;
    const softY    = center.y + (facePosY - center.y) * FACE_GAZE_SOFTNESS;

    // Layer 2 — iris gaze direction adds subtle extra offset.
    // Negate X for same mirror consistency as face position.
    const irisX = -p.gazeX * IRIS_AMPLIFY;
    const irisY = p.gazeY * (IRIS_AMPLIFY * IRIS_VERT_SCALE);

    // Pass directly to lookAt — companion handles smooth lerp internally
    Companion.lookAt(softX + irisX, softY + irisY);
  }

  /**
   * Neko-style body lean — body drifts toward face position with momentum.
   * Reference: https://github.com/mirandadam/neko
   *
   * Neko lerps the cat toward the cursor. We do the same but toward the
   * user's face. LEAN_LERP and LEAN_STRENGTH kept low — should feel like
   * quiet interest, not chasing. Clamped to ±40px (existing MAX_DRIFT).
   * Mirror X for consistency with _applyFaceGaze.
   */
  function _applyBodyLean() {
    const p = window.perception;
    if (!p?.facePresent) return;

    const center   = Companion.getCenter();
    const facePosX = (1 - p.faceX) * window.innerWidth;
    const facePosY = p.faceY * window.innerHeight;

    const targetX = (facePosX - center.x) * LEAN_STRENGTH;
    const targetY = (facePosY - center.y) * LEAN_STRENGTH;

    leanCurrentX += (targetX - leanCurrentX) * LEAN_LERP;
    leanCurrentY += (targetY - leanCurrentY) * LEAN_LERP;

    Companion.setPosition(
      Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, leanCurrentX)),
      Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, leanCurrentY))
    );
  }

  // ===== Idle Look =====

  function checkIdleLook(now) {
    if (now - lastMouseMoveTime < IDLE_LOOK_MIN_WAIT) return;
    if (idleLookActive) return;
    if (now < nextIdleLookTime) return;

    triggerIdleLook();
  }

  function triggerIdleLook() {
    idleLookActive = true;
    var c = Companion.getCenter();
    var patterns = [
      { x: c.x - 200, y: c.y },      // look left
      { x: c.x + 200, y: c.y },      // look right
      { x: c.x, y: c.y },            // look center
      { x: window.innerWidth / 2, y: window.innerHeight / 2 } // screen center
    ];
    var target = patterns[Math.floor(Math.random() * patterns.length)];
    Companion.lookAt(target.x, target.y);

    var duration = IDLE_LOOK_MIN_DURATION + Math.random() * (IDLE_LOOK_MAX_DURATION - IDLE_LOOK_MIN_DURATION);
    setTimeout(function () {
      if (currentState !== 'followCursor') {
        Companion.resetLook();
      }
      idleLookActive = false;
      nextIdleLookTime = Date.now() + IDLE_LOOK_MIN_WAIT + Math.random() * (IDLE_LOOK_MAX_WAIT - IDLE_LOOK_MIN_WAIT);
    }, duration);
  }

  // ===== State Management =====

  function enterState(state) {
    // Return-from-absence detection (Tamagotchi/WebPet concept)
    // When user returns after DeskBuddy was scared/sad/crying → overjoyed sequence
    const wasAbsent = window._lastEmotion === 'scared'
                   || window._lastEmotion === 'sad'
                   || window._lastEmotion === 'crying';
    const returning = (state === 'observe' || state === 'idle')
                   && window.perception?.facePresent;
    if (wasAbsent && returning) { _welcomeBackSequence(); return; }

    currentState = state;

    // Status text is driven by the active emotion, not the brain state name.
    // _updateStatus is called by applyFocusEmotion / _setQuiet on each frame.
    // Refresh once here so the bar is never stale after a state transition.
    _updateStatus(window._lastEmotion || 'idle');

    if (stateTimer) {
      clearTimeout(stateTimer);
      stateTimer = null;
    }

    // When leaving curious, start the re-trigger cooldown
    if (currentState === 'curious' && state !== 'curious') {
      _curiousCooldownUntil = Date.now() + CURIOUS_COOLDOWN_MS;
      if (_curiousChirpTimer) { clearTimeout(_curiousChirpTimer); _curiousChirpTimer = null; }
    }

    Companion.setRotation(0);

    switch (state) {
      case 'observe':
        Emotion.setState('focused');
        SpriteAnimator.play('idle');
        _scheduleObserveHappyFlash();
        break;
      case 'curious':
        Emotion.setState('curious');
        SpriteAnimator.play('idle');
        _curiousLookLoop();
        _scheduleCuriousChirps();
        break;
      case 'idle':
        Emotion.setState('idle');
        if (!window.perception?.facePresent) Companion.resetLook();
        SpriteAnimator.play('idle');
        scheduleHappyFlash();
        break;
      case 'followCursor':
        Emotion.setState('focused');
        SpriteAnimator.play('idle');
        break;
      case 'sleepy':
        Emotion.setState('sleepy');
        if (!window.perception?.facePresent) Companion.resetLook();
        SpriteAnimator.play('idle');
        break;
    }

    if (state !== 'followCursor') {
      scheduleNext();
    }
  }

  function scheduleNext() {
    if (stateTimer) clearTimeout(stateTimer);
    var duration = STATE_MIN + Math.random() * (STATE_MAX - STATE_MIN);
    stateTimer = setTimeout(function () { pickNextState(); }, duration);
  }

  /**
   * Context-aware state selection.
   * Adapted from Web Shimeji behavior tree concept:
   * https://github.com/karin0/web-shimeji
   * States chosen based on what user is doing, not purely random.
   */
  function pickNextState() {
    const p = window.perception;
    if (p) {
      if (p.userState === 'NoFace')  { enterState('idle');    return; }
      if (p.userState === 'Sleepy')  { enterState('observe'); return; } // stay alert, motivate user
      if (p.userState === 'Focused'
       && p.timeInStateMs >= CURIOUS_ATTENTION_MS
       && p.attentionScore > 50
       && Date.now() >= _curiousCooldownUntil) { enterState('curious'); return; }
      if (p.userState === 'Focused' || p.userState === 'LookingAway') {
        // Sprinkle in 'idle' 25% of the time for visual variety — prevents
        // the companion looking rigidly locked to 'observe' forever.
        enterState(Math.random() < 0.25 ? 'idle' : 'observe');
        return;
      }
    }
    // Fallback: random (original behavior, used when camera unavailable)
    var next = STATES[Math.floor(Math.random() * STATES.length)];
    enterState(next);
  }

  // ===== Helpers =====

  /** Animate gaze looking left → right → up → center. */
  function triggerLookSequence() {
    var c = Companion.getCenter();

    Companion.lookAt(c.x - 300, c.y);
    setTimeout(function () {
      if (currentState !== 'curious') return;
      Companion.lookAt(c.x + 300, c.y);
      setTimeout(function () {
        if (currentState !== 'curious') return;
        Companion.lookAt(c.x, c.y - 200);
        setTimeout(function () {
          if (currentState === 'curious') Companion.resetLook();
        }, 600 + Math.random() * 400);
      }, 600 + Math.random() * 400);
    }, 600 + Math.random() * 400);
  }

  /**
   * Continuous gaze-scan loop while in the curious state.
   * Picks a random look target, holds it briefly, then reschedules itself.
   * Mixes quick flicks with longer stares and occasionally vocalises.
   * Stops as soon as the state is no longer 'curious'.
   */
  function _curiousLookLoop() {
    if (_curiousLookTimer) { clearTimeout(_curiousLookTimer); _curiousLookTimer = null; }
    if (currentState !== 'curious') { Companion.resetLook(); return; }

    var c = Companion.getCenter();
    var glances = [
      { x: c.x - 320, y: c.y },           // far left
      { x: c.x + 320, y: c.y },           // far right
      { x: c.x,       y: c.y - 240 },     // up — recalling / thinking
      { x: c.x - 200, y: c.y - 160 },     // upper-left
      { x: c.x + 200, y: c.y - 160 },     // upper-right
      { x: c.x - 160, y: c.y + 100 },     // lower-left
      { x: c.x + 160, y: c.y + 100 },     // lower-right
      { x: c.x,       y: c.y },           // center — direct stare
    ];
    var target = glances[Math.floor(Math.random() * glances.length)];
    Companion.lookAt(target.x, target.y);

    // Randomly vocalise on about 1-in-4 glances
    if (Math.random() < 0.25 && typeof Sounds !== 'undefined') {
      Sounds.play('curious_ooh');
    }

    // Vary hold time: quick flick (400-700ms) or lingering stare (900-1800ms)
    var holdMs = Math.random() < 0.4
      ? 400  + Math.random() * 300   // quick flick
      : 900  + Math.random() * 900;  // long stare

    _curiousLookTimer = setTimeout(function () {
      if (currentState !== 'curious') { Companion.resetLook(); return; }
      Companion.resetLook();
      // Brief pause between glances — snappy for flicks, longer after stares
      var pauseMs = holdMs < 700 ? 180 + Math.random() * 220 : 350 + Math.random() * 450;
      _curiousLookTimer = setTimeout(function () {
        _curiousLookLoop();
      }, pauseMs);
    }, holdMs);
  }

  /**
   * Schedule periodic soft vocalisations while in the curious state.
   * Plays 'curious_ooh' every 4–8 seconds — quiet punctuation of ongoing investigation.
   * Stops automatically when the state is no longer 'curious'.
   */
  function _scheduleCuriousChirps() {
    if (_curiousChirpTimer) { clearTimeout(_curiousChirpTimer); _curiousChirpTimer = null; }
    if (currentState !== 'curious') return;
    _curiousChirpTimer = setTimeout(function () {
      _curiousChirpTimer = null;
      if (currentState !== 'curious') return;
      if (typeof Sounds !== 'undefined') Sounds.play('curious_ooh');
      _scheduleCuriousChirps();
    }, 2500 + Math.random() * 2500);
  }

  /** Briefly flash a happy expression during idle. */
  function scheduleHappyFlash() {
    var delay = 3000 + Math.random() * 5000;
    setTimeout(function () {
      if (currentState !== 'idle') return;
      Emotion.setState('happy');
      setTimeout(function () {
        if (currentState === 'idle') Emotion.setState('idle');
      }, 700);
    }, delay);
  }

  /**
   * Schedule a brief happy flash while in the observe/focused state.
   * Fires once per observe entry with a 10-20s delay and focusLevel guard.
   * Rate-limited by _lastHappyFlashTime (min 18s between flashes).
   */
  function _scheduleObserveHappyFlash() {
    var delay = 10000 + Math.random() * 10000; // 10-20s into observe period
    setTimeout(function () {
      if (currentState !== 'observe') return;
      if (focusLevel < 55) return;
      const now = Date.now();
      if ((now - _lastHappyFlashTime) < 18000) return;
      _lastHappyFlashTime = now;
      Emotion.setState('happy');
      if (Math.random() < 0.35) {
        const msgs = ['✨', '~♪', '*happy wiggle*', 'hehe~', '(*^▽^*)', '♪'];
        showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2000);
      }
      setTimeout(function () {
        if (currentState === 'observe') Emotion.setState('focused');
      }, 900 + Math.random() * 400);
    }, delay);
  }

  function onMouseMove(e) {
    const now = Date.now();
    mouseX = e.clientX;
    mouseY = e.clientY;
    lastMouseMoveTime = now;

    // Startled: detect a sudden large jump in cursor position
    if (_prevMouseX >= 0) {
      const dx = e.clientX - _prevMouseX;
      const dy = e.clientY - _prevMouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= STARTLED_DIST_THRESHOLD && now > _startledUntil + 2500) {
        _startledUntil = now + STARTLED_HOLD_MS;
        // Whisper 50% of the time
        if (Math.random() < 0.5) {
          const msgs = ['!!', '*jumps*', 'w-what?!',
                        'AH!', '*startled floof*', 'you scared me!!',
                        '(*o*)!', 'don\'t do that!!'];
          showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2000);
        }
      }
    }
    _prevMouseX = e.clientX;
    _prevMouseY = e.clientY;
  }

  function onKeyDown(e) {
    lastKeyTime = Date.now();

    // Excited: rapid typing detection — track rolling keypress timestamps
    const now = Date.now();
    _keyPressTimes.push(now);
    // Keep only presses within the rolling window
    _keyPressTimes = _keyPressTimes.filter(t => now - t < KEYPRESS_WINDOW_MS);
    if (_keyPressTimes.length >= KEYPRESS_EXCITED_COUNT) {
      _excitedUntil = now + EXCITED_HOLD_MS;
    }

    // Rhythm measurement window — wider 3s array (2s measure + 1s debounce)
    _rhythmKeyTimes.push(now);
    _rhythmKeyTimes = _rhythmKeyTimes.filter(t => now - t < 3000);

    // Backspace/delete tracking for frustration detection
    if (e && (e.key === 'Backspace' || e.key === 'Delete')) {
      _backspaceTimes.push(now);
      _backspaceTimes = _backspaceTimes.filter(t => now - t < 3000);
    }

    // ── Rhythm classification (debounced 1s to avoid reacting to single keys) ──
    clearTimeout(_rhythmHoldTimer);
    _rhythmHoldTimer = setTimeout(() => {
      if (_dndActive) return;  // DND suppresses rhythm reactions

      // Reference the LAST keypress, not Date.now() — the debounce fires 1s after the
      // last key so using Date.now() shifts the 2s window forward by 1s, leaving only
      // ~1s of actual keys visible and effectively doubling every threshold.
      const n        = _rhythmKeyTimes.length > 0 ? _rhythmKeyTimes[_rhythmKeyTimes.length - 1] : Date.now();
      const keys2s   = _rhythmKeyTimes.filter(t => n - t < 2000).length;
      const del2s    = _backspaceTimes.filter(t => n - t < 2000).length;
      const keysPerSec  = keys2s / 2;
      const deleteRatio = del2s / Math.max(1, keys2s);

      // Frustration: >35% of recent keypresses are deletes/backspaces
      if (deleteRatio > 0.35 && keys2s >= 4) {
        _setTypingRhythm('frustrated');
      } else if (keysPerSec >= 3.0) {
        _setTypingRhythm('flow');
      } else if (keysPerSec >= 0.5) {
        _setTypingRhythm('thinking');
      }
      // Below 0.5 kps → let pause detection in rAF loop handle the transition to idle
    }, 1000);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ── TEAR DROP SPAWNER ─────────────────────────────────────────────────────
  function _spawnTear() {
    const eyes = document.querySelectorAll('.eye');
    eyes.forEach(eye => {
      // Skip occasionally for a natural uneven rhythm
      if (Math.random() > 0.78) return;
      _spawnTearDrop(eye);
    });
  }

  /** A single liquid teardrop that falls straight down from the given eye. */
  function _spawnTearDrop(eye) {
    const rect = eye.getBoundingClientRect();
    if (!rect.width) return;
    const el = document.createElement('div');
    el.className = 'tear-drop';
    // Position within the inner 50% of the eye width
    const startX = rect.left + rect.width * (0.28 + Math.random() * 0.44);
    const startY = rect.bottom - 2;
    el.style.left = startX + 'px';
    el.style.top  = startY + 'px';
    const fallDist = window.innerHeight - startY;
    el.style.setProperty('--tear-fall-dist', fallDist + 'px');
    const dur = (1.0 + Math.random() * 0.40).toFixed(2) + 's';
    el.style.setProperty('--tear-duration', dur);
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); _raiseTearPool(POOL_PER_TEAR_VH); },
               parseFloat(dur) * 1000 + 60);
  }

  /** Increment the tear pool by the given amount; update the overlay element. */
  function _raiseTearPool(increment) {
    _poolVh = Math.min(POOL_MAX_VH, _poolVh + increment);
    _applyPoolHeight();
  }

  /** Write the current _poolVh to the DOM element. */
  function _applyPoolHeight() {
    const el = document.getElementById('tear-overlay');
    if (el) el.style.height = _poolVh + 'vh';
  }

  function _startTears() {
    if (tearInterval) return;
    // Stop any in-progress drain
    if (_poolDrainInt) { clearInterval(_poolDrainInt); _poolDrainInt = null; }
    _spawnTear(); // immediate first drop
    tearInterval = setInterval(_spawnTear, 450 + Math.random() * 200);
  }

  function _stopTears() {
    if (tearInterval) { clearInterval(tearInterval); tearInterval = null; }
    // Gradually drain the pool
    if (_poolDrainInt) return;
    _poolDrainInt = setInterval(() => {
      if (_poolVh <= 0) {
        clearInterval(_poolDrainInt);
        _poolDrainInt = null;
        _poolVh = 0;
        _applyPoolHeight();
        return;
      }
      _poolVh = Math.max(0, _poolVh - POOL_DRAIN_RATE);
      _applyPoolHeight();
    }, POOL_DRAIN_TICK);
  }

  // ── OVERJOYED → SULKING → FORGIVEN sequence ───────────────────────────────
  // Adapted from Tamagotchi/WebPet return-from-neglect emotional arc:
  //   https://github.com/tugcecerit/Tamagotchi-Game
  //   https://github.com/RobThePCGuy/WebPet
  //
  // Arc: return → relief (overjoyed 5s) → lingering upset (sulking) → forgiven
  // "Reluctant forgiveness" — requires sustained focused attention to resolve
  function _triggerOverjoyed() {
    if (overjoyedTimer)    clearTimeout(overjoyedTimer);
    if (sulkCheckInterval) clearInterval(sulkCheckInterval);

    currentState = 'idle';
    _stopTears();
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: window._lastEmotion, to: 'overjoyed' };
    window._lastEmotion    = 'overjoyed';

    // After 5s of joy → lingering upset (sulking)
    overjoyedTimer = setTimeout(() => {
      overjoyedTimer = null;
      if (window.perception?.facePresent) {
        Emotion.setState('sulking');
        window._emotionChanged = { from: 'overjoyed', to: 'sulking' };
        window._lastEmotion    = 'sulking';
        _startSulkResolution();
      } else {
        enterState('idle');
      }
    }, 5000);
  }

  function _startSulkResolution() {
    if (sulkCheckInterval) clearInterval(sulkCheckInterval);
    let focusedMs = 0;

    // User must stay focused for 10 continuous seconds — "earning" forgiveness
    sulkCheckInterval = setInterval(() => {
      const p = window.perception;
      if (!p) return;
      if (p.userState === 'Focused') {
        focusedMs += 500;
        if (focusedMs >= 10000) {
          clearInterval(sulkCheckInterval); sulkCheckInterval = null;
          window._emotionChanged = { from: 'sulking', to: 'forgiven' };
          window._lastEmotion    = null;
          enterState('observe');
        }
      } else {
        focusedMs = Math.max(0, focusedMs - 250);
      }
    }, 500);
  }

  // ── FOCUS TIMER ───────────────────────────────────────────────────────────
  // Color palette for focus timer states (matches timer.js session-timer colors)
  const _focusTimerColors = {
    FOCUSED:    { color: 'rgba(200,220,255,0.72)', glow: 'rgba(160,190,255,0.25)', opacity: '0.60' },
    DRIFTING:   { color: 'rgba(255,200, 80,0.82)', glow: 'rgba(255,180, 40,0.30)', opacity: '0.75' },
    DISTRACTED: { color: 'rgba(255, 90, 90,0.88)', glow: 'rgba(255, 60, 60,0.35)', opacity: '0.85' },
    CRITICAL:   { color: 'rgba(255, 60, 60,0.95)', glow: 'rgba(255, 30, 30,0.45)', opacity: '0.95' },
    FAILED:     { color: 'rgba(140,140,160,0.50)', glow: 'transparent',             opacity: '0.35' },
  };
  let _lastFocusTimerState = null;
  let _ftParticleInt = null;

  /** Spawn one tiny particle near the focus timer element. */
  function _spawnFocusParticle() {
    const el = document.getElementById('focus-timer');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const p = document.createElement('div');
    p.className = 'focus-particle';
    // Position near the timer text — slight random spread
    const px = rect.left + Math.random() * rect.width;
    const py = rect.top  + rect.height * 0.5 + (Math.random() - 0.5) * 8;
    p.style.left = px + 'px';
    p.style.top  = py + 'px';
    // Color matches current timer state
    const timerState = (typeof Timer !== 'undefined' && Timer.getState?.()) || 'FOCUSED';
    const rgb = palette[timerState] || '160,190,255';
    p.style.background = `rgba(${rgb},0.85)`;
    p.style.boxShadow  = `0 0 4px rgba(${rgb},0.55)`;
    const dur = (1.0 + Math.random() * 1.2).toFixed(2);
    p.style.setProperty('--fp-dur', dur + 's');
    p.style.setProperty('--fp-dx', ((Math.random() - 0.5) * 28) + 'px');
    p.style.setProperty('--fp-dy', -(10 + Math.random() * 18) + 'px');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), parseFloat(dur) * 1000 + 50);
  }

  function _startFocusTimer() {
    if (_timerInt) return;
    // Start focus-timer particle emitter
    _ftParticleInt = setInterval(_spawnFocusParticle, 1400 + Math.random() * 600);

    _timerInt = setInterval(() => {
      const state = window.perception?.userState || 'NoFace';

      if (state === 'Focused') {
        _focusSecs++;
        _nofaceSecs = 0;
      } else if (state === 'NoFace') {
        _nofaceSecs++;
        if (_nofaceSecs >= 60) { _focusSecs = 0; _nofaceSecs = 0; }
      } else {
        _nofaceSecs = 0;
        // Timer pauses but does not reset for LookingAway/Sleepy
      }

      // Update focus timer display
      const timerEl = document.getElementById('focus-timer');
      if (timerEl) {
        const h = Math.floor(_focusSecs / 3600);
        const m = Math.floor((_focusSecs % 3600) / 60);
        const s = _focusSecs % 60;
        const timeStr = h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        timerEl.textContent = `focus ${timeStr}`;

        // Update color to reflect session timer state
        const timerState = (typeof Timer !== 'undefined' && Timer.getState?.()) || 'FOCUSED';
        if (timerState !== _lastFocusTimerState) {
          _lastFocusTimerState = timerState;
          const c = _focusTimerColors[timerState] || _focusTimerColors.FOCUSED;
          timerEl.style.color      = c.color;
          timerEl.style.opacity    = c.opacity;
          timerEl.style.textShadow = `0 0 10px ${c.glow}`;
          // Refresh particle interval speed — faster when distressed
          if (_ftParticleInt) { clearInterval(_ftParticleInt); _ftParticleInt = null; }
          const ptRate = timerState === 'FOCUSED' ? 1400 : timerState === 'DRIFTING' ? 900 : 550;
          _ftParticleInt = setInterval(_spawnFocusParticle, ptRate + Math.random() * 300);
        }
      }

      // Update attention bar from perception
      const fillEl = document.getElementById('attention-fill');
      if (fillEl && window.perception) {
        fillEl.style.width = window.perception.attentionScore + '%';
      }

      // ── Phone detection ─────────────────────────────────────────────────
      // Trigger: head bowed above readingPitchMax (sensitivity-dependent) for
      // phoneDetectMs (also sensitivity-dependent).  Using readingPitchMax as
      // the phone threshold ensures students reading books at GENTLE/NORMAL
      // sensitivity are NOT flagged as phone-users until they bow far beyond
      // the expected reading angle.
      // We intentionally do NOT check correctedGazeY here — it is head-pose
      // compensated and actively removes the downward-gaze signal we need.
      if (_phoneDetectionEnabled && window.cameraAvailable) {
        const p = window.perception;
        const phoneThr = SENSITIVITY_PRESETS[_runtimeSensitivity || _sensitivityLevel]
                      || SENSITIVITY_PRESETS['NORMAL'];
        if (p?.facePresent && p.headPitch > phoneThr.readingPitchMax) {
          _phoneCheckMs += 1000;
          if (_phoneCheckMs >= phoneThr.phoneDetectMs && window._lastEmotion !== 'suspicious') {
            // Jump straight to suspicious — skip DRIFTING arc
            window._emotionChanged = { from: window._lastEmotion, to: 'suspicious' };
            window._lastEmotion    = 'suspicious';
            Emotion.setState('suspicious');
            showWhisper('...📱?', 2500);
            // Sound played by sounds.js _pollEmotion() via _playForTransition — no direct call here
            _phoneCallbacks.forEach(fn => { try { fn(); } catch (e) {} });
          }
        } else if (!p || !p.facePresent || p.headPitch < PHONE_PITCH_RESET) {
          // Reset when face absent or head has lifted back up
          _phoneCheckMs = 0;
        }
      }

      // ── Milestone tracking ──────────────────────────────────────────────
      // Only count when a session is actively running in FOCUSED timer state
      const timerState   = typeof Timer   !== 'undefined' ? Timer.getState?.()                      : undefined;
      const sessionState = typeof Session !== 'undefined' ? Session.getCurrentStats?.()?.state : undefined;
      if (timerState === 'FOCUSED' && sessionState === 'ACTIVE') {
        _continuousFocusedMs += 1000;
        const minutesMark = Math.floor(_continuousFocusedMs / 60000);
        if (minutesMark >= _nextMilestoneMinutes && _nextMilestoneMinutes <= MILESTONE_MAX_MINUTES) {
          const reached = _nextMilestoneMinutes;
          _nextMilestoneMinutes += MILESTONE_INTERVAL_MINUTES;
          _fireMilestone(reached);
        }
      } else if (timerState && timerState !== 'FOCUSED') {
        // Any non-FOCUSED timer state resets the streak
        _continuousFocusedMs  = 0;
        _nextMilestoneMinutes = MILESTONE_INTERVAL_MINUTES;
      }

    }, 1000);
  }

  // ── CHUNK 5 — new helper functions ────────────────────────────────────────

  /** Fire the milestone callback and companion celebration. */
  function _fireMilestone(minutesMark) {
    // Base whispers for all periods
    const baseWhispers = {
      5:  '5 min streak! ✦',
      10: '10 minutes! 🔥',
      15: 'you\'re on fire! ✧',
      20: '20 min!! incredible',
      25: '( ˘▽˘)🎉 almost there!',
      30: '30 whole minutes!! 🌟',
      35: 'legendary focus ✦✦',
      40: '40 min! unstoppable!',
      45: 'nearly an hour!! 🔥🔥',
      50: 'wow... just wow. ✧',
      55: 'you\'re amazing. keep it up!',
      60: '1 HOUR!! 🎉🎉🎉',
    };

    // Period-specific early-milestone overrides (only first few milestones)
    const morningWhispers = ['good morning grind! ✦', 'morning focus ✦', 'early bird ✧', 'dawn warrior! ☀️'];
    const eveningWhispers = ['evening flow ✦', 'night owl mode ✧', 'calm focus... ✦', 'quiet grind ✧'];
    const nightWhispers   = ['...still going. ✦', 'night owl ✧', '...quiet strength ✦', 'the night is yours ✧'];

    let whisper;
    const earlyMark = minutesMark <= 20; // use period flavour for first few milestones
    if (earlyMark && _currentTimePeriod === 'MORNING') {
      whisper = morningWhispers[Math.floor(minutesMark / 5) - 1] || baseWhispers[minutesMark];
    } else if (earlyMark && _currentTimePeriod === 'EVENING') {
      whisper = eveningWhispers[Math.floor(minutesMark / 5) - 1] || baseWhispers[minutesMark];
    } else if (earlyMark && _currentTimePeriod === 'NIGHT') {
      whisper = nightWhispers[Math.floor(minutesMark / 5) - 1] || baseWhispers[minutesMark];
    } else {
      whisper = baseWhispers[minutesMark] || `${minutesMark} min! ✦`;
    }
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: window._lastEmotion, to: 'overjoyed' };
    window._lastEmotion    = 'overjoyed';
    // Sound played by sounds.js _pollEmotion() via _playForTransition — no direct call here
    showWhisper(whisper, 3000);
    _milestoneCallbacks.forEach(fn => { try { fn(minutesMark); } catch (e) {} });
    // Return to focused after 1.5s
    setTimeout(() => {
      if (window._lastEmotion === 'overjoyed') {
        window._lastEmotion = null;
        enterState('observe');
      }
    }, 1500);
  }

  /** True if study encouragement conditions are all met. */
  function _isEncouragementEligible() {
    if (typeof Timer === 'undefined' || !Timer.getState || Timer.getState() !== 'FOCUSED') return false;
    if (focusLevel < ENCOURAGEMENT_FOCUS_MIN) return false;
    if ((Date.now() - _lastEncouragementTime) < ENCOURAGEMENT_GAP_MS) return false;
    const distress = ['scared', 'crying', 'sad', 'overjoyed', 'sulking', 'startled'];
    if (distress.includes(window._lastEmotion)) return false;
    return true;
  }

  /** Deliver a study encouragement moment. */
  function _doStudyEncouragement() {
    _lastEncouragementTime = Date.now();

    // Period-specific encouragement pools
    const baseMsgs = [
      '✦ keep going!', 'you\'re doing great', '( ˘▽˘)/', '✧ focus ✧', '...good.',
      'i believe in you~', 'stay strong!', '*cheers for you*', 'almost there!',
      'you\'ve got this ♡', '...i\'m rooting for you.', 'don\'t stop now!',
    ];
    const morningMsgs = [
      '☀️ morning momentum!', 'you started strong — keep it!',
      'early bird energy ✦', 'morning focus is peak focus ✧',
    ];
    const eveningMsgs = [
      'evening grind ✦', 'winding down but not giving up ✧',
      'the day\'s almost done — finish strong!', 'calm, steady focus ♡',
    ];
    const nightMsgs = [
      '...quiet focus. i\'m proud of you.', 'late-night warrior ✦',
      '...you didn\'t give up. ♡', '*sits quietly beside you*',
      '...still here with you.', 'the night belongs to the dedicated ✧',
    ];

    let pool = baseMsgs;
    if (_currentTimePeriod === 'MORNING') pool = [...morningMsgs, ...baseMsgs];
    else if (_currentTimePeriod === 'EVENING') pool = [...eveningMsgs, ...baseMsgs];
    else if (_currentTimePeriod === 'NIGHT') pool = [...nightMsgs, ...baseMsgs];

    showWhisper(pool[Math.floor(Math.random() * pool.length)], 3500);
    const c = Companion.getCenter();
    Companion.lookAt(c.x, c.y);
    if (typeof Sounds !== 'undefined') Sounds.play('happy_coo');
    setTimeout(() => Companion.resetLook(), 2000);
  }

  /**
   * Welcome-back sequence — replaces _triggerOverjoyed call sites.
   * Plays when face returns after companion was in scared|sad|crying.
   * t=0ms:    overjoyed + green particles + overjoyed_chirp
   * t=2000ms: happy + happy_coo
   * t=4000ms: resume normal behaviour cycle
   * Guard: cancels if face disappears during the sequence.
   */
  function _welcomeBackSequence() {
    if (_absenceHandled) return;   // guard against double-fire
    _absenceHandled = true;

    // Cancel any previous welcome-back arc
    if (_welcomeBackSeqId1) { clearTimeout(_welcomeBackSeqId1); _welcomeBackSeqId1 = null; }
    if (_welcomeBackSeqId2) { clearTimeout(_welcomeBackSeqId2); _welcomeBackSeqId2 = null; }
    if (overjoyedTimer)     { clearTimeout(overjoyedTimer);     overjoyedTimer     = null; }
    if (sulkCheckInterval)  { clearInterval(sulkCheckInterval); sulkCheckInterval  = null; }

    currentState = 'idle';
    _stopTears();

    // Calculate how long the user was absent
    const absenceMs = _lastFacePresenceMs > 0 ? Date.now() - _lastFacePresenceMs : 0;

    // Subdue the return when a session just failed because of this absence
    const sessionState = (typeof Session !== 'undefined') ? Session.getCurrentStats?.()?.state : null;
    const sessionJustFailed = sessionState === 'FAILED' || sessionState === 'ABANDONED';
    if (sessionJustFailed && absenceMs > 30000) {
      _returnQuiet();
      return;
    }

    // Branch on absence duration
    if      (absenceMs < 30000)    _returnBrief();
    else if (absenceMs < 300000)   _returnShort();
    else if (absenceMs < 3600000)  _returnMedium(absenceMs);
    else if (absenceMs < 21600000) _returnLong(absenceMs);
    else                           _returnVeryLong(absenceMs);
  }

  // ── Under 30 seconds — just look happy, no fuss ──────────────────────────
  function _returnBrief() {
    Emotion.setState('happy');
    window._emotionChanged = { from: window._lastEmotion, to: 'happy' };
    window._lastEmotion    = 'happy';
    _welcomeBackSeqId1 = setTimeout(() => {
      _welcomeBackSeqId1 = null;
      if (!window.perception?.facePresent) { enterState('idle'); return; }
      window._lastEmotion = null;
      enterState('observe');
    }, 1500);
  }

  // ── 30 seconds to 5 minutes — original overjoyed→happy arc ──────────────
  function _returnShort() {
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: window._lastEmotion, to: 'overjoyed' };
    window._lastEmotion    = 'overjoyed';

    _welcomeBackSeqId1 = setTimeout(() => {
      _welcomeBackSeqId1 = null;
      if (!window.perception?.facePresent) { enterState('idle'); return; }
      Emotion.setState('happy');
      window._emotionChanged = { from: 'overjoyed', to: 'happy' };
      window._lastEmotion    = 'happy';
      _welcomeBackSeqId2 = setTimeout(() => {
        _welcomeBackSeqId2 = null;
        if (!window.perception?.facePresent) { enterState('idle'); return; }
        window._lastEmotion = null;
        enterState('observe');
      }, 2000);
    }, 2000);
  }

  // ── 5 minutes to 1 hour — overjoyed + "where did you go?" whisper ────────
  function _returnMedium(absenceMs) {
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: window._lastEmotion, to: 'overjoyed' };
    window._lastEmotion    = 'overjoyed';

    const mins = Math.round(absenceMs / 60000);
    const pool = [
      `you were gone ${mins} min ♡`,
      '*was waiting* ~',
      'oh! there you are ✦',
      '*perks up* you\'re back!',
      '...you came back ♡',
    ];
    setTimeout(() => showWhisper(pool[Math.floor(Math.random() * pool.length)], 5000), 400);

    _welcomeBackSeqId1 = setTimeout(() => {
      _welcomeBackSeqId1 = null;
      if (!window.perception?.facePresent) { enterState('idle'); return; }
      Emotion.setState('happy');
      window._emotionChanged = { from: 'overjoyed', to: 'happy' };
      window._lastEmotion    = 'happy';
      _welcomeBackSeqId2 = setTimeout(() => {
        _welcomeBackSeqId2 = null;
        if (!window.perception?.facePresent) { enterState('idle'); return; }
        window._lastEmotion = null;
        enterState('observe');
      }, 2000);
    }, 2500);
  }

  // ── 1 to 6 hours — overjoyed + time-of-day aware message + longer arc ────
  function _returnLong(absenceMs) {
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: window._lastEmotion, to: 'overjoyed' };
    window._lastEmotion    = 'overjoyed';

    const hrs    = Math.round(absenceMs / 3600000 * 10) / 10;
    const period = (typeof getTimePeriod === 'function') ? getTimePeriod() : 'AFTERNOON';
    const MSGS = {
      MORNING:   [`good morning! ☀️ ${hrs}h later~`, '*stretches* morning! ready?'],
      AFTERNOON: [`${hrs}h later! welcome back ✦`,   '*was wondering* you\'re back!'],
      EVENING:   [`evening~ ${hrs}h without you ♡`,  '*cozy* you came back ✦'],
      NIGHT:     ['...you came back. it\'s late ♡',  '*quietly* welcome back~'],
    };
    const pool = MSGS[period] || MSGS['AFTERNOON'];
    setTimeout(() => showWhisper(pool[Math.floor(Math.random() * pool.length)], 6000), 500);

    if (typeof Sounds !== 'undefined') Sounds.play('welcomeBack');

    _welcomeBackSeqId1 = setTimeout(() => {
      _welcomeBackSeqId1 = null;
      if (!window.perception?.facePresent) { enterState('idle'); return; }
      Emotion.setState('happy');
      window._emotionChanged = { from: 'overjoyed', to: 'happy' };
      window._lastEmotion    = 'happy';
      _welcomeBackSeqId2 = setTimeout(() => {
        _welcomeBackSeqId2 = null;
        if (!window.perception?.facePresent) { enterState('idle'); return; }
        if (period === 'MORNING') { doMorningGreeting(); return; }
        window._lastEmotion = null;
        enterState('observe');
      }, 3000);
    }, 3000);
  }

  // ── Over 6 hours — quiet warmth, not big fanfare ─────────────────────────
  function _returnVeryLong(absenceMs) {  // eslint-disable-line no-unused-vars
    void absenceMs;  // absenceMs available for future locale-formatted display
    Emotion.setState('happy');
    window._emotionChanged = { from: window._lastEmotion, to: 'happy' };
    window._lastEmotion    = 'happy';

    const period = (typeof getTimePeriod === 'function') ? getTimePeriod() : 'AFTERNOON';
    const MSGS = {
      MORNING:   ['good morning ✦', 'new day. let\'s go ✦', '...morning ☀️'],
      AFTERNOON: ['*looks up* you\'re here ♡',  '...hi again ✦'],
      EVENING:   ['...you came back ♡',          '*quietly pleased*'],
      NIGHT:     ['...still here ♡',              'it\'s late. welcome back~'],
    };
    const pool = MSGS[period] || MSGS['AFTERNOON'];
    setTimeout(() => showWhisper(pool[Math.floor(Math.random() * pool.length)], 6000), 800);

    if (typeof Sounds !== 'undefined') Sounds.play('happy_coo');

    _welcomeBackSeqId1 = setTimeout(() => {
      _welcomeBackSeqId1 = null;
      if (!window.perception?.facePresent) { enterState('idle'); return; }
      window._lastEmotion = null;
      if (period === 'MORNING') { doMorningGreeting(); return; }
      enterState('observe');
    }, 3500);
  }

  // ── Quiet return — used when session failed during absence ───────────────
  function _returnQuiet() {
    Emotion.setState('idle');
    window._lastEmotion = null;
    _welcomeBackSeqId1  = setTimeout(() => { _welcomeBackSeqId1 = null; enterState('idle'); }, 500);
  }

  // ── WHISPER TEXT ──────────────────────────────────────────────────────────
  function showWhisper(text, durationMs) {
    if (_dndActive) return;
    _whisperQueue.push({ text, durationMs: durationMs || 5000 });
    if (!_whisperBusy) _nextWhisper();
  }

  function _nextWhisper() {
    if (_whisperQueue.length === 0) { _whisperBusy = false; return; }
    _whisperBusy = true;
    const { text, durationMs } = _whisperQueue.shift();
    const el = document.getElementById('whisper-text');
    if (!el) { _nextWhisper(); return; }
    // Snap in quickly (0.2 s) so message is readable immediately,
    // then fade out smoothly (0.6 s) so exit feels gentle.
    el.textContent          = text;
    el.style.transition     = 'opacity 0.2s ease';
    el.style.opacity        = '0.72';
    setTimeout(() => {
      el.style.transition   = 'opacity 0.6s ease';
      el.style.opacity      = '0';
      setTimeout(_nextWhisper, 700);  // 700 > 600 so fade fully completes
    }, durationMs);
  }

  // ── CLICK-TO-PET & LONG-PRESS SNUGGLE INTERACTIONS ───────────────────────
  // Single click near companion → love.
  // 3+ quick clicks within 1.5 s → burst love overload.
  // Hold mousedown ≥ 800 ms near companion → cozy snuggle.
  function _onScreenClick(e) {
    const c    = Companion.getCenter();
    const dx   = e.clientX - c.x;
    const dy   = e.clientY - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= PET_RADIUS) return;

    const now = Date.now();

    // Track rapid pet clicks
    _petClickTimes.push(now);
    _petClickTimes = _petClickTimes.filter(t => now - t < PET_BURST_WINDOW_MS);

    if (_petClickTimes.length >= PET_BURST_COUNT) {
      // Rapid-tap burst — super hyper love overload
      _petClickTimes = [];
      _loveUntil     = now + LOVE_HOLD_MS + 2000;
      const burstMsgs = [
        'hehehehe~!!', '!!♡♡♡', '*wags tail rapidly*',
        'stop stop stop im melting~', '(≧◡≦)',
        'TOO MUCH LOVE!!', 'aaaaa~♡', '*happy overload*',
        '(♡▿♡)!!!', '*vibrating with joy*', 'nooo i\'m gonna explode~♡',
        '*spins uncontrollably*', 'you\'re so sweet!!',
      ];
      showWhisper(burstMsgs[Math.floor(Math.random() * burstMsgs.length)], 3500);
      const el = Companion.getElement();
      if (el) {
        el.classList.add('shiver');
        setTimeout(() => el.classList.remove('shiver'), 450);
      }
      if (typeof Particles !== 'undefined') Particles.burst('happy', 10);
      return;
    }

    // Normal single pet
    _loveUntil = now + LOVE_HOLD_MS;
    const msgs = [
      '♡', '*purrs*', '*nuzzles you*', '...♡', 'hehe~♡',
      'i like you~', '*rubs head on you*', 'stay forever.',
      '♡♡♡', '*happy purr*', 'teehee~♡', '...warm~',
      '*leans into you*', 'don\'t stop~', 'you\'re warm ♡',
      '*slow blink* ...♡', 'mhmmm~', '♡ yes please ♡',
      '*happy sigh*', 'more more more~', 'besties forever ♡',
      '...i feel safe.', '*buries face in you*',
    ];
    if (Math.random() < Math.min(0.97, 0.82 * _expressMult)) {
      showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 3200);
    }
  }

  function _onMouseDown(e) {
    const c    = Companion.getCenter();
    const dx   = e.clientX - c.x;
    const dy   = e.clientY - c.y;
    if (Math.sqrt(dx * dx + dy * dy) < PET_RADIUS) {
      _mousedownNear = true;
      _mousedownTime = Date.now();
    }
  }

  function _onMouseUp(e) {
    if (!_mousedownNear) return;
    const held = Date.now() - _mousedownTime;
    _mousedownNear = false;
    if (held >= LONG_PRESS_MS) {
      // Long press — trigger cozy snuggle state
      _cozyUntil = Date.now() + COZY_HOLD_MS;
      const cozyMsgs = [
        '...♡ cozy', '*nuzzles closer*', 'don\'t let go~',
        'safe here...', '...warm and soft', 'mmh~♡',
        '*contented purr*', 'staying here forever~',
        '*eyes slowly closing*', 'like this~', 'you\'re my favourite~',
        '...home ♡', '*melts*', 'this is everything.',
      ];
      showWhisper(cozyMsgs[Math.floor(Math.random() * cozyMsgs.length)], 4500);
      // Brief nuzzle lean + rose-gold particle burst to signal the snuggle
      const el = Companion.getElement();
      if (el) { el.classList.add('nuzzling'); setTimeout(() => el.classList.remove('nuzzling'), 900); }
      if (typeof Particles !== 'undefined') Particles.burst('cozy', 7);
      // Slow double-blink (the "cat I love you" blink)
      setTimeout(_doSlowBlink, 600);
    }
  }

  // ── IDLE LIFE — spontaneous pet-like behaviors ─────────────────────────────
  // Fires a random behavior every IDLE_LIFE_MIN_WAIT…MAX_WAIT ms so the
  // companion never feels like a static program waiting for input.

  function _startIdleLife() {
    const schedule = () => {
      // Apply idleSpeed multiplier: speed=1→slow (÷0.6), speed=3→fast (÷1.6)
      const speedDiv = 0.6 + (_idleSpeedMult - 1) * 0.5;
      const minWait  = Math.round(IDLE_LIFE_MIN_WAIT  / Math.max(0.4, speedDiv));
      const maxWait  = Math.round(IDLE_LIFE_MAX_WAIT  / Math.max(0.4, speedDiv));
      const wait = minWait + Math.random() * (maxWait - minWait);
      _idleLifeTimer = setTimeout(() => {
        _spontaneousBehavior();
        schedule();
      }, wait);
    };
    schedule();
  }

  function _spontaneousBehavior() {
    if (_dndActive) return;
    // Don't interrupt timed or distress states
    const blocked = ['overjoyed', 'sulking', 'scared', 'crying', 'sad', 'love', 'startled', 'excited', 'shy'];
    if (blocked.includes(window._lastEmotion)) return;
    if (overjoyedTimer || sulkCheckInterval) return;

    // Study encouragement — 8% chance when eligible, pre-empts the main pool
    if (_isEncouragementEligible() && Math.random() < 0.08) {
      _doStudyEncouragement();
      return;
    }

    // Weighted random selection (sum = 100)
    const r = Math.random() * 100;
    if      (r < 17) _doIdleLook();        // look around (17%)
    else if (r < 29) _doDoubleBlink();     // quick double blink (12%)
    else if (r < 40) _doHeadTilt();        // cute head tilt (11%)
    else if (r < 48) _doStretch();         // yawn + stretch (8%)
    else if (r < 59) _doWhisperCoo();      // murmur something (11%)
    else if (r < 67) _doWink();            // cheeky wink (8%)
    else if (r < 73) _doPeek();            // look far away, snap back (6%)
    else if (r < 80) _doHappyFlash();      // brief joyful expression (7%)
    else if (r < 85) _doShiver();          // tiny excited shiver (5%)
    else if (r < 88) _doTripleBlink();     // three rapid blinks (3%)
    else if (r < 91) _doNuzzle();          // lean toward screen (3%)
    else if (r < 94) _doDaydream();        // look up dreamily (3%)
    else if (r < 97) _doSpinOnce();        // gleeful tiny spin (3%)
    else             _doSlowBlink();       // cat slow-blink — "I love you" (3%)
  }

  /** Look in a random direction then drift back */
  function _doIdleLook() {
    const c = Companion.getCenter();
    const dirs = [
      { x: c.x - 320, y: c.y + 50  },
      { x: c.x + 320, y: c.y - 30  },
      { x: c.x - 200, y: c.y - 180 },
      { x: c.x + 180, y: c.y + 120 },
      { x: c.x,       y: c.y - 250 },
    ];
    const t = dirs[Math.floor(Math.random() * dirs.length)];
    Companion.lookAt(t.x, t.y);
    setTimeout(() => Companion.resetLook(), 1100 + Math.random() * 900);
  }

  /** Two rapid blinks in a row */
  function _doDoubleBlink() {
    const el = Companion.getElement();
    if (!el) return;
    el.classList.add('blink');
    setTimeout(() => {
      el.classList.remove('blink');
      setTimeout(() => {
        el.classList.add('blink');
        setTimeout(() => el.classList.remove('blink'), 130);
      }, 190);
    }, 130);
  }

  /** Tilt head to one side for a moment */
  function _doHeadTilt() {
    const deg = (10 + Math.random() * 4) * (Math.random() > 0.5 ? 1 : -1);
    Companion.setRotation(deg);
    setTimeout(() => Companion.setRotation(0), 1600 + Math.random() * 800);
  }

  /** Add stretching class for the stretch animation */
  function _doStretch() {
    const el = Companion.getElement();
    if (!el) return;
    el.classList.add('stretching');
    showWhisper('*stretches*', 2200);
    if (typeof Sounds !== 'undefined') Sounds.play('stretch_coo');
    setTimeout(() => el.classList.remove('stretching'), 1500);
  }

  /** Murmur a random ambient coo */
  function _doWhisperCoo() {
    const coos = [
      '*tilts head* ...?', '...', '*glances around*', '~ ♪',
      '*blinks softly*', 'hmm...', '...✦', '*yawns quietly*',
      '*listens*', '...✧', '(◕‿◕)', '( ˘ω˘ )',
      '... ♡', '*wiggles*', '*sniffs air*', '(⁀‿⁀)',
      '✨', '*ponders*', 'oh.', '*contentedly blinks*',
      '‧₊˚ ✩', '( •ᴗ• )', '*little squeak*', '꒰ ˶• ༝ •˶ ꒱',
      '...still here ♡', '*peeks at you*', 'don\'t mind me~',
      '...you okay?', '*quiet hum*', '( •̀ ω •́ )✧',
      '*sits nearby*', '...i\'m here.', '~', '*cozy*',
      // Livelier additions
      '*perks up*', 'ooh~', 'hm!', '*tail swish*',
      '*nudges you*', 'focus~ ✦', 'you\'ve got this.', '...✦ nice.',
      '*happy sigh*', '( ´ ▽ ` )', '*spins once*', 'wheee~',
      '...watching~', '*curious chirp*', '꒰⑅•ᴗ•⑅꒱', '*leans in*',
      '...so interesting.', '*bright eyes*', 'hi hi~', '*paw tap*',
      '(๑˃ᴗ˂)ﻭ', '*wags tail*', '!', '...ooh.',
    ];
    showWhisper(coos[Math.floor(Math.random() * coos.length)], 3500);
  }

  /** Tiny body shiver — brief excited wobble */
  function _doShiver() {
    const el = Companion.getElement();
    if (!el) return;
    el.classList.add('shiver');
    setTimeout(() => el.classList.remove('shiver'), 420);
  }

  /** Close one eye briefly — cheeky wink */
  function _doWink() {
    const el = Companion.getElement();
    if (!el) return;
    const cls = Math.random() < 0.5 ? 'wink-left' : 'wink-right';
    el.classList.add(cls);
    if (typeof Sounds !== 'undefined') Sounds.play('wink_blip');
    setTimeout(() => el.classList.remove(cls), 340);
  }

  /** Look far to the side, snap back — curious peek */
  function _doPeek() {
    const c = Companion.getCenter();
    const side = Math.random() < 0.5 ? -1 : 1;
    Companion.lookAt(c.x + side * 500, c.y + 60);
    setTimeout(() => {
      Companion.resetLook();
    }, 700 + Math.random() * 400);
  }

  /**
   * Brief happy expression flash — companion lights up with joy for ~1s.
   * Rate-limited by _lastHappyFlashTime so it doesn't spam.
   */
  function _doHappyFlash() {
    const now = Date.now();
    if ((now - _lastHappyFlashTime) < 12000) { _doWhisperCoo(); return; }
    const _blocked = ['overjoyed', 'sulking', 'scared', 'crying', 'sad', 'love', 'startled', 'excited', 'shy'];
    if (_blocked.includes(window._lastEmotion)) return;
    _lastHappyFlashTime = now;
    const prev = window._lastEmotion || 'focused';
    Emotion.setState('happy');
    if (Math.random() < 0.5) {
      const msgs = ['✨', 'hehe~', '~♪', '*happy wiggle*', '(*^▽^*)',
                    '♡', '✦', ':)', '*bounces*', 'yay~'];
      showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2200);
    }
    setTimeout(() => {
      // Restore previous emotion if nothing else has taken over
      if (window._lastEmotion === 'happy') Emotion.setState(prev === 'happy' ? 'focused' : prev);
    }, 900 + Math.random() * 400);
  }

  /**
   * Three rapid blinks in a row — more expressive than double blink.
   */
  function _doTripleBlink() {
    const el = Companion.getElement();
    if (!el) return;
    let count = 0;
    const doBlink = () => {
      if (count >= 3) return;
      count++;
      el.classList.add('blink');
      setTimeout(() => {
        el.classList.remove('blink');
        if (count < 3) setTimeout(doBlink, 150 + Math.random() * 60);
      }, 110 + Math.random() * 40);
    };
    doBlink();
  }

  /** Lean toward the screen — a nuzzle/snuggle gesture */
  function _doNuzzle() {
    const el = Companion.getElement();
    if (!el) return;
    el.classList.add('nuzzling');
    const msgs = ['*nuzzles screen*', '...hi ♡', '*leans in*', '(◡‿◡)', '*presses closer*', '...cozy here', '*rubs against screen*', '♡', '...warm here'];
    if (Math.random() < 0.65) showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2800);
    setTimeout(() => {
      el.classList.remove('nuzzling');
      // After nuzzle, do a slow content blink
      setTimeout(_doDoubleBlink, 200);
    }, 900);
  }

  /** Look up dreamily for a moment, soft wistful sigh */
  function _doDaydream() {
    const c = Companion.getCenter();
    // Look up and slightly to a random side
    Companion.lookAt(c.x + (Math.random() - 0.5) * 100, c.y - 320);
    const msgs = [
      '...✦', '...☁', '...♡', '*daydreams*', 'la la la~',
      '...hm~', '...✧', '*wanders off mentally*', '...i wonder...',
      '...someday~', '*stares into space*', '...if only~',
    ];
    showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 3600);
    // Hold the dreamy gaze for 2.5–3.5s then slowly return
    setTimeout(() => {
      Companion.resetLook();
      // A soft blink when coming back from the daydream
      setTimeout(_doDoubleBlink, 300);
    }, 2500 + Math.random() * 1000);
  }

  /** Brief gleeful spin — shows joy without restraint */
  function _doSpinOnce() {
    const el = Companion.getElement();
    if (!el) return;
    const _blocked = ['overjoyed', 'sulking', 'scared', 'crying', 'sad'];
    if (_blocked.includes(window._lastEmotion)) return;
    el.classList.add('spinning');
    const msgs = ['wheee~', '*spins*', 'whirl~', '꩜ ~', '*dizzy~*', 'yay~!', '*goes round*'];
    if (Math.random() < 0.65) showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2000);
    setTimeout(() => {
      el.classList.remove('spinning');
      // Flash happy right after the spin
      setTimeout(_doHappyFlash, 100);
    }, 660);
  }

  /** Enable or disable phone-detection posture heuristic. */
  function setPhoneDetectionEnabled(bool) {
    _phoneDetectionEnabled = !!bool;
    localStorage.setItem('deskbuddy_phone_detect', _phoneDetectionEnabled ? 'true' : 'false');
  }

  /** Register a callback fired when phone-checking posture is sustained. */
  function onPhoneDetected(fn) {
    _phoneCallbacks.push(fn);
  }

  /** Register a callback fired on each 5-minute focused milestone. fn(minutesMark). */
  function onMilestone(fn) {
    _milestoneCallbacks.push(fn);
  }

  /**
   * Set the sensitivity level that timer.js uses for focus-level thresholds.
   * level: 'GENTLE' | 'NORMAL' | 'STRICT'
   */
  function setSensitivity(level) {
    if (!SENSITIVITY_PRESETS[level]) return;
    _sensitivityLevel = level;
    localStorage.setItem('deskbuddy_sensitivity', level);
  }

  /**
   * Return the current focus-level thresholds used by timer.js.
   * { drifting: number, distracted: number, critical: number }
   */
  function getSensitivityThresholds() {
    const level = _runtimeSensitivity || _sensitivityLevel;
    return SENSITIVITY_PRESETS[level] || SENSITIVITY_PRESETS['NORMAL'];
  }

  // ── TIME-OF-DAY: core API ──────────────────────────────────────────────────

  /**
   * getTimePeriod() — classify current wall-clock hour into one of four periods.
   * @returns {'MORNING'|'AFTERNOON'|'EVENING'|'NIGHT'}
   */
  function getTimePeriod() {
    const h = new Date().getHours();
    if (h >= 6  && h < 12) return 'MORNING';
    if (h >= 12 && h < 18) return 'AFTERNOON';
    if (h >= 18 && h < 22) return 'EVENING';
    return 'NIGHT';
  }

  /**
   * applyTimePeriod(period) — apply all time-of-day side effects.
   * Called at session start from session.js.
   */
  function applyTimePeriod(period) {
    _currentTimePeriod = period;

    // Movement speed
    const speedMap = { MORNING: 1.2, AFTERNOON: 1.0, EVENING: 0.85, NIGHT: 0.6 };
    if (window.Movement) Movement.setSpeedMultiplier(speedMap[period] || 1.0);

    // Glow opacity CSS variable
    const glowMap = { MORNING: '1.0', AFTERNOON: '1.0', EVENING: '0.85', NIGHT: '0.6' };
    document.documentElement.style.setProperty(
      '--companion-glow-opacity', glowMap[period] || '1.0'
    );

    // Sound gain (NIGHT = 80%) — only if the nightAutoVolume setting is enabled
    const gainMap = { MORNING: 1.0, AFTERNOON: 1.0, EVENING: 1.0, NIGHT: 0.8 };
    const nightEnabled = window.Settings ? Settings.get('nightAutoVolume') : true;
    const gainMult = nightEnabled ? (gainMap[period] || 1.0) : 1.0;
    if (typeof Sounds !== 'undefined') Sounds.setNightGainMult(gainMult);

    // Sensitivity runtime override — NIGHT auto-gentle (doesn't touch localStorage)
    if (period === 'NIGHT') {
      _runtimeSensitivity = 'GENTLE';
    } else {
      _runtimeSensitivity = null;  // restore user preference
    }

    // body data-attribute for CSS period hooks
    document.body.dataset.timePeriod = period;
  }

  /**
   * getNightSessionCount() — read consecutive night session count from localStorage.
   * @returns {number}
   */
  function getNightSessionCount() {
    const raw = localStorage.getItem(_NIGHT_SESSIONS_KEY);
    const n   = parseInt(raw, 10);
    return isNaN(n) ? 0 : n;
  }

  /**
   * trackNightSession() — call at session start when period is NIGHT.
   * Increments the consecutive night counter.
   */
  function trackNightSession() {
    const count = getNightSessionCount() + 1;
    localStorage.setItem(_NIGHT_SESSIONS_KEY, String(count));
  }

  /**
   * resetNightSessions() — call at session start when period is NOT NIGHT.
   * Resets the consecutive night counter (user studied during the day).
   */
  function resetNightSessions() {
    localStorage.setItem(_NIGHT_SESSIONS_KEY, '0');
  }

  /**
   * checkNightWhisper() — show the "you're up late again" whisper once per day
   * when 3+ consecutive night sessions have been logged.
   */
  function checkNightWhisper() {
    const count = getNightSessionCount();
    if (count < 3) return;

    const today   = new Date().toDateString();
    const lastDay = localStorage.getItem(_NIGHT_WHISPER_KEY);
    if (lastDay === today) return;  // already whispered today

    localStorage.setItem(_NIGHT_WHISPER_KEY, today);

    // Staged caring late-night messages — rotate by count so repeat nights
    // feel progressively more concerned, never nagging.
    const msgs = [
      '...you\'re up late again.',
      '...still here? get some rest ♡',
      '...i worry about you. sleep soon.',
      '...it\'s late. you matter more than the work.',
      '...i\'ll be here tomorrow too. sleep. ♡',
    ];
    const idx = Math.min(count - 3, msgs.length - 1);
    setTimeout(() => showWhisper(msgs[idx], 6000), 1800);
  }

  /**
   * doMorningGreeting() — energetic session-start animation for MORNING period.
   * Quick bounce + widened eyes + HAPPY_COO.
   */
  function doMorningGreeting() {
    const el = Companion.getElement();
    if (!el) return;

    // Quick happy bounce
    el.classList.add('morning-bounce');
    setTimeout(() => el.classList.remove('morning-bounce'), 900);

    // Immediate overjoyed emotion → happy after 700ms
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: window._lastEmotion, to: 'overjoyed' };
    window._lastEmotion    = 'overjoyed';

    if (typeof Sounds !== 'undefined') Sounds.play('happy_coo');

    const morningGreets = [
      'good morning! ✦', 'rise and grind! ☀️', 'morning~ let\'s do this! ✧',
      'good morning! ready? ✦', '...morning. ☀️ let\'s go!',
    ];
    const msg = morningGreets[Math.floor(Math.random() * morningGreets.length)];
    setTimeout(() => showWhisper(msg, 4000), 300);

    setTimeout(() => {
      Emotion.setState('happy');
      window._lastEmotion = 'happy';
      setTimeout(() => { window._lastEmotion = null; }, 1500);
    }, 700);
  }

  // ── TYPING RHYTHM REACTIONS ───────────────────────────────────────────────

  function _setTypingRhythm(newState) {
    if (_keyRhythmState === newState) return;
    // When leaving flow, clear milestone set so next flow session is fresh
    if (_keyRhythmState === 'flow' && newState !== 'flow') {
      _flowMilestones.clear();
    }
    _keyRhythmState = newState;
    _keyRhythmSince = Date.now();
    _applyTypingRhythm(newState);
  }

  function _applyTypingRhythm(state) {
    // Don't override active emotional distress or special states
    const blocked = ['scared', 'crying', 'sad', 'overjoyed', 'love', 'startled'];
    if (blocked.includes(window._lastEmotion)) return;
    if (_dndActive) return;  // DND: companion is still, no rhythm reactions

    const el = Companion.getElement();

    if (state === 'flow') {
      if (el) {
        el.classList.add('typing-flow');
        el.classList.remove('typing-thinking', 'typing-frustrated');
      }
      // Spawn a sparkle particle to reinforce the "in the zone" feel
      if (typeof Particles !== 'undefined') Particles.spawn('flow');
      // Check flow milestones (30s / 60s / 2min / 5min)
      _checkFlowMilestone();
    }

    if (state === 'thinking') {
      if (el) {
        el.classList.remove('typing-flow', 'typing-frustrated');
        el.classList.add('typing-thinking');
      }
      // 35% chance of a curious head tilt during thinking mode
      if (Math.random() < 0.35) _doHeadTilt();
      // 20% chance of a quiet observational murmur
      if (Math.random() < 0.20) {
        const thinkMsgs = ['hm...', '...', '*listens*', '...thinking?', '...✧', 'hmm~'];
        showWhisper(thinkMsgs[Math.floor(Math.random() * thinkMsgs.length)], 2500);
      }
      // Soft sound cue
      if (Math.random() < 0.25 && typeof Sounds !== 'undefined') {
        Sounds.play('curious_ooh');
      }
    }

    if (state === 'frustrated') {
      if (el) {
        el.classList.remove('typing-flow', 'typing-thinking');
        el.classList.add('typing-frustrated');
        // Micro-shiver to express shared frustration
        el.classList.add('shiver');
        setTimeout(() => { if (el) el.classList.remove('shiver'); }, 420);
      }
      // Sympathy whisper — 50% chance
      if (Math.random() < 0.50) {
        const msgs = ['...it\'s okay.', '*concerned*', 'take a breath~',
                      '...struggling?', 'you got this.', 'hmm... 🤔',
                      '*pats head*', '...need help?'];
        showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 3500);
      }
    }

    if (state === 'idle') {
      if (el) { el.classList.remove('typing-flow', 'typing-thinking', 'typing-frustrated'); }
    }
  }

  /** Check and fire flow milestone reactions at 30s / 60s / 2min / 5min. */
  function _checkFlowMilestone() {
    const secs = (Date.now() - _keyRhythmSince) / 1000;
    const milestones = [
      { t: 30,  msgs: ['...focus~', '*nods*', '...going well.', 'nice.'], chance: 0.50 },
      { t: 60,  msgs: ['one minute ✦', '...keep it up.', '*watches quietly*', '...✦'], chance: 0.45 },
      { t: 120, msgs: ['two minutes... ✦', '*impressed*', '...you\'re really going.', 'wow~'], chance: 0.60 },
      { t: 300, msgs: ['five minutes!! ✦', '...wow.', 'i\'m proud of you~', '✦ deep focus ✦', 'incredible...'], chance: 0.75 },
    ];
    for (const m of milestones) {
      if (secs >= m.t && !_flowMilestones.has(m.t)) {
        _flowMilestones.add(m.t);
        if (Math.random() < m.chance) {
          showWhisper(m.msgs[Math.floor(Math.random() * m.msgs.length)], 3200);
        }
        // At 2min+: brief companion bounce to celebrate the milestone
        if (m.t >= 120) {
          const el = Companion.getElement();
          if (el) {
            el.classList.add('flow-milestone');
            setTimeout(() => { if (el) el.classList.remove('flow-milestone'); }, 1000);
          }
        }
        break;  // fire one milestone at a time
      }
    }
  }

  /** Estimate current typing speed in WPM (rough: 5 chars/word, 60s/min). */
  function _getTypingWpm() {
    const n      = Date.now();
    const keys2s = _rhythmKeyTimes.filter(t => n - t < 2000).length;
    return Math.round((keys2s / 2) * 60 / 5);
  }

  // ── DND (DO NOT DISTURB) STUB ─────────────────────────────────────────────

  function setDNDActive(bool) {
    _dndActive = !!bool;
    const el = Companion.getElement();
    if (bool) {
      // Go still and focused — stop spontaneous behaviors
      if (el) { el.classList.remove('typing-flow', 'typing-thinking', 'typing-frustrated'); }
      _setTypingRhythm('idle');
      Emotion.setState('focused');
      window._lastEmotion = 'focused';
      if (_idleLifeTimer) { clearTimeout(_idleLifeTimer); _idleLifeTimer = null; }
    } else {
      // Restore normal behavior
      window._lastEmotion = null;
      _startIdleLife();
    }
  }

  /** Public wrappers so settings preview can trigger tear side-effects */
  function startTearEffect() { _startTears(); }
  function stopTearEffect()  { _stopTears();  }

  /**
   * Set how frequently the buddy does spontaneous idle behaviors.
   * level: 1 = slow & calm, 2 = default, 3 = hyper & frequent
   */
  function setIdleSpeed(level) {
    _idleSpeedMult = Math.max(0.4, Math.min(3, Number(level) || 1));
    // Restart idle-life scheduler immediately so new timing takes effect
    if (_idleLifeTimer) { clearTimeout(_idleLifeTimer); _idleLifeTimer = null; }
    _startIdleLife();
  }

  /**
   * Set how expressive (big reactions, frequent whispers) the buddy is.
   * level: 1 = subtle, 2 = default, 3 = maximum drama
   */
  function setExpressiveness(level) {
    _expressMult = Math.max(0.3, Math.min(3, Number(level) || 1));
  }

  return { start, stop, getState, getFocusLevel, showWhisper,
           setPhoneDetectionEnabled, onPhoneDetected,
           onMilestone,
           setSensitivity, getSensitivityThresholds,
           getTimePeriod, applyTimePeriod,
           getNightSessionCount, trackNightSession, resetNightSessions,
           checkNightWhisper, doMorningGreeting,
           setDNDActive,
           setIdleSpeed, setExpressiveness,
           startTearEffect, stopTearEffect,
           triggerLookSequence };
})();
