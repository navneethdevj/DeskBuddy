/**
 * Attention Engine.
 * Decides where the companion should look based on user activity and
 * camera awareness signals.
 *
 * Attention targets (priority order):
 *   1. cursor             – if cursor is moving
 *   2. userFace           – if face detected by camera
 *   3. screenCenter       – if typing detected
 *   4. curiosityPoint     – random when idle
 *
 * The target may change every few seconds.
 */
const Attention = (() => {
  const MOUSE_IDLE_TIMEOUT = 500;                // ms before cursor is "idle"
  const CURIOSITY_MIN_INTERVAL = 4000;
  const CURIOSITY_MAX_INTERVAL = 8000;

  let currentTarget = 'cursor';
  let targetPosition = { x: 0, y: 0 };

  // Curiosity point
  let curiosityPoint = { x: 0, y: 0 };
  let nextCuriosityTime = 0;

  // Mouse state (fed from Brain)
  let lastInputMouseX = 0;
  let lastInputMouseY = 0;
  let lastMouseMoveTime = 0;

  function init() {
    pickCuriosityPoint();
    nextCuriosityTime = Date.now() + CURIOSITY_MIN_INTERVAL;
  }

  /**
   * Called each frame with the latest input state.
   * @param {number} mouseX
   * @param {number} mouseY
   * @param {boolean} isTyping
   * @param {number} now  – Date.now()
   */
  function update(mouseX, mouseY, isTyping, now) {
    // Detect mouse movement
    var mouseDelta = Math.abs(mouseX - lastInputMouseX) + Math.abs(mouseY - lastInputMouseY);
    if (mouseDelta > 2) {
      lastMouseMoveTime = now;
    }
    lastInputMouseX = mouseX;
    lastInputMouseY = mouseY;

    var mouseRecent = (now - lastMouseMoveTime) < MOUSE_IDLE_TIMEOUT;
    var faceDetected = Camera.isRunning() && Camera.isFacePresent();

    // Priority 1: cursor if moving
    if (mouseRecent) {
      currentTarget = 'cursor';
      targetPosition.x = mouseX;
      targetPosition.y = mouseY;
      return;
    }

    // Priority 2: userFace if detected
    if (faceDetected) {
      currentTarget = 'userFace';
      // Webcam is typically above screen; estimate face position
      var gaze = Camera.getGazeDirection();
      targetPosition.x = window.innerWidth / 2 + gaze.x * 200;
      targetPosition.y = window.innerHeight * 0.15;
      return;
    }

    // Priority 3: screenCenter if typing
    if (isTyping) {
      currentTarget = 'screenCenter';
      targetPosition.x = window.innerWidth / 2;
      targetPosition.y = window.innerHeight / 2;
      return;
    }

    // Priority 4: curiosityPoint when idle
    currentTarget = 'curiosityPoint';
    if (now > nextCuriosityTime) {
      pickCuriosityPoint();
      nextCuriosityTime = now + CURIOSITY_MIN_INTERVAL +
        Math.random() * (CURIOSITY_MAX_INTERVAL - CURIOSITY_MIN_INTERVAL);
    }
    targetPosition.x = curiosityPoint.x;
    targetPosition.y = curiosityPoint.y;
  }

  function pickCuriosityPoint() {
    curiosityPoint.x = window.innerWidth  * (0.2 + Math.random() * 0.6);
    curiosityPoint.y = window.innerHeight * (0.2 + Math.random() * 0.6);
  }

  function getTarget()         { return currentTarget; }
  function getTargetPosition() { return { x: targetPosition.x, y: targetPosition.y }; }

  return {
    init: init,
    update: update,
    getTarget: getTarget,
    getTargetPosition: getTargetPosition
  };
})();
