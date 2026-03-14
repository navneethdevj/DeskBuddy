/**
 * Movement engine for the companion.
 * Provides velocity-based motion with smooth interpolation, curved paths,
 * and edge avoidance.  Targets stay within a small radius of a "home"
 * position so the companion drifts gently instead of roaming the screen.
 *
 * Called per-frame by Brain during the observe state.
 */
const Movement = (() => {
  const PADDING = 60;
  const SPEED = 0.4;
  const HOME_RADIUS = 2400;
  const ARRIVAL_THRESHOLD = 5;
  const STEER_STRENGTH = 0.04;
  const CURVE_AMOUNT = 0.2;
  const DECAY_FACTOR = 0.92;
  const COMPANION_SIZE = 6400;

  let homeX = 0;
  let homeY = 0;
  let targetX = 0;
  let targetY = 0;
  let vx = 0;
  let vy = 0;
  let curveDir = 1;

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

    const desiredVX = (dirX + perpX) * SPEED;
    const desiredVY = (dirY + perpY) * SPEED;

    // Smooth steering toward desired velocity
    vx += (desiredVX - vx) * STEER_STRENGTH;
    vy += (desiredVY - vy) * STEER_STRENGTH;

    // Apply mouse push
    const push = Companion.getMousePush();
    const newX = pos.x + vx + push.dx;
    const newY = pos.y + vy + push.dy;

    const clampedX = clamp(newX, PADDING, window.innerWidth - COMPANION_SIZE - PADDING);
    const clampedY = clamp(newY, PADDING, window.innerHeight - COMPANION_SIZE - PADDING);

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
    const newX = clamp(pos.x + vx, PADDING, window.innerWidth - COMPANION_SIZE - PADDING);
    const newY = clamp(pos.y + vy, PADDING, window.innerHeight - COMPANION_SIZE - PADDING);
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

    // Clamp to screen bounds
    targetX = clamp(targetX, PADDING, window.innerWidth - COMPANION_SIZE - PADDING);
    targetY = clamp(targetY, PADDING, window.innerHeight - COMPANION_SIZE - PADDING);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return { init: init, update: update, decay: decay, getVelocity: getVelocity };
})();
