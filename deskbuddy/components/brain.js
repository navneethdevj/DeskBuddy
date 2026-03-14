/**
 * Creature Brain — attention-based behavior state machine with focus timer,
 * camera awareness integration, attention engine, gaze-driven drift,
 * and emotion engine.
 *
 * Camera user states (Focused / Distracted / LookingAway / NoFace / Sleepy)
 * drive emotion and attention.
 *
 * Focus Timer:
 *   - Starts when user state becomes Focused
 *   - Pauses when Distracted or LookingAway
 *   - Pauses when NoFace detected
 *   - Resets when NoFace lasts longer than 60 seconds
 *
 * Emotion mapping:
 *   Focused → Happy
 *   Focused for long time without movement → Curious
 *   No movement anywhere → Sleepy
 *   User looking away → Suspicious
 *   User leaves frame → Scared
 *
 * Attention targets (priority order via Attention module):
 *   1. userMovement
 *   2. userFace
 *   3. curiosityPoint
 *   4. environmentScan
 *
 * Micro-intent behaviours:
 *   - Reaction delay (50–120 ms) when the attention target type changes
 *   - Curiosity glances (occasional small random offsets)
 *   - Idle drift (slow sinusoidal wander)
 *
 * Owns the main requestAnimationFrame loop and coordinates Movement,
 * SpriteAnimator, Companion, Emotion, Particles, Attention, Camera, and Status.
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

  // Micro-intent: reaction delay
  const REACTION_DELAY_MIN = 50;
  const REACTION_DELAY_MAX = 120;

  // Micro-intent: curiosity glance
  const CURIOSITY_GLANCE_MIN_INTERVAL = 3000;
  const CURIOSITY_GLANCE_MAX_INTERVAL = 7000;

  // Micro-intent: idle drift
  const IDLE_DRIFT_SPEED = 0.0004;  // radians per ms
  const IDLE_DRIFT_AMPLITUDE = 60;  // pixels

  // Focus timer
  const FOCUS_TIMER_NOFACE_RESET = 60000; // reset timer after 60 sec NoFace

  // Emotion mapping: low camera movement → sleepy override
  const MOVEMENT_SLEEPY_THRESHOLD = 0.002;

  // Emotion mapping: long focus without movement threshold
  const LONG_FOCUS_CURIOUS_MS = 30000;  // 30 s focused without much movement → Curious

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

  // Micro-intent: reaction delay state
  let lastAttentionType = '';
  let reactionDelayUntil = 0;

  // Micro-intent: curiosity glance state
  let curiosityGlanceOffsetX = 0;
  let curiosityGlanceOffsetY = 0;
  let nextCuriosityGlanceTime = 0;

  // NoFace searching state
  const NO_FACE_SEARCH_RATE = 0.002;  // phase increment per frame; ~52 s full cycle at 60 fps
  let noFaceSearchPhase = 0;

  // Focus timer state
  let focusTimerSeconds = 0;
  let focusTimerRunning = false;
  let lastFocusTimerTick = 0;
  let noFaceStartTime = 0;

  // Emotion mapping state
  let focusedSinceTime = 0;       // when Focused state began (for long-focus detection)
  let lastMovementCheckTime = 0;

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
    Attention.init();
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
    updateFocusTimer(now);

    var mouseActive = isMouseActive(now);
    var keyActive = isKeyActive(now);

    // --- Attention engine update ---
    Attention.update(mouseX, mouseY, keyActive, now);
    var attTarget = Attention.getTarget();
    var attPos = Attention.getTargetPosition();

    // --- Micro-intent: reaction delay on target type change ---
    if (attTarget !== lastAttentionType) {
      reactionDelayUntil = now + REACTION_DELAY_MIN +
        Math.random() * (REACTION_DELAY_MAX - REACTION_DELAY_MIN);
      lastAttentionType = attTarget;
    }

    // --- Micro-intent: curiosity glance (small random offset) ---
    updateCuriosityGlance(now);

    // --- Micro-intent: idle drift ---
    var idleDriftX = 0;
    var idleDriftY = 0;
    if (!mouseActive && !keyActive) {
      idleDriftX = Math.sin(now * IDLE_DRIFT_SPEED) * IDLE_DRIFT_AMPLITUDE;
      idleDriftY = Math.cos(now * IDLE_DRIFT_SPEED * 0.7) * IDLE_DRIFT_AMPLITUDE * 0.5;
    }

    // Smooth pupil interpolation every frame (spring-damper in Companion)
    Companion.updatePupils();

    // Particle effects based on current emotion
    Particles.update(Emotion.getState());

    var near = isCursorNear();
    if (near && currentState !== 'followCursor' && followCooldown <= 0) {
      enterState('followCursor');
      return;
    }

    switch (currentState) {
      case 'observe':
        Movement.update();
        // Use attention target with reaction delay
        if (now >= reactionDelayUntil) {
          Companion.lookAt(
            attPos.x + curiosityGlanceOffsetX + idleDriftX,
            attPos.y + curiosityGlanceOffsetY + idleDriftY
          );
        }
        break;
      case 'curious':
        Movement.decay();
        break;
      case 'idle':
        Movement.decay();
        if (now >= reactionDelayUntil) {
          applyGaze(now, mouseActive, keyActive, attPos, idleDriftX, idleDriftY);
        }
        break;
      case 'followCursor':
        updateFollowCursor();
        if (!near) {
          followCooldown = FOLLOW_COOLDOWN_FRAMES;
          Companion.resetLook();
          pickNextState();
        }
        break;
      case 'sleepy':
        Movement.decay();
        if (now >= reactionDelayUntil) {
          applyGaze(now, mouseActive, keyActive, attPos, idleDriftX, idleDriftY);
        }
        break;
    }

    // Emotion engine: camera state drives emotion, focus-meter as fallback
    applyEmotionEngine(now);
  }

  // ===== Micro-intent: Curiosity Glance =====

  function updateCuriosityGlance(now) {
    if (now < nextCuriosityGlanceTime) return;
    if (Math.random() < 0.3) {
      curiosityGlanceOffsetX = (Math.random() - 0.5) * 100;
      curiosityGlanceOffsetY = (Math.random() - 0.5) * 60;
      setTimeout(function () {
        curiosityGlanceOffsetX = 0;
        curiosityGlanceOffsetY = 0;
      }, 200 + Math.random() * 300);
    }
    nextCuriosityGlanceTime = now + CURIOSITY_GLANCE_MIN_INTERVAL +
      Math.random() * (CURIOSITY_GLANCE_MAX_INTERVAL - CURIOSITY_GLANCE_MIN_INTERVAL);
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

  // ===== Focus Timer =====

  function updateFocusTimer(now) {
    if (!Camera.isRunning()) return;

    var userState = Camera.getUserState();

    switch (userState) {
      case 'Focused':
        if (!focusTimerRunning) {
          focusTimerRunning = true;
          lastFocusTimerTick = now;
        }
        noFaceStartTime = 0;
        break;
      case 'Distracted':
      case 'LookingAway':
        focusTimerRunning = false;
        noFaceStartTime = 0;
        break;
      case 'NoFace':
        focusTimerRunning = false;
        if (noFaceStartTime === 0) {
          noFaceStartTime = now;
        } else if (now - noFaceStartTime > FOCUS_TIMER_NOFACE_RESET) {
          focusTimerSeconds = 0;
          noFaceStartTime = now; // prevent repeated resets
        }
        break;
      case 'Sleepy':
        focusTimerRunning = false;
        noFaceStartTime = 0;
        break;
    }

    // Accumulate focused time
    if (focusTimerRunning) {
      var elapsed = (now - lastFocusTimerTick) / 1000;
      focusTimerSeconds += elapsed;
      lastFocusTimerTick = now;
    }

    Status.setTimer(focusTimerSeconds);
  }

  // ===== Emotion Engine =====

  /**
   * Camera user state drives expression when available.
   * Emotion mapping:
   *   Focused → Happy
   *   Focused for long time without movement → Curious
   *   No movement anywhere → Sleepy
   *   User looking away (Distracted/LookingAway) → Suspicious
   *   User leaves frame (NoFace) → Scared
   * Falls back to focus-meter emotion when camera is inactive.
   */
  function applyEmotionEngine(now) {
    if (currentState === 'followCursor' || currentState === 'curious') return;

    if (Camera.isRunning()) {
      var userState = Camera.getUserState();
      var mouseActive = isMouseActive(now);
      var keyActive = isKeyActive(now);
      var anyActivity = mouseActive || keyActive;

      switch (userState) {
        case 'Focused':
          // Track how long we've been focused
          if (focusedSinceTime === 0) focusedSinceTime = now;

          // Long focus without movement → Curious
          if (!anyActivity && (now - focusedSinceTime) > LONG_FOCUS_CURIOUS_MS) {
            Emotion.setState('curious');
          } else {
            Emotion.setState('happy');
          }
          break;
        case 'Distracted':
        case 'LookingAway':
          focusedSinceTime = 0;
          Emotion.setState('suspicious');
          break;
        case 'NoFace':
          focusedSinceTime = 0;
          Emotion.setState('scared');
          triggerNoFaceSearching(now);
          break;
        case 'Sleepy':
          focusedSinceTime = 0;
          Emotion.setState('sleepy');
          break;
        default:
          focusedSinceTime = 0;
          applyFocusEmotion();
          break;
      }

      // No movement anywhere → Sleepy (overrides other emotions except NoFace)
      if (userState !== 'NoFace' && !anyActivity &&
          Camera.getMovementLevel() < MOVEMENT_SLEEPY_THRESHOLD && focusLevel < 20) {
        Emotion.setState('sleepy');
      }

      var displayState = userState === 'NoFace' ? 'Away' : userState;
      Status.setText('User: ' + displayState);
    } else {
      applyFocusEmotion();
    }
  }

  /** Set emotion based on focus level (fallback when camera unavailable). */
  function applyFocusEmotion() {
    if (focusLevel > 70) {
      Emotion.setState('focused');
    } else if (focusLevel < 30) {
      Emotion.setState('sleepy');
    } else {
      Emotion.setState('idle');
    }
  }

  // ===== NoFace Searching Behaviour =====

  function triggerNoFaceSearching(now) {
    noFaceSearchPhase += NO_FACE_SEARCH_RATE;
    var c = Companion.getCenter();
    Companion.lookAt(
      c.x + Math.sin(noFaceSearchPhase * 3) * 250,
      c.y + Math.cos(noFaceSearchPhase * 2) * 120
    );
  }

  // ===== Gaze Logic (idle / sleepy states) =====

  /**
   * Determine where the eyes should look when in idle or sleepy state.
   * Uses the attention engine target, with curiosity glance offsets and
   * idle drift applied for organic motion.
   */
  function applyGaze(now, mouseActive, keyActive, attPos, driftX, driftY) {
    // Screen awareness: brief glance at screen center when typing starts
    if (keyActive && !wasTyping) {
      typingGlanceUntil = now + 1000;
    }
    wasTyping = keyActive;

    if (now < typingGlanceUntil) {
      Companion.lookAt(window.innerWidth / 2, window.innerHeight / 2);
      return;
    }

    if (mouseActive) {
      Companion.lookAt(
        mouseX + curiosityGlanceOffsetX,
        mouseY + curiosityGlanceOffsetY
      );
      return;
    }

    // Use attention engine target with micro-intent offsets
    Companion.lookAt(
      attPos.x + curiosityGlanceOffsetX + driftX,
      attPos.y + curiosityGlanceOffsetY + driftY
    );

    // Idle look behavior
    checkIdleLook(now);
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
    // Only set status from state labels when camera is not running
    if (!Camera.isRunning()) {
      Status.setText('User: ' + (STATE_LABELS[state] || state));
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

  function pickNextState() {
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

    Companion.lookAt(mouseX + curiosityGlanceOffsetX, mouseY + curiosityGlanceOffsetY);

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
