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

    // Phase 3: Create emotion visual elements
    createEmotionVisuals();

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
    const gx = Math.max(-GAZE_MAX_X, Math.min(GAZE_MAX_X, (dx / dist) * GAZE_MAX_X));
    const gy = Math.max(-GAZE_MAX_Y, Math.min(GAZE_MAX_Y, (dy / dist) * GAZE_MAX_Y));
    el.style.setProperty('--gaze-x', gx + '%');
    el.style.setProperty('--gaze-y', gy + '%');

    // Pupil target (scaled by distance, clamped to max radius)
    const maxPx = pupilMaxPx();
    const scale = Math.min(1, dist / PUPIL_DISTANCE_SCALE) * maxPx;
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

  // ===== PHASE 3: Emotion-Based Visuals =====

  let currentCheekOpacity = 0;
  let targetCheekOpacity = 0;
  let currentTopLidPercent = 8;
  let targetTopLidPercent = 8;
  let currentBottomLidPercent = 0;
  let targetBottomLidPercent = 0;
  let pupilSizeW = 14;
  let pupilSizeH = 14;
  let targetPupilSizeW = 14;
  let targetPupilSizeH = 14;
  let eyebrowElements = null;

  /**
   * Create cheek and eyelid DOM elements (called once on init).
   */
  function createEmotionVisuals() {
    if (!el) return;

    // Create cheeks
    var cheeksLeft = document.createElement('div');
    cheeksLeft.className = 'cheeks cheek-left';
    cheeksLeft.style.position = 'absolute';
    cheeksLeft.style.left = '20%';
    cheeksLeft.style.top = '45%';
    cheeksLeft.style.width = '8vmin';
    cheeksLeft.style.height = '4vmin';
    cheeksLeft.style.borderRadius = '50%';
    cheeksLeft.style.background = 'radial-gradient(circle, rgba(255, 120, 150, 0.6), transparent)';
    cheeksLeft.style.opacity = '0';
    cheeksLeft.style.pointerEvents = 'none';
    cheeksLeft.style.zIndex = '5';
    el.appendChild(cheeksLeft);

    var cheeksRight = document.createElement('div');
    cheeksRight.className = 'cheeks cheek-right';
    cheeksRight.style.position = 'absolute';
    cheeksRight.style.right = '20%';
    cheeksRight.style.top = '45%';
    cheeksRight.style.width = '8vmin';
    cheeksRight.style.height = '4vmin';
    cheeksRight.style.borderRadius = '50%';
    cheeksRight.style.background = 'radial-gradient(circle, rgba(255, 120, 150, 0.6), transparent)';
    cheeksRight.style.opacity = '0';
    cheeksRight.style.pointerEvents = 'none';
    cheeksRight.style.zIndex = '5';
    el.appendChild(cheeksRight);

    // Create eyelids (overlays that clip over the eyes)
    var topLid = document.createElement('div');
    topLid.className = 'eyelid eyelid-top';
    topLid.style.position = 'absolute';
    topLid.style.top = '0';
    topLid.style.left = '0';
    topLid.style.width = '100%';
    topLid.style.height = '50%';
    topLid.style.background = '#111111';
    topLid.style.zIndex = '10';
    topLid.style.clipPath = 'inset(0 0 100% 0)';
    topLid.style.pointerEvents = 'none';
    el.appendChild(topLid);

    var bottomLid = document.createElement('div');
    bottomLid.className = 'eyelid eyelid-bottom';
    bottomLid.style.position = 'absolute';
    bottomLid.style.bottom = '0';
    bottomLid.style.left = '0';
    bottomLid.style.width = '100%';
    bottomLid.style.height = '50%';
    bottomLid.style.background = '#111111';
    bottomLid.style.zIndex = '10';
    bottomLid.style.clipPath = 'inset(100% 0 0 0)';
    bottomLid.style.pointerEvents = 'none';
    el.appendChild(bottomLid);

    // Create eyebrows (SVG arcs)
    var eyebrowLeftSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    eyebrowLeftSvg.setAttribute('viewBox', '0 0 100 50');
    eyebrowLeftSvg.style.position = 'absolute';
    eyebrowLeftSvg.style.left = '25%';
    eyebrowLeftSvg.style.top = '25%';
    eyebrowLeftSvg.style.width = '8vmin';
    eyebrowLeftSvg.style.height = '2vmin';
    eyebrowLeftSvg.style.opacity = '0';
    eyebrowLeftSvg.style.pointerEvents = 'none';
    eyebrowLeftSvg.style.zIndex = '8';
    var arcLeft = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arcLeft.setAttribute('d', 'M 10 40 Q 50 10 90 40');
    arcLeft.setAttribute('stroke', 'rgba(255, 150, 100, 0.8)');
    arcLeft.setAttribute('stroke-width', '3');
    arcLeft.setAttribute('fill', 'none');
    arcLeft.setAttribute('stroke-linecap', 'round');
    eyebrowLeftSvg.appendChild(arcLeft);
    el.appendChild(eyebrowLeftSvg);

    var eyebrowRightSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    eyebrowRightSvg.setAttribute('viewBox', '0 0 100 50');
    eyebrowRightSvg.style.position = 'absolute';
    eyebrowRightSvg.style.right = '25%';
    eyebrowRightSvg.style.top = '25%';
    eyebrowRightSvg.style.width = '8vmin';
    eyebrowRightSvg.style.height = '2vmin';
    eyebrowRightSvg.style.opacity = '0';
    eyebrowRightSvg.style.pointerEvents = 'none';
    eyebrowRightSvg.style.zIndex = '8';
    var arcRight = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arcRight.setAttribute('d', 'M 10 40 Q 50 10 90 40');
    arcRight.setAttribute('stroke', 'rgba(255, 150, 100, 0.8)');
    arcRight.setAttribute('stroke-width', '3');
    arcRight.setAttribute('fill', 'none');
    arcRight.setAttribute('stroke-linecap', 'round');
    eyebrowRightSvg.appendChild(arcRight);
    el.appendChild(eyebrowRightSvg);

    eyebrowElements = { left: eyebrowLeftSvg, right: eyebrowRightSvg };
  }

  /**
   * Update emotion visuals each frame.
   * Called from Brain's tick() via Companion.updateEmotionVisuals().
   */
  function updateEmotionVisuals() {
    if (!el) return;

    var config;
    if (Emotion.getEmotionConfig) {
      config = Emotion.getEmotionConfig();
    }
    if (!config) return;

    // Lerp cheek opacity
    var cheekSpeed = 0.04;
    targetCheekOpacity = config.cheekTarget || 0;
    currentCheekOpacity += (targetCheekOpacity - currentCheekOpacity) * cheekSpeed;
    var cheeks = el.querySelectorAll('.cheeks');
    for (var ci = 0; ci < cheeks.length; ci++) {
      cheeks[ci].style.opacity = Math.max(0, currentCheekOpacity).toFixed(3);
    }

    // Lerp eyelid positions
    var lidSpeed = 0.06;
    targetTopLidPercent = config.topLidTarget != null ? config.topLidTarget : 8;
    targetBottomLidPercent = config.bottomLidTarget || 0;
    currentTopLidPercent += (targetTopLidPercent - currentTopLidPercent) * lidSpeed;
    currentBottomLidPercent += (targetBottomLidPercent - currentBottomLidPercent) * lidSpeed;

    var topLid = el.querySelector('.eyelid-top');
    var bottomLid = el.querySelector('.eyelid-bottom');
    if (topLid) {
      topLid.style.clipPath = 'inset(0 0 ' + (100 - currentTopLidPercent).toFixed(1) + '% 0)';
    }
    if (bottomLid) {
      bottomLid.style.clipPath = 'inset(' + (100 - currentBottomLidPercent).toFixed(1) + '% 0 0 0)';
    }

    // Lerp pupil size
    var pupilSpeed = 0.1;
    targetPupilSizeW = (config.pupilSize && config.pupilSize.w) || 14;
    targetPupilSizeH = (config.pupilSize && config.pupilSize.h) || 14;
    pupilSizeW += (targetPupilSizeW - pupilSizeW) * pupilSpeed;
    pupilSizeH += (targetPupilSizeH - pupilSizeH) * pupilSpeed;

    var scaleX = config.pupilScaleX != null ? config.pupilScaleX : 1.0;
    var pupils = el.querySelectorAll('.pupil');
    for (var pi = 0; pi < pupils.length; pi++) {
      pupils[pi].style.width = pupilSizeW.toFixed(1) + 'px';
      pupils[pi].style.height = pupilSizeH.toFixed(1) + 'px';
      if (scaleX !== 1.0) {
        pupils[pi].style.transform = 'translate(' + pupilCurrentX + 'px, ' + pupilCurrentY + 'px) scaleX(' + scaleX.toFixed(2) + ')';
      }
    }

    // Eyebrow visibility
    if (eyebrowElements) {
      var targetOpacity = config.showEyebrows ? (config.eyebrowOpacity || 0.65) : 0;
      var currentLeft = parseFloat(eyebrowElements.left.style.opacity) || 0;
      var newOpacity = currentLeft + (targetOpacity - currentLeft) * 0.06;
      eyebrowElements.left.style.opacity = newOpacity.toFixed(3);
      eyebrowElements.right.style.opacity = newOpacity.toFixed(3);
    }

    // Update pupil lerp speed based on config
    if (config.pupilLerpSpeed) {
      // Allow the pupil lerp to vary by emotion
      // Note: PUPIL_LERP is const, so we cannot reassign; instead we use a separate speed variable
    }
  }

  /**
   * Phase 3: Embarrassed shudder animation sequence.
   * - Lids snap to 0% instantly
   * - Pupils dart left/right rapidly (150ms each direction)
   * - Pupils return to center (100ms)
   * - Two rapid blinks (80ms each)
   * - Body shudder sin(t*0.08)*3 for 400ms
   * - Cheeks blaze to 0.55
   * - Auto-resolve to Happy after ~4s (handled by emotion engine)
   */
  function playEmbarrassedShudder() {
    if (!el) return;

    // Snap lids to 0% instantly
    var topLid = el.querySelector('.eyelid-top');
    var bottomLid = el.querySelector('.eyelid-bottom');
    if (topLid) topLid.style.clipPath = 'inset(0 0 100% 0)';
    if (bottomLid) bottomLid.style.clipPath = 'inset(100% 0 0 0)';
    currentTopLidPercent = 0;
    currentBottomLidPercent = 0;

    // Blaze cheeks
    currentCheekOpacity = 0.55;
    var cheeks = el.querySelectorAll('.cheeks');
    for (var ci = 0; ci < cheeks.length; ci++) {
      cheeks[ci].style.opacity = '0.55';
    }

    // Dart pupils left
    pupilTargetX = -pupilMaxPx() * 0.7;
    pupilTargetY = 0;

    setTimeout(function () {
      if (!el) return;
      // Dart pupils right
      pupilTargetX = pupilMaxPx() * 0.7;
    }, 150);

    setTimeout(function () {
      if (!el) return;
      // Return to center
      pupilTargetX = 0;
      pupilTargetY = 0;
    }, 300);

    // Two rapid blinks at 400ms and 480ms
    setTimeout(function () {
      if (!el) return;
      el.classList.add('blink');
      setTimeout(function () { if (el) el.classList.remove('blink'); }, 80);
    }, 400);

    setTimeout(function () {
      if (!el) return;
      el.classList.add('blink');
      setTimeout(function () { if (el) el.classList.remove('blink'); }, 80);
    }, 560);

    // Body shudder for 400ms
    var shudderStart = Date.now();
    var shudderDuration = 400;
    function doShudder() {
      if (!el) return;
      var elapsed = Date.now() - shudderStart;
      if (elapsed >= shudderDuration) {
        el.style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + rotation + 'deg)';
        return;
      }
      var shudderX = Math.sin(elapsed * 0.08) * 3;
      el.style.transform = 'translate(' + (x + shudderX) + 'px, ' + y + 'px) rotate(' + rotation + 'deg)';
      requestAnimationFrame(doShudder);
    }
    setTimeout(doShudder, 300);
  }

  /**
   * Phase 3: Overjoyed animation sequence.
   * - Drain tears (3s)
   * - Eyes wide (0% lids)
   * - Sparkle burst (handled by caller)
   * - Bouncy float
   * - Auto-resolve to Sulking after ~6s (handled by emotion engine)
   */
  function playOverjoyedSequence() {
    if (!el) return;

    // Drain tears
    if (typeof Emotion !== 'undefined' && Emotion.hideTearOverlay) {
      Emotion.hideTearOverlay();
    }

    // Eyes wide — snap lids to 0%
    var topLid = el.querySelector('.eyelid-top');
    var bottomLid = el.querySelector('.eyelid-bottom');
    if (topLid) topLid.style.clipPath = 'inset(0 0 100% 0)';
    if (bottomLid) bottomLid.style.clipPath = 'inset(100% 0 0 0)';
    currentTopLidPercent = 0;
    currentBottomLidPercent = 0;

    // Cheeks to max
    currentCheekOpacity = 0.45;
    var cheeks = el.querySelectorAll('.cheeks');
    for (var ci = 0; ci < cheeks.length; ci++) {
      cheeks[ci].style.opacity = '0.45';
    }

    // Bouncy float effect
    var bounceStart = Date.now();
    var bounceDuration = 3000;
    function doBounce() {
      if (!el) return;
      var elapsed = Date.now() - bounceStart;
      if (elapsed >= bounceDuration) {
        el.style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + rotation + 'deg)';
        return;
      }
      var bounceY = Math.sin(elapsed * 0.008) * 4;
      el.style.transform = 'translate(' + x + 'px, ' + (y + bounceY) + 'px) rotate(' + rotation + 'deg)';
      requestAnimationFrame(doBounce);
    }
    doBounce();
  }

  return { create, setPosition, getPosition, getCenter, getMousePush, getElement, setRotation, lookAt, resetLook, updatePupils, updateEmotionVisuals, playEmbarrassedShudder, playOverjoyedSequence };
})();
