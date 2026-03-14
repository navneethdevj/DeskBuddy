/**
 * Movement engine for the companion.
 * Implements wandering behavior with smooth interpolation,
 * hop animation, edge avoidance, and mouse-push integration.
 */
const Movement = (() => {
  const PADDING = 60;
  const SPEED = 1.8;
  const ARRIVAL_THRESHOLD = 8;
  const PAUSE_MIN = 800;
  const PAUSE_MAX = 2200;
  const HOP_CHANCE = 0.3;
  const DIRECTION_CHANGE_CHANCE = 0.008; // ~0.8% chance per frame (~every ~2s at 60fps) to pick a new target mid-move

  let targetX = 0;
  let targetY = 0;
  let paused = false;
  let animFrameId = null;

  /**
   * Initialize the movement engine. Sets the first wander target and starts the loop.
   */
  function start() {
    const pos = Companion.getPosition();
    targetX = pos.x;
    targetY = pos.y;
    pickNewTarget();
    loop();
  }

  /**
   * Stop the movement loop.
   */
  function stop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  /**
   * Main animation loop using requestAnimationFrame.
   */
  function loop() {
    animFrameId = requestAnimationFrame(loop);

    if (paused) return;

    const pos = Companion.getPosition();
    let dx = targetX - pos.x;
    let dy = targetY - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Occasionally change direction mid-move for playfulness
    if (Math.random() < DIRECTION_CHANGE_CHANCE) {
      pickNewTarget();
      return;
    }

    if (dist < ARRIVAL_THRESHOLD) {
      // Arrived at target - pause then pick a new one
      pause(() => {
        maybeHop();
        pickNewTarget();
      });
      return;
    }

    // Normalize direction and move
    const nx = (dx / dist) * SPEED;
    const ny = (dy / dist) * SPEED;

    // Apply mouse push
    const push = Companion.getMousePush();
    const newX = pos.x + nx + push.dx;
    const newY = pos.y + ny + push.dy;

    // Clamp within screen bounds
    const clampedX = clamp(newX, PADDING, window.innerWidth - 90 - PADDING);
    const clampedY = clamp(newY, PADDING, window.innerHeight - 90 - PADDING);

    Companion.setPosition(clampedX, clampedY);
  }

  /**
   * Pick a random target within the screen bounds with padding.
   */
  function pickNewTarget() {
    const maxX = window.innerWidth - 90 - PADDING;
    const maxY = window.innerHeight - 90 - PADDING;
    targetX = PADDING + Math.random() * (maxX - PADDING);
    targetY = PADDING + Math.random() * (maxY - PADDING);
  }

  /**
   * Pause movement for a short time, then invoke callback.
   */
  function pause(callback) {
    paused = true;
    const duration = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
    setTimeout(() => {
      paused = false;
      if (callback) callback();
    }, duration);
  }

  /**
   * Trigger a hop animation on the companion element.
   */
  function maybeHop() {
    if (Math.random() > HOP_CHANCE) return;
    const el = Companion.getElement();
    if (!el) return;
    el.classList.add('hopping');
    setTimeout(() => {
      if (el) el.classList.remove('hopping');
    }, 420);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  return { start, stop };
})();
