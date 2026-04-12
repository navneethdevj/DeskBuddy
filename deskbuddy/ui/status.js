/**
 * Status UI module.
 * Renders a minimal status text at the bottom center of the screen.
 */
const Status = (() => {
  let el = null;

  /**
   * Initialize the status display inside the given container.
   */
  function init(container) {
    el = container;
    setText('Idle');
  }

  /**
   * Update the status text.
   */
  function setText(text) {
    if (!el) return;
    el.textContent = text;
  }

  return { init, setText };
})();
