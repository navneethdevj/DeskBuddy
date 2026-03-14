/**
 * Attention Engine.
 * Decides where the companion should look based on user activity and
 * camera awareness signals.
 *
 * Attention targets (priority order):
 *   1. userMovement       – cursor / user motion detected
 *   2. userFace           – if face detected by camera
 *   3. curiosityPoint     – random points of interest
 *   4. environmentScan    – systematic scanning when idle
 *
 * The target may change every few seconds.
 */
const Attention = (() => {
  const MOUSE_IDLE_TIMEOUT = 500;                // ms before cursor is "idle"
  const CURIOSITY_MIN_INTERVAL = 4000;
  const CURIOSITY_MAX_INTERVAL = 8000;
  const SCAN_STEP_INTERVAL = 2000;               // ms between environment scan steps

  let currentTarget = 'userMovement';
  let targetPosition = { x: 0, y: 0 };

  // Curiosity point
  let curiosityPoint = { x: 0, y: 0 };
  let nextCuriosityTime = 0;

  // Environment scan
  let scanIndex = 0;
  let lastScanTime = 0;

  // Mouse state (fed from Brain)
  let lastInputMouseX = 0;
  let lastInputMouseY = 0;
  let lastMouseMoveTime = 0;

  function init() {
    pickCuriosityPoint();
    nextCuriosityTime = Date.now() + CURIOSITY_MIN_INTERVAL;
    lastScanTime = Date.now();
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
    var userMoving = Camera.isRunning() && Camera.getMovementLevel() > 0.005;

    // Priority 1: user movement (cursor moving or user physically moving)
    if (mouseRecent || userMoving) {
      currentTarget = 'userMovement';
      if (mouseRecent) {
        targetPosition.x = mouseX;
        targetPosition.y = mouseY;
      } else {
        // User is physically moving — look toward camera (top center)
        var head = Camera.getHeadDirection();
        targetPosition.x = window.innerWidth / 2 + head.x * 150;
        targetPosition.y = window.innerHeight * 0.15;
      }
      return;
    }

    // Priority 2: userFace if detected
    if (faceDetected) {
      currentTarget = 'userFace';
      var gaze = Camera.getGazeDirection();
      targetPosition.x = window.innerWidth / 2 + gaze.x * 200;
      targetPosition.y = window.innerHeight * 0.15;
      return;
    }

    // Priority 3: curiosityPoint
    if (now < nextCuriosityTime) {
      currentTarget = 'curiosityPoint';
      targetPosition.x = curiosityPoint.x;
      targetPosition.y = curiosityPoint.y;
      return;
    }

    // Refresh curiosity point periodically
    if (Math.random() < 0.3) {
      pickCuriosityPoint();
      nextCuriosityTime = now + CURIOSITY_MIN_INTERVAL +
        Math.random() * (CURIOSITY_MAX_INTERVAL - CURIOSITY_MIN_INTERVAL);
      currentTarget = 'curiosityPoint';
      targetPosition.x = curiosityPoint.x;
      targetPosition.y = curiosityPoint.y;
      return;
    }

    // Priority 4: environmentScan — systematic scanning
    currentTarget = 'environmentScan';
    if (now - lastScanTime > SCAN_STEP_INTERVAL) {
      scanIndex = (scanIndex + 1) % 5;
      lastScanTime = now;
    }
    var scanPos = getScanPosition(scanIndex);
    targetPosition.x = scanPos.x;
    targetPosition.y = scanPos.y;
  }

  function pickCuriosityPoint() {
    curiosityPoint.x = window.innerWidth  * (0.2 + Math.random() * 0.6);
    curiosityPoint.y = window.innerHeight * (0.2 + Math.random() * 0.6);
  }

  /** Return a scan position for environment scanning pattern. */
  function getScanPosition(index) {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var positions = [
      { x: w * 0.25, y: h * 0.3 },   // upper-left area
      { x: w * 0.75, y: h * 0.3 },   // upper-right area
      { x: w * 0.5,  y: h * 0.5 },   // center
      { x: w * 0.25, y: h * 0.7 },   // lower-left area
      { x: w * 0.75, y: h * 0.7 }    // lower-right area
    ];
    return positions[index % positions.length];
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
