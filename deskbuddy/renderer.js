/**
 * Renderer — main frontend entry point.
 * Initializes the companion, starts the movement engine, and sets up the status UI.
 */
(function main() {
  const world = document.getElementById('world');
  const statusBar = document.getElementById('status-bar');

  // Create companion and place it in the world
  Companion.create(world);

  // Start wandering movement
  Movement.start();

  // Initialize status UI
  Status.init(statusBar);
})();
