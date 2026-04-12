/**
 * Emotion system for the companion.
 * Defines emotion states, applies CSS classes, and manages expression transitions.
 */
const Emotion = (() => {
  const STATES = [
    'idle', 'curious', 'focused', 'sleepy', 'suspicious', 'happy',
    'scared', 'sad', 'crying', 'pouty', 'grumpy', 'overjoyed',
    'sulking', 'embarrassed', 'forgiven',
    // Personality-driven emotions — triggered by user interactions
    'excited',   // rapid typing / high energy input
    'shy',       // prolonged direct eye contact
    'love',      // click-to-pet interaction
    'startled',  // sudden large mouse jerk
    'cozy',      // long-press snuggle / being held
  ];
  let currentState = null;
  let element = null;
  let _previewActive = false;
  let _previewTimer  = null;

  /**
   * Bind the emotion system to a companion DOM element.
   */
  function init(companionEl) {
    element = companionEl;
  }

  /**
   * Set the companion's emotion state by swapping CSS classes.
   * Pass null to clear the expression.
   */
  function setState(state) {
    if (!element) return;
    if (_previewActive) return;   // brain cannot override during a preview
    if (state === currentState) return;

    // Remove previous state class
    if (currentState) {
      element.classList.remove(currentState);
    }

    // Apply new state class
    if (state && STATES.includes(state)) {
      element.classList.add(state);
      currentState = state;
    } else {
      currentState = null;
    }
  }

  /**
   * Return the current emotion state.
   */
  function getState() {
    return currentState;
  }

  /**
   * Return the list of available states.
   */
  function getStates() {
    return [...STATES];
  }

  /**
   * Temporarily force an emotion state for `durationMs` (default 3 s).
   * Brain and timer overrides are blocked until the preview expires.
   * Re-calling before the timer fires restarts the clock on the new state.
   * onDone() is called when the lock is released.
   */
  function preview(state, durationMs, onDone) {
    if (!element) return;
    clearTimeout(_previewTimer);
    _previewActive = true;

    // Force-apply even if same as currentState (re-preview same emotion)
    if (currentState) element.classList.remove(currentState);
    if (state && STATES.includes(state)) {
      element.classList.add(state);
      currentState = state;
    } else {
      currentState = null;
    }

    _previewTimer = setTimeout(() => {
      _previewActive = false;
      _previewTimer  = null;
      if (typeof onDone === 'function') onDone();
    }, durationMs || 3000);
  }

  return { init, setState, getState, getStates, preview };
})();
