/**
 * Renderer — main frontend entry point.
 * Initializes the companion, sprite animator, particles, status UI,
 * and behavior brain.
 */
(function main() {
  const world = document.getElementById('world');
  const statusBar = document.getElementById('status-bar');

  // Create companion and place it in the world
  Companion.create(world);

  // Bind sprite animation engine to the companion element
  SpriteAnimator.init(Companion.getElement());

  // Initialize particle effects inside the world container
  Particles.init(world);

  // Initialize status UI
  Status.init(statusBar);

  // Start the creature brain (owns the main loop)
  Brain.start();
  Audio.init();
  Camera.init()
    .then(() => Perception.init())
    .catch((err) => {
      console.warn('[Renderer] Camera init failed:', err);
      Perception.init();
    });
})();
