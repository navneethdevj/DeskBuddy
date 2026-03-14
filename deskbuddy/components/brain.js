/**
 * Creature Brain — attention-based behavior state machine.
 * Cycles through states (observe, curious, idle, sleepy) on a timer and
 * switches to followCursor when the mouse cursor is nearby.
 *
 * Owns the main requestAnimationFrame loop and coordinates Movement,
 * SpriteAnimator, Companion, Emotion, and Status modules.
 */
const Brain = (() => {
  const STATES = ['observe', 'curious', 'idle', 'sleepy'];
  const STATE_MIN = 2000;
  const STATE_MAX = 5000;
  const CURSOR_RADIUS = 200;
  const PADDING = 60;
  const COMPANION_SIZE = 160;
  const COMPANION_HALF = COMPANION_SIZE / 2;
  const FOLLOW_COOLDOWN_FRAMES = 120; // 2 s at 60 fps
  const RETREAT_THRESHOLD = 100;
  const RETREAT_FACTOR = -0.4;

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

  // ===== Public API =====

  function start() {
    document.addEventListener('mousemove', onMouseMove);
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

  // ===== Main Loop =====

  function tick() {
    animFrameId = requestAnimationFrame(tick);

    if (followCooldown > 0) followCooldown--;

    var near = isCursorNear();
    if (near && currentState !== 'followCursor' && followCooldown <= 0) {
      enterState('followCursor');
      return;
    }

    switch (currentState) {
      case 'observe':
        Movement.update();
        // Eyes slowly scan the environment
        var time = Date.now() * 0.001;
        var pos = Companion.getPosition();
        Companion.lookAt(
          pos.x + COMPANION_HALF + Math.sin(time * 0.8) * 300,
          pos.y + COMPANION_HALF + Math.sin(time * 0.5) * 100
        );
        break;
      case 'curious':
        Movement.decay();
        break;
      case 'idle':
        Movement.decay();
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
        break;
    }
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

  function pickNextState() {
    var next = STATES[Math.floor(Math.random() * STATES.length)];
    enterState(next);
  }

  // ===== Helpers =====

  function isCursorNear() {
    var pos = Companion.getPosition();
    var cx = pos.x + COMPANION_HALF;
    var cy = pos.y + COMPANION_HALF;
    var dx = mouseX - cx;
    var dy = mouseY - cy;
    return Math.sqrt(dx * dx + dy * dy) < CURSOR_RADIUS;
  }

  /** Track cursor with eyes; retreat if cursor is very close. */
  function updateFollowCursor() {
    var pos = Companion.getPosition();
    var cx = pos.x + COMPANION_HALF;
    var cy = pos.y + COMPANION_HALF;
    var dx = mouseX - cx;
    var dy = mouseY - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);

    Companion.lookAt(mouseX, mouseY);

    if (dist > 0 && dist < RETREAT_THRESHOLD) {
      Emotion.setState('suspicious');
      var mx = (dx / dist) * RETREAT_FACTOR;
      var my = (dy / dist) * RETREAT_FACTOR;
      Companion.setPosition(
        clamp(pos.x + mx, PADDING, window.innerWidth - COMPANION_SIZE - PADDING),
        clamp(pos.y + my, PADDING, window.innerHeight - COMPANION_SIZE - PADDING)
      );
    } else {
      Emotion.setState('focused');
    }
  }

  /** Animate pupils looking left → right → up → center. */
  function triggerLookSequence() {
    var pos = Companion.getPosition();
    var cx = pos.x + COMPANION_HALF;
    var cy = pos.y + COMPANION_HALF;

    Companion.lookAt(cx - 300, cy);
    setTimeout(function () {
      if (currentState !== 'curious') return;
      Companion.lookAt(cx + 300, cy);
      setTimeout(function () {
        if (currentState !== 'curious') return;
        Companion.lookAt(cx, cy - 200);
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
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return { start: start, stop: stop, getState: getState };
})();
