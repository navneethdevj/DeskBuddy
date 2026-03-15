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

  // ── Phase 2: Face attention config ────────────────────────────────────────
  // How much of the face offset translates to gaze shift.
  // 0.0 = eyes always center, 1.0 = eyes reach full face position.
  // Keep this LOW — the movement should feel like a living glance, not tracking.
  const FACE_GAZE_SOFTNESS = 0.25;

  // How many seconds of user stillness before curiosity scan activates.
  const CURIOSITY_TRIGGER_MS = 15000;

  // Lerp speed for face-driven gaze (lower = smoother/slower)
  const FACE_GAZE_LERP = 0.06;
  // ──────────────────────────────────────────────────────────────────────────

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

  // Phase 2: Face gaze interpolation (smooth eye movement toward face)
  let gazeCurrentX = 0;   // interpolated gaze X in screen pixels (offset from center)
  let gazeCurrentY = 0;   // interpolated gaze Y in screen pixels (offset from center)
  let gazeTargetX  = 0;
  let gazeTargetY  = 0;

  // Phase 2: Emotion/state tracking for sound triggers (used in Phase 3+)
  let lastPerceptionState = null;

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

    // CURSOR TRACKING — disabled (Phase 2). Camera gaze is now the attention source.
    // Preserved for potential re-enable. To restore: uncomment and remove face gaze.
    // var near = isCursorNear();
    // if (near && currentState !== 'followCursor' && followCooldown <= 0) {
    //   enterState('followCursor');
    //   return;
    // }

    var mouseActive = isMouseActive(now);
    var keyActive = isKeyActive(now);

    switch (currentState) {
      case 'observe':
        Movement.update();
        if (window.perception?.facePresent) {
          _updateFaceGaze();
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
          _updateFaceGaze();
        }
        break;
      case 'idle':
        Movement.decay();
        applyGaze(now, mouseActive, keyActive);
        break;
      case 'followCursor':
        // CURSOR TRACKING — disabled (Phase 2). State no longer entered.
        // Preserved for re-enable. Immediately exit to idle if somehow reached.
        // updateFollowCursor();
        Companion.resetLook();
        pickNextState();
        break;
      case 'sleepy':
        Movement.decay();
        applyGaze(now, mouseActive, keyActive);
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
    // CURSOR TRACKING — disabled (Phase 2).
    // if (mouseActive) { Companion.lookAt(mouseX, mouseY); return; }

    // Face gaze — use facePresent as the sole guard (more reliable than
    // cameraAvailable which may not reflect actual detection state)
    if (window.perception?.facePresent) {
      _updateFaceGaze();
      return;
    }

    checkIdleLook(now);
  }

  /**
   * Smoothly interpolate the gaze toward the detected face position.
   *
   * Converts the 0–1 normalized face position from Perception into
   * screen coordinates, then shifts those toward screen center by
   * FACE_GAZE_SOFTNESS. This means:
   *   - Face dead-center (0.5, 0.5) → eyes look at center
   *   - Face at edge → eyes drift slightly that way, never fully there
   *
   * Uses per-frame lerp for organic, never-snapping movement.
   * The actual DOM update happens via Companion.lookAt() which internally
   * lerps the pupil position (PUPIL_LERP = 0.15 in companion.js).
   * Result: two layers of smoothing = very organic eye movement.
   */
  function _updateFaceGaze() {
    const p = window.perception;
    if (!p || !p.facePresent) return;

    const center = Companion.getCenter();

    // Map normalized face position to screen coords
    const rawX = p.faceX * window.innerWidth;
    const rawY = p.faceY * window.innerHeight;

    // Soften: interpolate between screen center and raw face position
    // FACE_GAZE_SOFTNESS=0.25 → eyes move 25% of the way toward face
    const softX = center.x + (rawX - center.x) * FACE_GAZE_SOFTNESS;
    const softY = center.y + (rawY - center.y) * FACE_GAZE_SOFTNESS;

    // Lerp the gaze target for extra smoothness
    gazeTargetX = softX;
    gazeTargetY = softY;
    gazeCurrentX += (gazeTargetX - gazeCurrentX) * FACE_GAZE_LERP;
    gazeCurrentY += (gazeTargetY - gazeCurrentY) * FACE_GAZE_LERP;

    Companion.lookAt(gazeCurrentX, gazeCurrentY);
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
        // CURSOR TRACKING — disabled (Phase 2). Left for reference.
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
   * Choose the next brain state.
   * When camera is available, perception signals guide state selection.
   * When camera is unavailable, original random selection is the fallback.
   */
  function pickNextState() {
    if (window.perception) {
      const p          = window.perception;
      const userState  = p.userState;
      const timeInMs   = p.timeInStateMs;

      if (userState === 'NoFace') {
        enterState('idle');
        return;
      }
      if (userState === 'Sleepy') {
        enterState('sleepy');
        return;
      }
      if (userState === 'LookingAway') {
        enterState('observe');  // keep watching even when user looks away
        return;
      }
      if (userState === 'Focused' && timeInMs >= CURIOSITY_TRIGGER_MS) {
        enterState('curious');  // user is still and focused — get curious
        return;
      }
      if (userState === 'Focused') {
        enterState('observe');  // watching the user work
        return;
      }
    }

    // Fallback: random (original behavior, also used when camera unavailable)
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

  return {
    start:         start,
    stop:          stop,
    getState:      getState,
    getFocusLevel: getFocusLevel
    // Phase 4 will add: startFocusTimer, showWhisper, startTears, stopTears
  };
})();
