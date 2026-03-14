/**
 * Creature Brain — behavior state machine.
 * Cycles through states (wander, idle, hop, lookAround) on a timer and
 * switches to inspectCursor when the mouse cursor is nearby.
 *
 * Owns the main requestAnimationFrame loop and coordinates Movement,
 * SpriteAnimator, Companion, Emotion, and Status modules.
 */
const Brain = (() => {
  const STATES = ['wander', 'idle', 'hop', 'lookAround'];
  const STATE_MIN = 2000;
  const STATE_MAX = 5000;
  const CURSOR_RADIUS = 180;
  const PADDING = 60;

  const STATE_LABELS = {
    wander: 'Wandering',
    idle: 'Idle',
    hop: 'Hopping',
    lookAround: 'Looking Around',
    inspectCursor: 'Curious'
  };

  let currentState = 'idle';
  let stateTimer = null;
  let animFrameId = null;
  let mouseX = -1000;
  let mouseY = -1000;
  let inspectCooldown = 0;

  // ===== Public API =====

  function start() {
    document.addEventListener('mousemove', onMouseMove);
    Movement.init();
    enterState('wander');
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

    if (inspectCooldown > 0) inspectCooldown--;

    var near = isCursorNear();
    if (near && currentState !== 'inspectCursor' && inspectCooldown <= 0) {
      enterState('inspectCursor');
      return;
    }

    switch (currentState) {
      case 'wander':
        Movement.update();
        applyMovementRotation();
        syncWalkAnimation();
        break;
      case 'idle':
      case 'lookAround':
        Movement.decay();
        applyMovementRotation();
        break;
      case 'inspectCursor':
        updateInspectCursor();
        if (!near) {
          inspectCooldown = 120; // ~2 s cooldown at 60 fps
          pickNextState();
        }
        break;
      case 'hop':
        Movement.decay();
        break;
    }
  }

  // ===== State Management =====

  function enterState(state) {
    var el = Companion.getElement();
    if (el) {
      el.classList.remove('look-left', 'look-right');
    }

    currentState = state;
    Status.setText('Status: ' + (STATE_LABELS[state] || state));

    if (stateTimer) {
      clearTimeout(stateTimer);
      stateTimer = null;
    }

    if (state !== 'inspectCursor') {
      Emotion.setState('happy');
    }

    switch (state) {
      case 'wander':
        SpriteAnimator.play('walk');
        break;
      case 'idle':
        Companion.setRotation(0);
        SpriteAnimator.play('idle');
        break;
      case 'hop':
        Companion.setRotation(0);
        SpriteAnimator.play('jump', function () {
          SpriteAnimator.play('idle');
        });
        break;
      case 'lookAround':
        Companion.setRotation(0);
        SpriteAnimator.play('idle');
        triggerLookSequence();
        break;
      case 'inspectCursor':
        Companion.setRotation(0);
        Emotion.setState('focused');
        SpriteAnimator.play('idle');
        break;
    }

    if (state !== 'inspectCursor') {
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
    var cx = pos.x + 45;
    var cy = pos.y + 45;
    var dx = mouseX - cx;
    var dy = mouseY - cy;
    return Math.sqrt(dx * dx + dy * dy) < CURSOR_RADIUS;
  }

  function applyMovementRotation() {
    var vel = Movement.getVelocity();
    Companion.setRotation(vel.vx * 2);
  }

  /** Switch between walk and idle sprites based on current velocity. */
  function syncWalkAnimation() {
    var vel = Movement.getVelocity();
    var speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
    if (speed < 0.3 && SpriteAnimator.getAnimation() === 'walk') {
      SpriteAnimator.play('idle');
    } else if (speed >= 0.3 && SpriteAnimator.getAnimation() === 'idle' && currentState === 'wander') {
      SpriteAnimator.play('walk');
    }
  }

  /** Look toward cursor and drift slightly toward / away from it. */
  function updateInspectCursor() {
    var pos = Companion.getPosition();
    var cx = pos.x + 45;
    var cy = pos.y + 45;
    var dx = mouseX - cx;
    var dy = mouseY - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);

    var el = Companion.getElement();
    if (el) {
      el.classList.remove('look-left', 'look-right');
      if (Math.abs(dx) > 5) {
        el.classList.add(dx < 0 ? 'look-left' : 'look-right');
      }
    }

    if (dist > 0 && dist < CURSOR_RADIUS) {
      var factor = dist < 80 ? -0.3 : 0.15;
      var mx = (dx / dist) * factor;
      var my = (dy / dist) * factor;
      Companion.setPosition(
        clamp(pos.x + mx, PADDING, window.innerWidth - 150),
        clamp(pos.y + my, PADDING, window.innerHeight - 150)
      );
    }
  }

  function triggerLookSequence() {
    var el = Companion.getElement();
    if (!el) return;
    el.classList.add('look-left');
    setTimeout(function () {
      if (!el) return;
      el.classList.remove('look-left');
      el.classList.add('look-right');
      setTimeout(function () {
        if (el) el.classList.remove('look-right');
      }, 800 + Math.random() * 400);
    }, 800 + Math.random() * 400);
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
