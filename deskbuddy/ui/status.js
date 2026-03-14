/**
 * Status UI module.
 * Renders a minimal user status text and focus timer at the bottom center.
 */
const Status = (() => {
  let container = null;
  let statusEl = null;
  let timerEl = null;

  /**
   * Initialize the status display inside the given container.
   */
  function init(parentEl) {
    container = parentEl;

    // User status line
    statusEl = document.createElement('div');
    statusEl.className = 'status-text';
    container.appendChild(statusEl);

    // Focus timer line
    timerEl = document.createElement('div');
    timerEl.className = 'focus-timer';
    container.appendChild(timerEl);

    setText('User: Idle');
    setTimer(0);
  }

  /**
   * Update the user status text.
   */
  function setText(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
  }

  /**
   * Update the focus timer display.
   * @param {number} seconds  – total focused seconds
   */
  function setTimer(seconds) {
    if (!timerEl) return;
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    timerEl.textContent = 'focus ' +
      String(mins).padStart(2, '0') + ':' +
      String(secs).padStart(2, '0');
  }

  return { init: init, setText: setText, setTimer: setTimer };
})();
