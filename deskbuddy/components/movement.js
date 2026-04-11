/**
 * Movement engine for the companion.
 * Provides velocity-based motion with smooth interpolation, curved paths,
 * and drift limits.  Targets stay within a small radius of the origin
 * so the companion drifts gently instead of roaming the screen.
 *
 * The companion fills the viewport, so position offsets represent small
 * drifts rather than absolute screen coordinates.
 *
 * Called per-frame by Brain during the observe state.
 */
const Movement = (() => {
  const MAX_DRIFT = 40;
  const SPEED = 0.3;
  const HOME_RADIUS = 25;
  const ARRIVAL_THRESHOLD = 3;
  const STEER_STRENGTH = 0.04;
  const CURVE_AMOUNT = 0.2;
  const DECAY_FACTOR = 0.92;

  let homeX = 0;
  let homeY = 0;
  let targetX = 0;
  let targetY = 0;
  let vx = 0;
  let vy = 0;
  let curveDir = 1;
  let _speedMult = 1.0;

  /**
   * Initialize home position and pick the first drift target.
   */
  function init() {
    const pos = Companion.getPosition();
    homeX = pos.x;
    homeY = pos.y;
    targetX = pos.x;
    targetY = pos.y;
    vx = 0;
    vy = 0;
    pickNewTarget();
  }

  /**
   * Advance one frame of drifting movement (called by Brain at 60 FPS).
   */
  function update() {
    const pos = Companion.getPosition();
    let dx = targetX - pos.x;
    let dy = targetY - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < ARRIVAL_THRESHOLD) {
      pickNewTarget();
      return;
    }

    const dirX = dx / dist;
    const dirY = dy / dist;

    // Perpendicular offset for curved paths
    const perpX = -dirY * CURVE_AMOUNT * curveDir;
    const perpY = dirX * CURVE_AMOUNT * curveDir;

    const desiredVX = (dirX + perpX) * SPEED * _speedMult;
    const desiredVY = (dirY + perpY) * SPEED * _speedMult;

    // Smooth steering toward desired velocity
    vx += (desiredVX - vx) * STEER_STRENGTH;
    vy += (desiredVY - vy) * STEER_STRENGTH;

    // Apply mouse push
    const push = Companion.getMousePush();
    const newX = pos.x + vx + push.dx;
    const newY = pos.y + vy + push.dy;

    const clampedX = clamp(newX, -MAX_DRIFT, MAX_DRIFT);
    const clampedY = clamp(newY, -MAX_DRIFT, MAX_DRIFT);

    Companion.setPosition(clampedX, clampedY);
  }

  /**
   * Gradually reduce velocity toward zero (smooth deceleration).
   */
  function decay() {
    if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) {
      vx = 0;
      vy = 0;
      return;
    }
    vx *= DECAY_FACTOR;
    vy *= DECAY_FACTOR;
    const pos = Companion.getPosition();
    const newX = clamp(pos.x + vx, -MAX_DRIFT, MAX_DRIFT);
    const newY = clamp(pos.y + vy, -MAX_DRIFT, MAX_DRIFT);
    Companion.setPosition(newX, newY);
  }

  /**
   * Return current velocity vector.
   */
  function getVelocity() {
    return { vx: vx, vy: vy };
  }

  function pickNewTarget() {
    // Pick a target within HOME_RADIUS of the home position
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * HOME_RADIUS;
    targetX = homeX + Math.cos(angle) * radius;
    targetY = homeY + Math.sin(angle) * radius;
    curveDir = Math.random() < 0.5 ? 1 : -1;

    // Clamp to drift bounds
    targetX = clamp(targetX, -MAX_DRIFT, MAX_DRIFT);
    targetY = clamp(targetY, -MAX_DRIFT, MAX_DRIFT);
  }

  function setSpeedMultiplier(m) {
    _speedMult = Math.max(0.1, Math.min(3.0, m));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return { init: init, update: update, decay: decay, getVelocity: getVelocity, setSpeedMultiplier: setSpeedMultiplier };
})();
