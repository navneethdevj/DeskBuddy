/**
 * Companion module.
 * Creates the companion DOM element (a pair of glowing eyes), manages
 * position, rotation, pupil tracking, idle blinking, and mouse interaction.
 */
const Companion = (() => {
  let el = null;
  let x = 0;
  let y = 0;
  let rotation = 0;

  let mouseX = 0;
  let mouseY = 0;

  const SIZE = 160;
  const HALF = SIZE / 2;
  const MOUSE_REACT_RADIUS = 180;
  const MOUSE_PUSH_STRENGTH = 0.6;
  const PUPIL_MAX_X = 5;
  const PUPIL_MAX_Y = 3;

  /**
   * Build the companion DOM tree and insert it into the world container.
   */
  function create(container) {
    el = document.createElement('div');
    el.className = 'companion';

    el.innerHTML = `
      <div class="companion-inner">
        <div class="eyes">
          <div class="eye eye-left">
            <div class="pupil"></div>
          </div>
          <div class="eye eye-right">
            <div class="pupil"></div>
          </div>
        </div>
      </div>
    `;

    container.appendChild(el);

    x = (window.innerWidth - SIZE) / 2;
    y = (window.innerHeight - SIZE) / 2;
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
   * Set companion position directly.
   */
  function setPosition(nx, ny) {
    x = nx;
    y = ny;
    applyPosition();
  }

  /**
   * Get current position.
   */
  function getPosition() {
    return { x, y };
  }

  /**
   * Get mouse push offset based on cursor proximity.
   */
  function getMousePush() {
    const cx = x + HALF;
    const cy = y + HALF;
    const dx = cx - mouseX;
    const dy = cy - mouseY;
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
   * Point the pupils toward a screen coordinate.
   */
  function lookAt(targetX, targetY) {
    if (!el) return;
    const cx = x + HALF;
    const cy = y + HALF;
    const dx = targetX - cx;
    const dy = targetY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;
    var nx = Math.max(-PUPIL_MAX_X, Math.min(PUPIL_MAX_X, (dx / dist) * PUPIL_MAX_X));
    var ny = Math.max(-PUPIL_MAX_Y, Math.min(PUPIL_MAX_Y, (dy / dist) * PUPIL_MAX_Y));
    el.style.setProperty('--pupil-x', nx + 'px');
    el.style.setProperty('--pupil-y', ny + 'px');
  }

  /**
   * Reset pupils to center.
   */
  function resetLook() {
    if (!el) return;
    el.style.setProperty('--pupil-x', '0px');
    el.style.setProperty('--pupil-y', '0px');
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

  return { create, setPosition, getPosition, getMousePush, getElement, setRotation, lookAt, resetLook };
})();
