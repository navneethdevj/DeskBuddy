/**
 * Renderer — main frontend entry point.
 * Initializes the companion, sprite animator, status UI, and behavior brain.
 */
(function main() {
  const world = document.getElementById('world');
  const statusBar = document.getElementById('status-bar');

  // Create companion and place it in the world
  Companion.create(world);

  // Bind sprite animation engine to the companion element
  SpriteAnimator.init(Companion.getElement());

  // Initialize status UI
  Status.init(statusBar);

  // Start the creature brain (owns the main loop)
  Brain.start();
})();
