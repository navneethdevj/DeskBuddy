/**
 * Movement engine for the companion.
 * Provides velocity-based motion with smooth interpolation, curved paths,
 * edge avoidance, and mouse-push integration.
 *
 * Called per-frame by Brain during the wander state.
 */
const Movement = (() => {
  const PADDING = 60;
  const SPEED = 1.8;
  const ARRIVAL_THRESHOLD = 8;
  const DIRECTION_CHANGE_CHANCE = 0.008;
  const STEER_STRENGTH = 0.06;
  const CURVE_AMOUNT = 0.3;
  const DECAY_FACTOR = 0.9;

  let targetX = 0;
  let targetY = 0;
  let vx = 0;
  let vy = 0;
  let curveDir = 1;

  /**
   * Initialize position and pick the first wander target.
   */
  function init() {
    const pos = Companion.getPosition();
    targetX = pos.x;
    targetY = pos.y;
    vx = 0;
    vy = 0;
    pickNewTarget();
  }

  /**
   * Advance one frame of wandering movement (called by Brain at 60 FPS).
   */
  function update() {
    const pos = Companion.getPosition();
    let dx = targetX - pos.x;
    let dy = targetY - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (Math.random() < DIRECTION_CHANGE_CHANCE) {
      pickNewTarget();
    }

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

    const clampedX = clamp(newX, PADDING, window.innerWidth - 90 - PADDING);
    const clampedY = clamp(newY, PADDING, window.innerHeight - 90 - PADDING);

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
    const newX = clamp(pos.x + vx, PADDING, window.innerWidth - 90 - PADDING);
    const newY = clamp(pos.y + vy, PADDING, window.innerHeight - 90 - PADDING);
    Companion.setPosition(newX, newY);
  }

  /**
   * Return current velocity vector.
   */
  function getVelocity() {
    return { vx: vx, vy: vy };
  }

  function pickNewTarget() {
    const maxX = window.innerWidth - 90 - PADDING;
    const maxY = window.innerHeight - 90 - PADDING;
    targetX = PADDING + Math.random() * (maxX - PADDING);
    targetY = PADDING + Math.random() * (maxY - PADDING);
    curveDir = Math.random() < 0.5 ? 1 : -1;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return { init: init, update: update, decay: decay, getVelocity: getVelocity };
})();
