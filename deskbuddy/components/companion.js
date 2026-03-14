/**
 * Companion module.
 * Creates the companion DOM element (a pair of glowing eyes), manages
 * position, gaze direction via gradient shift, idle blinking, and mouse
 * interaction.  The companion fills the viewport; position offsets create
 * subtle drift.
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

  /**
   * Build the companion DOM tree and insert it into the world container.
   */
  function create(container) {
    el = document.createElement('div');
    el.className = 'companion';

    el.innerHTML = `
      <div class="companion-inner">
        <div class="eyes">
          <div class="eye eye-left"></div>
          <div class="eye eye-right"></div>
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
   * Shift the eye gradient toward a screen coordinate to indicate gaze.
   */
  function lookAt(targetX, targetY) {
    if (!el) return;
    const c = getCenter();
    const dx = targetX - c.x;
    const dy = targetY - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;
    var gx = Math.max(-GAZE_MAX_X, Math.min(GAZE_MAX_X, (dx / dist) * GAZE_MAX_X));
    var gy = Math.max(-GAZE_MAX_Y, Math.min(GAZE_MAX_Y, (dy / dist) * GAZE_MAX_Y));
    el.style.setProperty('--gaze-x', gx + '%');
    el.style.setProperty('--gaze-y', gy + '%');
  }

  /**
   * Reset gaze to center.
   */
  function resetLook() {
    if (!el) return;
    el.style.setProperty('--gaze-x', '0%');
    el.style.setProperty('--gaze-y', '0%');
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

  return { create, setPosition, getPosition, getCenter, getMousePush, getElement, setRotation, lookAt, resetLook };
})();
