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
  const STATE_MAX = 5000;
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
  const CURIOUS_ATTENTION_MS = 8000;   // 8s focused + high attention → curious

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
  const EYE_CONTACT_SHY_MS     = 13000; // 13s continuous direct gaze → shy
  const SHY_HOLD_MS            = 4500;  // shy lasts this long before resolving
  const SHY_COOLDOWN_MS        = 20000; // min gap before triggering shy again

  // Love (petting): click near companion triggers it
  const PET_RADIUS             = 240;   // px from companion centre counts as pet
  const LOVE_HOLD_MS           = 3000;  // love lasts this long after click

  // Startled: sudden large mouse jerk triggers it
  const STARTLED_DIST_THRESHOLD = 280;  // px jump in a single mousemove event
  const STARTLED_HOLD_MS        = 550;  // brief flash

  // Idle life: spontaneous pet-like behaviors
  const IDLE_LIFE_MIN_WAIT     = 10000; // 10s minimum between behaviors
  const IDLE_LIFE_MAX_WAIT     = 22000; // 22s maximum

  // ── CHUNK 5 — new feature constants ───────────────────────────────────────

  // Phone detection: gaze sharply downward = phone-checking posture
  const PHONE_DETECT_SUSTAIN_MS = 3000; // 3s sustained posture → trigger
  const PHONE_GAZE_Y_THRESHOLD  = 0.6;  // gazeY above this = looking down
  const PHONE_GAZE_Y_RESET      = 0.4;  // gazeY below this resets the timer
  const PHONE_PITCH_THRESHOLD   = 15;   // degrees head pitch forward

  // Study encouragement: reward deep focus
  const ENCOURAGEMENT_FOCUS_MIN    = 75;       // focusLevel threshold
  const ENCOURAGEMENT_GAP_MS       = 4 * 60 * 1000; // 4 minutes between encouragements

  // Milestone: celebrate every 5 continuous focused minutes
  const MILESTONE_INTERVAL_MINUTES = 5;
  const MILESTONE_MAX_MINUTES      = 25;

  // Sensitivity presets — used by timer.js via Brain.getSensitivityThresholds()
  const SENSITIVITY_PRESETS = {
    GENTLE: { drifting: 25, distracted: 15, critical: 10 },
    NORMAL: { drifting: 40, distracted: 35, critical: 20 },
    STRICT: { drifting: 55, distracted: 45, critical: 30 },
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

  // Tear overlay state
  // Tear drop spawning
  let tearInterval   = null;
  let _cryPhase      = 'normal';  // 'normal' | 'waterfall'
  let _cryPhaseTimer = null;      // schedules the waterfall transition
  let _poolVh        = 0;         // current tear-pool height in vh units
  let _poolDrainInt  = null;      // interval that slowly drains the pool
  const POOL_MAX_VH         = 14;   // max pool fill height
  const POOL_PER_TEAR_VH    = 0.55; // how much each normal tear adds
  const POOL_PER_STREAM_VH  = 0.18; // streams add less per-element (they're more frequent)
  const POOL_DRAIN_RATE     = 0.25; // vh removed per drain tick
  const POOL_DRAIN_TICK     = 280;  // ms between drain ticks

  // Overjoyed/sulking sequence (Tamagotchi return-from-neglect concept)
  let overjoyedTimer    = null;
  let sulkCheckInterval = null;

  // Focus timer
  let _focusSecs  = 0;
  let _nofaceSecs = 0;
  let _timerInt   = null;

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

  // Shy — sustained eye contact detection
  let _eyeContactStart  = 0;     // epoch ms when continuous eye contact began
  let _shyUntil         = 0;     // epoch ms when shy state expires
  let _shyCooldownUntil = 0;     // epoch ms after which shy can trigger again

  // Love (petting) — click interaction
  let _loveUntil = 0;            // epoch ms when love state expires

  // Startled — sudden mouse jerk
  let _startledUntil = 0;        // epoch ms when startled state expires
  let _prevMouseX    = -1000;    // previous mousemove X for speed detection
  let _prevMouseY    = -1000;

  // Idle life timer
  let _idleLifeTimer = null;
  const FACE_GAZE_HOLD_MS = 1500;

  // ── CHUNK 5 — new private state ────────────────────────────────────────────

  // Phone detection
  let _phoneDetectionEnabled = localStorage.getItem('deskbuddy_phone_detect') !== 'false';
  let _phoneCheckMs          = 0;    // ms phone posture has been held continuously
  const _phoneCallbacks      = [];

  // Study encouragement
  let _lastEncouragementTime = 0;

  // Milestone celebration
  let _continuousFocusedMs    = 0;
  let _nextMilestoneMinutes   = MILESTONE_INTERVAL_MINUTES;
  const _milestoneCallbacks   = [];

  // Welcome-back sequence guards
  let _welcomeBackSeqId1 = null;
  let _welcomeBackSeqId2 = null;

  // Sensitivity
  let _sensitivityLevel = localStorage.getItem('deskbuddy_sensitivity') || 'NORMAL';

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
      focusLevel = Math.max(0, focusLevel - FOCUS_DECAY_RATE);
    }
  }

  /**
   * Quietly set an emotion without triggering the emotion-change arc logic.
   * Used for timed override states (love, startled, excited, shy) so normal
   * transition side-effects (overjoyed arc, tears, etc.) don't fire.
   */
  function _setQuiet(emotion) {
    if (window._lastEmotion !== emotion) {
      window._emotionChanged = { from: window._lastEmotion, to: emotion };
      window._lastEmotion    = emotion;
    }
    Emotion.setState(emotion);
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

    // 1. Love hold (petting click) — most intimate, highest priority
    if (now < _loveUntil) { _setQuiet('love'); return; }

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
        if (p.userSurprised)                       emotion = 'curious';
        else if (tms >= CURIOUS_ATTENTION_MS
              && p.attentionScore > 40)             emotion = 'curious';
        else {
          // Shy trigger — sustained eye contact while companion would normally be 'focused'
          if (p.eyeContact) {
            if (!_eyeContactStart) _eyeContactStart = now;
            if ((now - _eyeContactStart) >= EYE_CONTACT_SHY_MS
                && now >= _shyCooldownUntil) {
              _shyUntil         = now + SHY_HOLD_MS;
              _shyCooldownUntil = now + SHY_COOLDOWN_MS;
              _eyeContactStart  = 0;
              const shyMsgs = ['...hi.', '*blushes*', 'h-hi there...', '/// ...'];
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
        emotion = 'sleepy';
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

      // Keep status text in sync with the actual displayed emotion
      const emotionLabels = {
        idle:       'Idle',
        focused:    'Focused',
        curious:    'Curious',
        sleepy:     'Sleepy',
        happy:      'Happy',
        scared:     'Scared',
        sad:        'Sad',
        crying:     'Crying',
        grumpy:     'Grumpy',
        pouty:      'Pouty',
        suspicious: 'Suspicious',
        sulking:    'Sulking',
        overjoyed:  'Overjoyed',
        excited:    'Excited',
        shy:        'Shy',
        love:       'Loved',
        startled:   'Startled',
      };
      const eLabel = emotionLabels[emotion] || emotion;
      if (window.cameraAvailable && p && p.facePresent) {
        Status.setText(eLabel + ' · Attention ' + p.attentionScore + '%');
      } else {
        Status.setText('Status: ' + eLabel);
      }

      // Start tears on crying, stop on any other emotion
      if (emotion === 'crying') {
        _startTears();
      } else if (tearInterval) {
        _stopTears();
      }
    }

    Emotion.setState(emotion);
  }

  /**
   * Return an array of whisper messages for an emotion, or null if none.
   * These are shown occasionally (42% chance) when the emotion changes.
   */
  function _getWhisperFor(emotion) {
    const map = {
      curious:    ['*tilts head* ...?', 'hm...?', '...👀', 'what\'s that?'],
      happy:      ['✨', '~♪', 'hehe~', '*tail wag*'],
      scared:     ['...!', '*hides*', 'eep!'],
      sad:        ['...', '*sniffles*', 'come back...', '...please'],
      crying:     ['*sobbing quietly*', 'please...',  'don\'t go...'],
      grumpy:     ['hmph.', '*huffs*', '...fine.'],
      pouty:      ['hmph.', '...rude.', '*crosses arms*'],
      sulking:    ['*stares at wall*', 'i\'m not upset.', '...'],
      sleepy:     ['*yawns*', 'zzz...', 'so sleepy...'],
      suspicious: ['...?', '*narrows eyes*', 'hmm.'],
      overjoyed:  ['🎉', 'you\'re back!!', '*zooms around*'],
      excited:    ['!!!', '*vibrating*', 'let\'s go!!!', 'yesyesyes!'],
      shy:        ['...hi.', '*blushes*', 'h-hi there...', '/// ...'],
      love:       ['♡', '*purrs*', '*nuzzles*', '...♡'],
      startled:   ['!!', '*jumps*', 'w-what?!'],
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

    // Build status text including perception info when camera is active
    var label = STATE_LABELS[state] || state;
    var p = window.perception;
    if (window.cameraAvailable && p && p.facePresent) {
      Status.setText(label + ' · Attention ' + p.attentionScore + '%');
    } else {
      Status.setText('Status: ' + label);
    }

    if (stateTimer) {
      clearTimeout(stateTimer);
      stateTimer = null;
    }

    Companion.setRotation(0);

    switch (state) {
      case 'observe':
        Emotion.setState('focused');
        SpriteAnimator.play('idle');
        break;
      case 'curious':
        Emotion.setState('curious');
        SpriteAnimator.play('idle');
        triggerLookSequence();
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
      if (p.userState === 'Sleepy')  { enterState('sleepy');  return; }
      if (p.userState === 'Focused'
       && p.timeInStateMs >= CURIOUS_ATTENTION_MS
       && p.attentionScore > 50)     { enterState('curious'); return; }
      if (p.userState === 'Focused'
       || p.userState === 'LookingAway') { enterState('observe'); return; }
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
          const msgs = ['!!', '*jumps*', 'w-what?!'];
          showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2000);
        }
      }
    }
    _prevMouseX = e.clientX;
    _prevMouseY = e.clientY;
  }

  function onKeyDown() {
    lastKeyTime = Date.now();

    // Excited: rapid typing detection — track rolling keypress timestamps
    const now = Date.now();
    _keyPressTimes.push(now);
    // Keep only presses within the rolling window
    _keyPressTimes = _keyPressTimes.filter(t => now - t < KEYPRESS_WINDOW_MS);
    if (_keyPressTimes.length >= KEYPRESS_EXCITED_COUNT) {
      _excitedUntil = now + EXCITED_HOLD_MS;
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ── TEAR DROP SPAWNER ─────────────────────────────────────────────────────
  // Spawns individual falling teardrop elements anchored to each eye.
  // Phase 1 ('normal'): individual liquid drops.  Phase 2 ('waterfall'): viscous streams.
  function _spawnTear() {
    const eyes = document.querySelectorAll('.eye');
    eyes.forEach(eye => {
      if (_cryPhase === 'waterfall') {
        // Phase 2: 1-2 viscous streams per eye for a dense waterfall
        const count = Math.random() > 0.45 ? 2 : 1;
        for (let i = 0; i < count; i++) _spawnTearStream(eye);
      } else {
        // Phase 1: single drop per eye; skip occasionally for natural rhythm
        if (Math.random() > 0.78) return;
        _spawnTearDrop(eye);
      }
    });
  }

  /** Phase 1 — a single liquid teardrop that falls straight down. */
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
    const dur = (1.0 + Math.random() * 0.55).toFixed(2) + 's';
    el.style.setProperty('--tear-duration', dur);
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); _raiseTearPool(POOL_PER_TEAR_VH); },
               parseFloat(dur) * 1000 + 60);
  }

  /** Phase 2 — a viscous stream ribbon that grows from the eye down to the pool. */
  function _spawnTearStream(eye) {
    const rect = eye.getBoundingClientRect();
    if (!rect.width) return;
    const el = document.createElement('div');
    el.className = 'tear-stream';
    // Randomise position across the eye width
    const startX = rect.left + rect.width * (0.18 + Math.random() * 0.64);
    const startY = rect.bottom;
    el.style.left = startX + 'px';
    el.style.top  = startY + 'px';
    const fallDist = window.innerHeight - startY;
    el.style.setProperty('--stream-fall', fallDist + 'px');
    el.style.setProperty('--stream-width', (5 + Math.random() * 7).toFixed(1) + 'px');
    // Total animation time: grow phase + fade phase
    const dur = (0.75 + Math.random() * 0.30).toFixed(2) + 's';
    el.style.setProperty('--stream-duration', dur);
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); _raiseTearPool(POOL_PER_STREAM_VH); },
               parseFloat(dur) * 1000 + 40);
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
    _cryPhase = 'normal';
    _spawnTear(); // immediate first drop
    tearInterval = setInterval(_spawnTear, 300 + Math.random() * 160);
    // Transition to waterfall phase after 8s of sustained crying
    _cryPhaseTimer = setTimeout(() => {
      _cryPhaseTimer = null;
      _cryPhase = 'waterfall';
      clearInterval(tearInterval);
      _spawnTear(); // immediate burst to kick off the waterfall
      tearInterval = setInterval(_spawnTear, 95 + Math.random() * 55);
    }, 8000);
  }

  function _stopTears() {
    if (tearInterval)   { clearInterval(tearInterval);  tearInterval   = null; }
    if (_cryPhaseTimer) { clearTimeout(_cryPhaseTimer); _cryPhaseTimer = null; }
    _cryPhase = 'normal';
    // Gradually drain the pool — existing tear/stream DOM nodes self-remove via setTimeout
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
    const timerState = window.Timer?.getState?.() || 'FOCUSED';
    const palette = { FOCUSED: '160,190,255', DRIFTING: '255,190,70', DISTRACTED: '255,80,80', CRITICAL: '255,50,50', FAILED: '130,130,150' };
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
        const m = String(Math.floor(_focusSecs / 60)).padStart(2, '0');
        const s = String(_focusSecs % 60).padStart(2, '0');
        timerEl.textContent = `focus ${m}:${s}`;

        // Update color to reflect session timer state
        const timerState = window.Timer?.getState?.() || 'FOCUSED';
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
      if (_phoneDetectionEnabled && window.cameraAvailable) {
        const p = window.perception;
        if (p?.facePresent && p.gazeY > PHONE_GAZE_Y_THRESHOLD && p.headPitch > PHONE_PITCH_THRESHOLD) {
          _phoneCheckMs += 1000;
          if (_phoneCheckMs >= PHONE_DETECT_SUSTAIN_MS && window._lastEmotion !== 'suspicious') {
            // Jump straight to suspicious — skip DRIFTING arc
            window._emotionChanged = { from: window._lastEmotion, to: 'suspicious' };
            window._lastEmotion    = 'suspicious';
            Emotion.setState('suspicious');
            showWhisper('...📱?', 2500);
            // Sound played by sounds.js _pollEmotion() via _playForTransition — no direct call here
            _phoneCallbacks.forEach(fn => { try { fn(); } catch (e) {} });
          }
        } else if (p?.gazeY < PHONE_GAZE_Y_RESET) {
          _phoneCheckMs = 0;
        }
      }

      // ── Milestone tracking ──────────────────────────────────────────────
      // Only count when a session is actively running in FOCUSED timer state
      const timerState   = window.Timer?.getState?.();
      const sessionState = window.Session?.getCurrentStats?.()?.state;
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
    const whispers = {
      5:  '5 min streak! ✦',
      10: '10 minutes! 🔥',
      15: 'you\'re on fire! ✧',
      20: '20 min!! incredible',
      25: '( ˘▽˘)🎉 almost there!',
    };
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: window._lastEmotion, to: 'overjoyed' };
    window._lastEmotion    = 'overjoyed';
    // Sound played by sounds.js _pollEmotion() via _playForTransition — no direct call here
    showWhisper(whispers[minutesMark] || `${minutesMark} min! ✦`, 3000);
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
    if (!window.Timer?.getState || window.Timer.getState() !== 'FOCUSED') return false;
    if (focusLevel < ENCOURAGEMENT_FOCUS_MIN) return false;
    if ((Date.now() - _lastEncouragementTime) < ENCOURAGEMENT_GAP_MS) return false;
    const distress = ['scared', 'crying', 'sad', 'overjoyed', 'sulking', 'startled'];
    if (distress.includes(window._lastEmotion)) return false;
    return true;
  }

  /** Deliver a study encouragement moment. */
  function _doStudyEncouragement() {
    _lastEncouragementTime = Date.now();
    const msgs = ['✦ keep going!', 'you\'re doing great', '( ˘▽˘)/', '✧ focus ✧', '...good.'];
    showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 3000);
    // Look directly at user for 2s, then return
    const c = Companion.getCenter();
    Companion.lookAt(c.x, c.y);
    if (window.Sounds) Sounds.play('happy_coo');
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
    // Cancel any previous welcome-back sequence
    if (_welcomeBackSeqId1) { clearTimeout(_welcomeBackSeqId1); _welcomeBackSeqId1 = null; }
    if (_welcomeBackSeqId2) { clearTimeout(_welcomeBackSeqId2); _welcomeBackSeqId2 = null; }

    // Cancel any lingering sulk arc from old overjoyed logic
    if (overjoyedTimer)    { clearTimeout(overjoyedTimer);    overjoyedTimer    = null; }
    if (sulkCheckInterval) { clearInterval(sulkCheckInterval); sulkCheckInterval = null; }

    currentState = 'idle';
    _stopTears();

    // t=0: overjoyed
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: window._lastEmotion, to: 'overjoyed' };
    window._lastEmotion    = 'overjoyed';
    // Sound played by sounds.js _pollEmotion() via _playForTransition — no direct call here

    _welcomeBackSeqId1 = setTimeout(() => {
      _welcomeBackSeqId1 = null;
      // Guard: abort if face has gone again
      if (!window.perception?.facePresent) { enterState('idle'); return; }

      // t=2000ms: happy
      Emotion.setState('happy');
      window._emotionChanged = { from: 'overjoyed', to: 'happy' };
      window._lastEmotion    = 'happy';
      // Sound played by sounds.js _pollEmotion() via _playForTransition — no direct call here

      _welcomeBackSeqId2 = setTimeout(() => {
        _welcomeBackSeqId2 = null;
        // t=4000ms: resume normal behaviour (guard if face left during this window)
        if (!window.perception?.facePresent) { enterState('idle'); return; }
        window._lastEmotion = null;
        enterState('observe');
      }, 2000);
    }, 2000);
  }

  // ── WHISPER TEXT ──────────────────────────────────────────────────────────
  function showWhisper(text, durationMs) {
    _whisperQueue.push({ text, durationMs: durationMs || 5000 });
    if (!_whisperBusy) _nextWhisper();
  }

  function _nextWhisper() {
    if (_whisperQueue.length === 0) { _whisperBusy = false; return; }
    _whisperBusy = true;
    const { text, durationMs } = _whisperQueue.shift();
    const el = document.getElementById('whisper-text');
    if (!el) { _nextWhisper(); return; }
    el.textContent   = text;
    el.style.opacity = '0.65';
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(_nextWhisper, 900);
    }, durationMs);
  }

  // ── CLICK-TO-PET INTERACTION ───────────────────────────────────────────────
  // Clicking near the companion (within PET_RADIUS px of centre) triggers love.
  function _onScreenClick(e) {
    const c    = Companion.getCenter();
    const dx   = e.clientX - c.x;
    const dy   = e.clientY - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < PET_RADIUS) {
      const now = Date.now();
      _loveUntil = now + LOVE_HOLD_MS;
      const msgs = ['♡', '*purrs*', '*nuzzles you*', '...♡', 'hehe~♡'];
      if (Math.random() < 0.75) {
        showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 3200);
      }
    }
  }

  // ── IDLE LIFE — spontaneous pet-like behaviors ─────────────────────────────
  // Fires a random behavior every IDLE_LIFE_MIN_WAIT…MAX_WAIT ms so the
  // companion never feels like a static program waiting for input.

  function _startIdleLife() {
    const schedule = () => {
      const wait = IDLE_LIFE_MIN_WAIT + Math.random() * (IDLE_LIFE_MAX_WAIT - IDLE_LIFE_MIN_WAIT);
      _idleLifeTimer = setTimeout(() => {
        _spontaneousBehavior();
        schedule();
      }, wait);
    };
    schedule();
  }

  function _spontaneousBehavior() {
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
    if      (r < 26) _doIdleLook();        // look around (26%)
    else if (r < 44) _doDoubleBlink();     // quick double blink (18%)
    else if (r < 57) _doHeadTilt();        // cute head tilt (13%)
    else if (r < 67) _doStretch();         // yawn + stretch (10%)
    else if (r < 78) _doWhisperCoo();      // murmur something (11%)
    else if (r < 87) _doWink();            // cheeky wink (9%)
    else if (r < 94) _doPeek();            // look far away, snap back (7%)
    else             _doShiver();          // tiny excited shiver (6%)
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
    const deg = 9 * (Math.random() > 0.5 ? 1 : -1);
    Companion.setRotation(deg);
    setTimeout(() => Companion.setRotation(0), 1600 + Math.random() * 600);
  }

  /** Add stretching class for the stretch animation */
  function _doStretch() {
    const el = Companion.getElement();
    if (!el) return;
    el.classList.add('stretching');
    showWhisper('*stretches*', 2200);
    if (window.Sounds) Sounds.play('stretch_coo');
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
    if (window.Sounds) Sounds.play('wink_blip');
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

  // ── CHUNK 5 — new public API ───────────────────────────────────────────────

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
    return SENSITIVITY_PRESETS[_sensitivityLevel] || SENSITIVITY_PRESETS['NORMAL'];
  }

  return { start, stop, getState, getFocusLevel, showWhisper,
           setPhoneDetectionEnabled, onPhoneDetected,
           onMilestone,
           setSensitivity, getSensitivityThresholds };
})();
