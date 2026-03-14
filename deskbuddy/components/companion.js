/**
 * Companion module.
 * Creates the companion DOM element (a pair of glowing eyes with pupils),
 * manages position, gaze direction via gradient shift and pupil movement,
 * idle blinking, and mouse interaction.  The companion fills the viewport;
 * position offsets create subtle drift.
 */
const Companion = (() => {
  let el = null;
  let x = 0;
  let y = 0;
  let rotation = 0;

  let mouseX = 0;
  let mouseY = 0;

  const MOUSE_REACT_RADIUS = 400;
  const MOUSE_PUSH_STRENGTH = 0.3;
  const GAZE_MAX_X = 15; // percent shift for gradient center
  const GAZE_MAX_Y = 10;

  // Pupil tracking
  const PUPIL_MAX_RADIUS = 8;
  const PUPIL_LERP = 0.15;
  let pupilCurrentX = 0;
  let pupilCurrentY = 0;
  let pupilTargetX = 0;
  let pupilTargetY = 0;

  /**
   * Build the companion DOM tree and insert it into the world container.
   */
  function create(container) {
    el = document.createElement('div');
    el.className = 'companion';

    el.innerHTML = `
      <div class="companion-inner">
        <div class="eyes">
          <div class="eye eye-left"><div class="pupil"></div></div>
          <div class="eye eye-right"><div class="pupil"></div></div>
        </div>
      </div>
    `;

    container.appendChild(el);

    x = 0;
    y = 0;
    applyPosition();

    Emotion.init(el);

    document.addEventListener('mousemove', onMouseMove);

    startIdleBehaviors();

    return el;
  }

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }

  /**
   * Set companion position directly (drift offset from origin).
   */
  function setPosition(nx, ny) {
    x = nx;
    y = ny;
    applyPosition();
  }

  /**
   * Get current position (drift offset from origin).
   */
  function getPosition() {
    return { x, y };
  }

  /**
   * Get the screen-space center of the companion.
   */
  function getCenter() {
    return { x: x + window.innerWidth / 2, y: y + window.innerHeight / 2 };
  }

  /**
   * Get mouse push offset based on cursor proximity.
   */
  function getMousePush() {
    const c = getCenter();
    const dx = c.x - mouseX;
    const dy = c.y - mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < MOUSE_REACT_RADIUS && dist > 0) {
      const strength = (1 - dist / MOUSE_REACT_RADIUS) * MOUSE_PUSH_STRENGTH;
      return {
        dx: (dx / dist) * strength,
        dy: (dy / dist) * strength
      };
    }
    return { dx: 0, dy: 0 };
  }

  /**
   * Get DOM element.
   */
  function getElement() {
    return el;
  }

  /**
   * Set the companion's body rotation in degrees.
   */
  function setRotation(deg) {
    rotation = deg;
  }

  /**
   * Shift the eye gradient and pupil target toward a screen coordinate.
   */
  function lookAt(targetX, targetY) {
    if (!el) return;
    const c = getCenter();
    const dx = targetX - c.x;
    const dy = targetY - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;

    // Gradient gaze shift
    var gx = Math.max(-GAZE_MAX_X, Math.min(GAZE_MAX_X, (dx / dist) * GAZE_MAX_X));
    var gy = Math.max(-GAZE_MAX_Y, Math.min(GAZE_MAX_Y, (dy / dist) * GAZE_MAX_Y));
    el.style.setProperty('--gaze-x', gx + '%');
    el.style.setProperty('--gaze-y', gy + '%');

    // Pupil target (scaled by distance, clamped to max radius)
    var scale = Math.min(1, dist / 500) * PUPIL_MAX_RADIUS;
    pupilTargetX = (dx / dist) * scale;
    pupilTargetY = (dy / dist) * scale;
  }

  /**
   * Reset gaze and pupil to center.
   */
  function resetLook() {
    if (!el) return;
    el.style.setProperty('--gaze-x', '0%');
    el.style.setProperty('--gaze-y', '0%');
    pupilTargetX = 0;
    pupilTargetY = 0;
  }

  /**
   * Smoothly interpolate pupils toward their target each frame.
   * Called from the main rAF loop.
   */
  function updatePupils() {
    pupilCurrentX += (pupilTargetX - pupilCurrentX) * PUPIL_LERP;
    pupilCurrentY += (pupilTargetY - pupilCurrentY) * PUPIL_LERP;

    // Clamp to max radius
    var dist = Math.sqrt(pupilCurrentX * pupilCurrentX + pupilCurrentY * pupilCurrentY);
    if (dist > PUPIL_MAX_RADIUS) {
      pupilCurrentX = (pupilCurrentX / dist) * PUPIL_MAX_RADIUS;
      pupilCurrentY = (pupilCurrentY / dist) * PUPIL_MAX_RADIUS;
    }

    if (!el) return;
    var pupils = el.querySelectorAll('.pupil');
    for (var i = 0; i < pupils.length; i++) {
      pupils[i].style.transform = 'translate(' + pupilCurrentX + 'px, ' + pupilCurrentY + 'px)';
    }
  }

  function applyPosition() {
    if (!el) return;
    el.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
  }

  // ===== Idle Behaviors =====

  function startIdleBehaviors() {
    scheduleBlink();
  }

  function scheduleBlink() {
    const delay = 2500 + Math.random() * 2500;
    setTimeout(() => {
      if (!el) return;
      el.classList.add('blink');
      var blinkDuration = 150 + Math.random() * 150; // 150–300 ms
      setTimeout(() => {
        if (el) el.classList.remove('blink');
      }, blinkDuration);
      scheduleBlink();
    }, delay);
  }

  return { create, setPosition, getPosition, getCenter, getMousePush, getElement, setRotation, lookAt, resetLook, updatePupils };
})();
