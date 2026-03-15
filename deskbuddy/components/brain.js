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

  // Phase 2: Face gaze
  const FACE_GAZE_SOFTNESS = 0.25;
  const FACE_GAZE_LERP     = 0.06;

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

  // Phase 3: emotion tracking for sounds
  let lastEmotionForSound = null;

  // Phase 3: tear overlay state
  let tearHeight   = 0;
  let tearInterval = null;
  let tearDraining = false;

  // Phase 3: overjoyed/sulking sequence timers
  let overjoyedTimer    = null;
  let sulkCheckInterval = null;

  let gazeCurrentX = 0;
  let gazeCurrentY = 0;
  let gazeTargetX  = 0;
  let gazeTargetY  = 0;

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

    // CURSOR TRACKING — disabled (Phase 2). Face camera is now attention source.
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
        if (window.perception?.facePresent) _applyFaceGaze();
        break;
      case 'idle':
        Movement.decay();
        applyGaze(now, mouseActive, keyActive);
        break;
      case 'followCursor':
        // CURSOR TRACKING — disabled (Phase 2).
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

  /** Set emotion based on perception signals (camera) or focus meter (fallback). */
  function applyFocusEmotion() {
    if (currentState === 'followCursor' || currentState === 'curious') return;

    let emotion;

    if (window.perception) {
      const p   = window.perception;
      const tms = p.timeInStateMs;
      switch (p.userState) {
        case 'Focused':
          emotion = tms >= 15000 ? 'curious' : 'focused';
          break;
        case 'LookingAway':
          if      (tms >= 90000) emotion = 'grumpy';
          else if (tms >= 45000) emotion = 'pouty';
          else                   emotion = 'suspicious';
          break;
        case 'Sleepy':
          emotion = 'sleepy';
          break;
        case 'NoFace':
          if      (tms >= 45000) emotion = 'crying';
          else if (tms >= 30000) emotion = 'sad';
          else if (tms >=  5000) emotion = 'scared';
          else                   emotion = 'idle';
          break;
        default:
          emotion = 'idle';
      }
    } else {
      // Fallback: original focus meter
      if      (focusLevel > 70) emotion = 'focused';
      else if (focusLevel < 30) emotion = 'sleepy';
      else                      emotion = 'idle';
    }

    // Trigger sound on emotion change
    if (emotion !== lastEmotionForSound) {
      window._emotionChanged = { from: lastEmotionForSound, to: emotion };
      lastEmotionForSound = emotion;
      // Manage tears
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
   * Determine where the eyes should look when in idle or sleepy state.
   * Priority: screen-center glance when typing > follow cursor > idle look.
   */
  function applyGaze(now, mouseActive, keyActive) {
    // CURSOR TRACKING — disabled (Phase 2).
    if (window.perception?.facePresent) {
      _applyFaceGaze();
      return;
    }
    checkIdleLook(now);
  }

  function _applyFaceGaze() {
    const p = window.perception;
    if (!p?.facePresent) return;
    const center = Companion.getCenter();
    const rawX   = p.faceX * window.innerWidth;
    const rawY   = p.faceY * window.innerHeight;
    gazeTargetX  = center.x + (rawX - center.x) * FACE_GAZE_SOFTNESS;
    gazeTargetY  = center.y + (rawY - center.y) * FACE_GAZE_SOFTNESS;
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
    // Phase 3: detect user returning after crying/sad/scared
    const wasAbsent  = currentState === 'scared' || currentState === 'sad' || currentState === 'crying';
    const returning  = (state === 'observe' || state === 'idle') && window.perception?.facePresent;
    if (wasAbsent && returning) { _triggerOverjoyed(); return; }

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
    if (window.perception) {
      const p = window.perception;
      if (p.userState === 'NoFace')    { enterState('idle');   return; }
      if (p.userState === 'Sleepy')    { enterState('sleepy'); return; }
      if (p.userState === 'Focused' && p.timeInStateMs >= 15000) { enterState('curious'); return; }
      if (p.userState === 'Focused' || p.userState === 'LookingAway') { enterState('observe'); return; }
    }
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

  // ── Phase 3: Tear overlay ──────────────────────────────────────────
  function _startTears() {
    const overlay = document.getElementById('tear-overlay');
    const fill    = document.getElementById('tear-fill');
    if (!overlay || !fill) return;
    overlay.style.display = 'block';
    if (typeof Audio !== 'undefined') Audio.startCryingAmbient?.();
    if (tearInterval) return;
    tearInterval = setInterval(() => {
      if (tearHeight < 65) { tearHeight = Math.min(65, tearHeight + 0.40); fill.style.height = tearHeight + '%'; }
    }, 1000);
  }

  function _stopTears() {
    if (tearInterval) { clearInterval(tearInterval); tearInterval = null; }
    const fill = document.getElementById('tear-fill');
    const overlay = document.getElementById('tear-overlay');
    if (!fill || !overlay) return;
    if (typeof Audio !== 'undefined') Audio.stopCryingAmbient?.();
    tearDraining = true;
    const drain = setInterval(() => {
      tearHeight = Math.max(0, tearHeight - 2.5);
      fill.style.height = tearHeight + '%';
      if (tearHeight <= 0) { clearInterval(drain); overlay.style.display = 'none'; tearDraining = false; }
    }, 80);
  }

  // ── Phase 3: Overjoyed → Sulking → Forgiven sequence ──────────────
  function _triggerOverjoyed() {
    if (overjoyedTimer) clearTimeout(overjoyedTimer);
    if (sulkCheckInterval) clearInterval(sulkCheckInterval);
    currentState = 'idle';
    _stopTears();
    Emotion.setState('overjoyed');
    window._emotionChanged = { from: lastEmotionForSound, to: 'overjoyed' };
    lastEmotionForSound = 'overjoyed';

    overjoyedTimer = setTimeout(() => {
      overjoyedTimer = null;
      if (window.perception?.facePresent) {
        Emotion.setState('sulking');
        window._emotionChanged = { from: 'overjoyed', to: 'sulking' };
        lastEmotionForSound = 'sulking';
        _startSulkResolution();
      } else {
        enterState('idle');
      }
    }, 5000);
  }

  function _startSulkResolution() {
    if (sulkCheckInterval) clearInterval(sulkCheckInterval);
    let focusedMs = 0;
    sulkCheckInterval = setInterval(() => {
      const p = window.perception;
      if (!p) return;
      if (p.userState === 'Focused') {
        focusedMs += 500;
        if (focusedMs >= 10000) {
          clearInterval(sulkCheckInterval); sulkCheckInterval = null;
          window._emotionChanged = { from: 'sulking', to: 'forgiven' };
          lastEmotionForSound = null;
          enterState('observe');
        }
      } else {
        focusedMs = Math.max(0, focusedMs - 250);
      }
    }, 500);
  }

  return {
    start, stop, getState, getFocusLevel,
    startTears: _startTears, stopTears: _stopTears
  };
})();
