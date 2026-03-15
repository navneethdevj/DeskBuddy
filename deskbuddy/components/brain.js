// REPO STUDY FINDINGS:
// Tamagotchi: achievements via bar color thresholds + showNotification() → focus milestone whispers
// Desktop Goose: time-based escalation (curQuitAlpha accumulates over held ESC) → progressive milestone msgs
// EyeOnTask: blink counter + colorBackgroundText for sustained attention feedback → milestone pulse on timer
// WebPet: showNotification() with CSS slide-up animation → used existing showWhisper() queue system
// Neko: repo unavailable → used concept of idle timer-driven behaviors for milestone scheduling

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
  const CURIOUS_ATTENTION_MS = 20000;   // 20s focused + high attention → curious

  // Emotion timing thresholds (ms) — from VERIFY spec
  const LOOKING_AWAY_SUSPICIOUS_MS = 15000;   // 15s → suspicious
  const LOOKING_AWAY_POUTY_MS      = 50000;   // 50s → pouty
  const LOOKING_AWAY_GRUMPY_MS     = 100000;  // 100s → grumpy
  const NOFACE_SCARED_MS           =  6000;   //  6s → scared
  const NOFACE_SAD_MS              = 35000;   // 35s → sad
  const NOFACE_CRYING_MS           = 50000;   // 50s → crying

  // Tear overlay tuning
  const MAX_TEAR_HEIGHT = 65;     // max % height of tear fill
  const TEAR_RISE_RATE  = 0.40;   // % per second during crying
  const TEAR_DRAIN_RATE = 2.5;    // % per drain tick when stopping

  const STATE_LABELS = {
    observe: 'Observing',
    curious: 'Curious',
    idle: 'Idle',
    followCursor: 'Watching You',
    sleepy: 'Sleepy'
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
  let tearHeight   = 0;
  let tearInterval = null;
  let tearDraining = false;

  // Overjoyed/sulking sequence (Tamagotchi return-from-neglect concept)
  let overjoyedTimer    = null;
  let sulkCheckInterval = null;

  // Focus timer
  let _focusSecs  = 0;
  let _nofaceSecs = 0;
  let _timerInt   = null;

  // Focus milestones — fired once each per session
  const _MILESTONES = [
    { secs: 1500, msg: '25 min ˆωˆ tiny stretch?',          fired: false },
    { secs: 2700, msg: '45 min!! take a breather? ˆωˆ',     fired: false },
    { secs: 3600, msg: 'one whole hour ˆωˆ please rest ♡',  fired: false },
  ];

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
  const FACE_GAZE_HOLD_MS = 1500;

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
    Movement.init();
    enterState('idle');
    tick();
    _startFocusTimer();
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
   * Set emotion based on perception signals.
   * Expression reactions (smile, surprise) use face-api.js concept:
   *   https://github.com/justadudewhohacks/face-api.js
   * Implemented via MediaPipe blendshapes (face-api NOT installed).
   */
  function applyFocusEmotion() {
    if (currentState === 'curious') return;
    // Don't override during overjoyed→sulking→forgiven sequence
    if (overjoyedTimer || sulkCheckInterval) return;

    const p = window.perception;

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
        // userSmiling from perception.js maps mouthSmile blendshapes (face-api: happy)
        // userSurprised from perception.js maps jawOpen+eyeWide blendshapes (face-api: surprise)
        // Both surprise (instant) and sustained attention (20s) trigger curious —
        // surprise is an immediate "what?" reaction, sustained is "you've been watching me"
        if (p.userSmiling)              emotion = 'happy';
        else if (p.userSurprised)       emotion = 'curious';
        else if (tms >= CURIOUS_ATTENTION_MS
              && p.attentionScore > 50) emotion = 'curious';
        else                            emotion = 'focused';
        break;

      case 'LookingAway':
        if      (tms >= LOOKING_AWAY_GRUMPY_MS)     emotion = 'grumpy';
        else if (tms >= LOOKING_AWAY_POUTY_MS)       emotion = 'pouty';
        else if (tms >= LOOKING_AWAY_SUSPICIOUS_MS)  emotion = 'suspicious';
        else                                         emotion = 'idle';
        break;

      case 'Sleepy':
        emotion = 'sleepy';
        break;

      case 'NoFace':
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
        _triggerOverjoyed();
        return;
      }

      window._emotionChanged = { from: window._lastEmotion, to: emotion };
      window._lastEmotion    = emotion;
      // Start tears on crying, stop on any other emotion
      if (emotion === 'crying') {
        _startTears();
      } else if (tearInterval || tearHeight > 0) {
        if (!tearDraining) _stopTears();
      }
    }

    Emotion.setState(emotion);
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
    if (wasAbsent && returning) { _triggerOverjoyed(); return; }

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
    var delay = 4000 + Math.random() * 6000;
    setTimeout(function () {
      if (currentState !== 'idle') return;
      Emotion.setState('happy');
      setTimeout(function () {
        if (currentState === 'idle') Emotion.setState('idle');
      }, 400);
    }, delay);
  }

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    lastMouseMoveTime = Date.now();
  }

  function onKeyDown() {
    lastKeyTime = Date.now();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ── TEAR OVERLAY ──────────────────────────────────────────────────────────
  // Water rises during crying, drains fast when user returns
  function _startTears() {
    const overlay = document.getElementById('tear-overlay');
    const fill    = document.getElementById('tear-fill');
    if (!overlay || !fill) return;
    overlay.style.display = 'block';
    if (tearInterval) return;
    tearInterval = setInterval(() => {
      if (tearHeight < MAX_TEAR_HEIGHT) {
        tearHeight = Math.min(MAX_TEAR_HEIGHT, tearHeight + TEAR_RISE_RATE);
        fill.style.height = tearHeight + '%';
      }
    }, 1000);
  }

  function _stopTears() {
    if (tearInterval) { clearInterval(tearInterval); tearInterval = null; }
    const fill    = document.getElementById('tear-fill');
    const overlay = document.getElementById('tear-overlay');
    if (!fill || !overlay) return;
    tearDraining = true;
    const drain = setInterval(() => {
      tearHeight = Math.max(0, tearHeight - TEAR_DRAIN_RATE);
      fill.style.height = tearHeight + '%';
      if (tearHeight <= 0) {
        clearInterval(drain);
        overlay.style.display = 'none';
        tearDraining = false;
      }
    }, 80);
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
  function _startFocusTimer() {
    if (_timerInt) return;
    _timerInt = setInterval(() => {
      const state = window.perception?.userState || 'NoFace';

      if (state === 'Focused') {
        _focusSecs++;
        _nofaceSecs = 0;
      } else if (state === 'NoFace') {
        _nofaceSecs++;
        if (_nofaceSecs >= 60) {
          _focusSecs = 0;
          _nofaceSecs = 0;
          // Reset milestones so they can fire again next session
          _MILESTONES.forEach(m => { m.fired = false; });
        }
      } else {
        _nofaceSecs = 0;
        // Timer pauses but does not reset for LookingAway/Sleepy
      }

      // Check focus milestones
      _MILESTONES.forEach(m => {
        if (!m.fired && _focusSecs >= m.secs && state === 'Focused') {
          m.fired = true;
          showWhisper(m.msg, 6000);
          // Brief visual pulse on the timer element
          const tel = document.getElementById('focus-timer');
          if (tel) {
            tel.classList.add('milestone');
            setTimeout(() => tel.classList.remove('milestone'), 2500);
          }
          // Emit sound signal for audio.js
          window._emotionChanged = { from: window._lastEmotion, to: '__milestone' };
          setTimeout(() => {
            if (window._emotionChanged?.to === '__milestone') window._emotionChanged = null;
          }, 300);
        }
      });

      // Update focus timer display
      const timerEl = document.getElementById('focus-timer');
      if (timerEl) {
        const m = String(Math.floor(_focusSecs / 60)).padStart(2, '0');
        const s = String(_focusSecs % 60).padStart(2, '0');
        timerEl.textContent = `focus ${m}:${s}`;
      }

      // Update attention bar from perception
      const fillEl = document.getElementById('attention-fill');
      if (fillEl && window.perception) {
        fillEl.style.width = window.perception.attentionScore + '%';
      }
    }, 1000);
  }

  // ── WHISPER TEXT ──────────────────────────────────────────────────────────
  // Queue-based — messages don't overlap
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

  return { start, stop, getState, getFocusLevel, showWhisper };
})();
