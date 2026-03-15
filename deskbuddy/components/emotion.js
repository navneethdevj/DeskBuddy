/**
 * Emotion system for the companion.
 * Defines emotion states, applies CSS classes, and manages expression transitions.
 */
const Emotion = (() => {
  const STATES = [
    'idle', 'curious', 'focused', 'sleepy', 'suspicious', 'happy',
    'scared', 'sad', 'crying', 'pouty', 'grumpy', 'overjoyed',
    'sulking', 'embarrassed', 'forgiven'
  ];
  let currentState = null;
  let element = null;

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

  return { init, setState, getState, getStates };
})();
