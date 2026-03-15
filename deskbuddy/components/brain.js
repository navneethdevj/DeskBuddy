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
  const CURSOR_RADIUS = 500;
  const MAX_DRIFT = 40;
  const FOLLOW_COOLDOWN_FRAMES = 120; // 2 s at 60 fps
  const RETREAT_THRESHOLD = 200;
  const RETREAT_FACTOR = -0.4;

  // Face gaze — two layer system (face position + iris direction)
  const FACE_GAZE_SOFTNESS = 0.30;  // how much face position shifts gaze
  const FACE_GAZE_LERP     = 0.07;  // smoothing (lower = slower/smoother)
  const IRIS_AMPLIFY       = 80;    // scale iris gazeX/Y to screen pixels

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

  const STATE_LABELS = {
    observe: 'Observing',
    curious: 'Curious',
    idle: 'Idle',
    followCursor: 'Watching You',
    sleepy: 'Sleepy'
  };

  let currentState = 'idle';
  let stateTimer = null;
  let animFrameId = null;
  let mouseX = -1000;
  let mouseY = -1000;
  let followCooldown = 0;

  // Activity tracking
  let focusLevel = 50;
  let lastMouseMoveTime = 0;
  let lastKeyTime = 0;

  // Idle look state
  let idleLookActive = false;
  let nextIdleLookTime = 0;

  // Screen awareness: typing glance
  let wasTyping = false;
  let typingGlanceUntil = 0;

  // Face gaze interpolation state
  let gazeCurrentX = 0, gazeCurrentY = 0;
  let gazeTargetX  = 0, gazeTargetY  = 0;

  // Neko-style lean state — body offset toward face
  let leanCurrentX = 0, leanCurrentY = 0;

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

    if (followCooldown > 0) followCooldown--;

    var now = Date.now();
    updateFocusMeter(now);

    // Smooth pupil interpolation every frame
    Companion.updatePupils();

    // Particle effects based on current emotion
    Particles.update(Emotion.getState());

    // CURSOR TRACKING — disabled. Face camera is now the attention source.
    // To re-enable: uncomment this block and remove face gaze functions below.
    // var near = isCursorNear();
    // if (near && currentState !== 'followCursor' && followCooldown <= 0) {
    //   enterState('followCursor');
    //   return;
    // }
    var near = false;

    var mouseActive = isMouseActive(now);
    var keyActive = isKeyActive(now);

    switch (currentState) {
      case 'observe':
        Movement.update();
        if (window.perception?.facePresent) {
          _applyFaceGaze();
          _applyBodyLean();
        } else {
          var time = now * 0.001;
          var c = Companion.getCenter();
          Companion.lookAt(
            c.x + Math.sin(time * 0.8) * 120,
            c.y + Math.sin(time * 0.5) * 60
          );
        }
        break;
      case 'curious':
        Movement.decay();
        if (window.perception?.facePresent) {
          _applyFaceGaze();
          _applyBodyLean();
        }
        break;
      case 'idle':
        Movement.decay();
        if (window.perception?.facePresent) {
          _applyFaceGaze();
          _applyBodyLean();
        } else {
          applyGaze(now, mouseActive, keyActive);
        }
        break;
      case 'followCursor':
        // CURSOR TRACKING — disabled. Face gaze handles attention.
        // updateFollowCursor();
        Companion.resetLook();
        pickNextState();
        break;
      case 'sleepy':
        Movement.decay();
        if (window.perception?.facePresent) {
          _applyFaceGaze(0.03);  // slower lerp when sleepy
          _applyBodyLean();
        } else {
          applyGaze(now, mouseActive, keyActive);
        }
        break;
    }

    // Focus-driven emotion (overridden by followCursor / curious)
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

  /** Set emotion based on focus level unless a special state overrides. */
  function applyFocusEmotion() {
    if (currentState === 'followCursor' || currentState === 'curious') return;

    if (focusLevel > 70) {
      Emotion.setState('focused');
    } else if (focusLevel < 30) {
      Emotion.setState('sleepy');
    } else {
      Emotion.setState('idle');
    }
  }

  // ===== Gaze Logic (idle / sleepy states) =====

  /**
   * Determine where the eyes should look when in idle or sleepy state.
   * Priority: screen-center glance when typing > follow cursor > idle look.
   */
  function applyGaze(now, mouseActive, keyActive) {
    // Cursor-based gaze removed — face camera is the attention source.
    // if (mouseActive) { Companion.lookAt(mouseX, mouseY); return; }
    checkIdleLook(now);
  }

  /**
   * Two-layer face gaze.
   * Layer 1: face position on screen (where IS the user's face)
   * Layer 2: iris offset from perception.gazeX/Y (where eyes are POINTING)
   *
   * Reference: https://github.com/arnaudlvq/Eye-Contact-RealTime-Detection
   * Combined face position + iris direction = more natural gaze than either alone.
   */
  function _applyFaceGaze(lerpOverride) {
    const p = window.perception;
    if (!p?.facePresent) return;

    const lerp   = lerpOverride || FACE_GAZE_LERP;
    const center = Companion.getCenter();

    // Layer 1 — face position
    const facePosX = p.faceX * window.innerWidth;
    const facePosY = p.faceY * window.innerHeight;
    const softX    = center.x + (facePosX - center.x) * FACE_GAZE_SOFTNESS;
    const softY    = center.y + (facePosY - center.y) * FACE_GAZE_SOFTNESS;

    // Layer 2 — iris gaze direction adds subtle extra offset
    const irisX = p.gazeX * IRIS_AMPLIFY;
    const irisY = p.gazeY * (IRIS_AMPLIFY * 0.6);

    gazeTargetX  = softX + irisX;
    gazeTargetY  = softY + irisY;
    gazeCurrentX += (gazeTargetX - gazeCurrentX) * lerp;
    gazeCurrentY += (gazeTargetY - gazeCurrentY) * lerp;

    Companion.lookAt(gazeCurrentX, gazeCurrentY);
  }

  /**
   * Neko-style body lean — body drifts toward face position with momentum.
   * Reference: https://github.com/mirandadam/neko
   *
   * Neko lerps the cat toward the cursor. We do the same but toward the
   * user's face. LEAN_LERP and LEAN_STRENGTH kept low — should feel like
   * quiet interest, not chasing. Clamped to ±40px (existing MAX_DRIFT).
   */
  function _applyBodyLean() {
    const p = window.perception;
    if (!p?.facePresent) return;

    const center   = Companion.getCenter();
    const facePosX = p.faceX * window.innerWidth;
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
    currentState = state;
    Status.setText('Status: ' + (STATE_LABELS[state] || state));

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
        Companion.resetLook();
        SpriteAnimator.play('idle');
        scheduleHappyFlash();
        break;
      case 'followCursor':
        Emotion.setState('focused');
        SpriteAnimator.play('idle');
        break;
      case 'sleepy':
        Emotion.setState('sleepy');
        Companion.resetLook();
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
       && p.timeInStateMs >= 15000
       && p.attentionScore > 50)     { enterState('curious'); return; }
      if (p.userState === 'Focused'
       || p.userState === 'LookingAway') { enterState('observe'); return; }
    }
    // Fallback: random (original behavior, used when camera unavailable)
    var next = STATES[Math.floor(Math.random() * STATES.length)];
    enterState(next);
  }

  // ===== Helpers =====

  function isCursorNear() {
    var c = Companion.getCenter();
    var dx = mouseX - c.x;
    var dy = mouseY - c.y;
    return Math.sqrt(dx * dx + dy * dy) < CURSOR_RADIUS;
  }

  /** Track cursor with eyes; retreat if cursor is very close. */
  function updateFollowCursor() {
    var c = Companion.getCenter();
    var dx = mouseX - c.x;
    var dy = mouseY - c.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    Companion.lookAt(mouseX, mouseY);

    if (dist > 0 && dist < RETREAT_THRESHOLD) {
      Emotion.setState('suspicious');
      var pos = Companion.getPosition();
      var mx = (dx / dist) * RETREAT_FACTOR;
      var my = (dy / dist) * RETREAT_FACTOR;
      Companion.setPosition(
        clamp(pos.x + mx, -MAX_DRIFT, MAX_DRIFT),
        clamp(pos.y + my, -MAX_DRIFT, MAX_DRIFT)
      );
    } else {
      Emotion.setState('focused');
    }
  }

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

  return { start: start, stop: stop, getState: getState, getFocusLevel: getFocusLevel };
})();
