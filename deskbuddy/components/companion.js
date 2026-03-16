// REPO STUDY FINDINGS:
// WebPet: eyes are text-based emoji chars (#eye-left/#eye-right), expression via innerHTML swap → separate DOM eyebrow elements for richer expression
// Web Shimeji: repo unavailable (404) → concept of CSS-layered expression elements applied via eyebrow divs above eyes
// Tamagotchi: stat bars change color at thresholds + showNotification() for alerts → inspired milestone pulse + whisper celebration
// EyeOnTask: blink detection via EAR, cv2.putText for visual state feedback → attention bar already exists, milestone adds text reward
// Desktop Goose: time-based escalation (curQuitAlpha accumulates over held ESC) → inspired progressive milestone messages

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

  // Gradient gaze smoothing — prevents instant snap of --gaze-x/--gaze-y
  // 0.18 at 60fps: 1-(1-0.18)^5 ≈ 63% after 5 frames, 95% after 15 frames (~250ms)
  const GAZE_GRADIENT_LERP = 0.18;
  // Reference distance for proportional gradient shift (pixels from companion center)
  // At this distance gaze gradient reaches its maximum; closer = proportionally less.
  const GAZE_REFERENCE_DIST = 300;
  let gazeGradientCurrentX = 0, gazeGradientCurrentY = 0;
  let gazeGradientTargetX  = 0, gazeGradientTargetY  = 0;

  // Pupil tracking
  const PUPIL_MOVEMENT_RADIUS_VMIN = 6;   // max movement radius in vmin (keeps pupil inside the eye)
  const PUPIL_LERP = 0.15;
  const PUPIL_DISTANCE_SCALE = 500;
  let pupilCurrentX = 0;
  let pupilCurrentY = 0;
  let pupilTargetX = 0;
  let pupilTargetY = 0;

  /** Convert vmin units to current pixel value. */
  function pupilMaxPx() {
    return PUPIL_MOVEMENT_RADIUS_VMIN * Math.min(window.innerWidth, window.innerHeight) / 100;
  }

  /**
   * Build the companion DOM tree and insert it into the world container.
   */
  function create(container) {
    el = document.createElement('div');
    el.className = 'companion';

    el.innerHTML = `
      <div class="companion-inner">
        <div class="eyebrows">
          <div class="eyebrow eyebrow-left"></div>
          <div class="eyebrow eyebrow-right"></div>
        </div>
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

    // Gradient gaze target — proportional to offset magnitude (not pure direction).
    // Small face movements produce small gradient shifts; large movements saturate.
    gazeGradientTargetX = Math.max(-GAZE_MAX_X, Math.min(GAZE_MAX_X, (dx / GAZE_REFERENCE_DIST) * GAZE_MAX_X));
    gazeGradientTargetY = Math.max(-GAZE_MAX_Y, Math.min(GAZE_MAX_Y, (dy / GAZE_REFERENCE_DIST) * GAZE_MAX_Y));

    // Pupil target (scaled by distance, clamped to max radius)
    const maxPx = pupilMaxPx();
    const scale = Math.min(1, dist / PUPIL_DISTANCE_SCALE) * maxPx;
    pupilTargetX = (dx / dist) * scale;
    pupilTargetY = (dy / dist) * scale;
  }

  /**
   * Reset gaze and pupil to center smoothly via targets.
   */
  function resetLook() {
    if (!el) return;
    gazeGradientTargetX = 0;
    gazeGradientTargetY = 0;
    pupilTargetX = 0;
    pupilTargetY = 0;
  }

  /**
   * Smoothly interpolate gradient gaze and pupils toward their targets each frame.
   * Called from the main rAF loop.
   */
  function updatePupils() {
    // Smooth gradient gaze interpolation (prevents snap/teleport)
    gazeGradientCurrentX += (gazeGradientTargetX - gazeGradientCurrentX) * GAZE_GRADIENT_LERP;
    gazeGradientCurrentY += (gazeGradientTargetY - gazeGradientCurrentY) * GAZE_GRADIENT_LERP;
    if (el) {
      el.style.setProperty('--gaze-x', gazeGradientCurrentX + '%');
      el.style.setProperty('--gaze-y', gazeGradientCurrentY + '%');
    }

    // Smooth pupil interpolation
    pupilCurrentX += (pupilTargetX - pupilCurrentX) * PUPIL_LERP;
    pupilCurrentY += (pupilTargetY - pupilCurrentY) * PUPIL_LERP;

    // Clamp to max radius
    const maxPx = pupilMaxPx();
    const dist = Math.sqrt(pupilCurrentX * pupilCurrentX + pupilCurrentY * pupilCurrentY);
    if (dist > maxPx) {
      pupilCurrentX = (pupilCurrentX / dist) * maxPx;
      pupilCurrentY = (pupilCurrentY / dist) * maxPx;
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
