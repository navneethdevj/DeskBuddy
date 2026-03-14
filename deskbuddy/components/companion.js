/**
 * Companion module.
 * Creates the companion DOM element, manages position and rotation,
 * applies emotion states, triggers idle behaviors (blinking),
 * and handles mouse interaction.
 */
const Companion = (() => {
  let el = null;
  let x = 0;
  let y = 0;
  let rotation = 0;

  // Mouse interaction state
  let mouseX = 0;
  let mouseY = 0;

  const MOUSE_REACT_RADIUS = 180;
  const MOUSE_PUSH_STRENGTH = 0.6;

  /**
   * Build the companion DOM tree and insert it into the world container.
   */
  function create(container) {
    el = document.createElement('div');
    el.className = 'companion happy';

    el.innerHTML = `
      <div class="companion-inner">
        <div class="ear ear-left"></div>
        <div class="ear ear-right"></div>
        <div class="face">
          <div class="eyebrow eyebrow-left"></div>
          <div class="eyebrow eyebrow-right"></div>
          <div class="eyes">
            <div class="eye eye-left"></div>
            <div class="eye eye-right"></div>
          </div>
          <div class="mouth"></div>
          <div class="cheek cheek-left"></div>
          <div class="cheek cheek-right"></div>
        </div>
      </div>
    `;

    container.appendChild(el);

    // Center on screen
    x = (window.innerWidth - 90) / 2;
    y = (window.innerHeight - 90) / 2;
    applyPosition();

    Emotion.init(el);

    // Track mouse
    document.addEventListener('mousemove', onMouseMove);

    // Start idle behaviors
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
   * Returns {dx, dy} offset to push the companion away from cursor.
   */
  function getMousePush() {
    const cx = x + 45; // center of companion
    const cy = y + 45;
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
      setTimeout(() => {
        if (el) el.classList.remove('blink');
      }, 150);
      scheduleBlink();
    }, delay);
  }

  return { create, setPosition, getPosition, getMousePush, getElement, setRotation };
})();
