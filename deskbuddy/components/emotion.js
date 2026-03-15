/**
 * Emotion system for the companion.
 * Defines emotion states, applies CSS classes, and manages expression transitions.
 */
const Emotion = (() => {
  const STATES = [
    'idle', 'curious', 'focused', 'sleepy', 'suspicious', 'happy',
    'scared', 'sad', 'crying', 'embarrassed', 'pouty', 'grumpy',
    'overjoyed', 'sulking'
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

  // ===== PHASE 3: Emotion Engine =====
  let emotionEvaluationInterval = null;

  /**
   * Emotion visual configurations for each state.
   * Used by Companion to drive cheeks, eyelids, pupil size, eyebrows.
   */
  const EMOTION_CONFIGS = {
    happy:       { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, cheekTarget: 0.20, topLidTarget: 8,  bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    curious:     { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, cheekTarget: 0.14, topLidTarget: 4,  bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    focused:     { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, cheekTarget: 0.10, topLidTarget: 6,  bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    idle:        { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, cheekTarget: 0.0,  topLidTarget: 8,  bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    sleepy:      { pupilSize: { w: 11, h: 11 }, pupilScaleX: 1.0, cheekTarget: 0.10, topLidTarget: 42, bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    embarrassed: { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, cheekTarget: 0.55, topLidTarget: 0,  bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    suspicious:  { pupilSize: { w: 14, h: 10 }, pupilScaleX: 0.72, cheekTarget: 0.11, topLidTarget: 22, bottomLidTarget: 18, showEyebrows: false, eyebrowOpacity: 0 },
    pouty:       { pupilSize: { w: 14, h: 10 }, pupilScaleX: 0.72, cheekTarget: 0.14, topLidTarget: 25, bottomLidTarget: 0,  showEyebrows: true,  eyebrowOpacity: 0.65 },
    grumpy:      { pupilSize: { w: 14, h: 10 }, pupilScaleX: 0.72, cheekTarget: 0.18, topLidTarget: 30, bottomLidTarget: 12, showEyebrows: true,  eyebrowOpacity: 0.85 },
    scared:      { pupilSize: { w: 18, h: 18 }, pupilScaleX: 1.0, cheekTarget: 0.08, topLidTarget: 0,  bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    sad:         { pupilSize: { w: 11, h: 11 }, pupilScaleX: 1.0, cheekTarget: 0.09, topLidTarget: 28, bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    crying:      { pupilSize: { w: 11, h: 11 }, pupilScaleX: 1.0, cheekTarget: 0.07, topLidTarget: 33, bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    overjoyed:   { pupilSize: { w: 18, h: 18 }, pupilScaleX: 1.0, cheekTarget: 0.45, topLidTarget: 0,  bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 },
    sulking:     { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, cheekTarget: 0.22, topLidTarget: 18, bottomLidTarget: 10, showEyebrows: false, eyebrowOpacity: 0 },
    forgiven:    { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, cheekTarget: 0.20, topLidTarget: 8,  bottomLidTarget: 0,  showEyebrows: false, eyebrowOpacity: 0 }
  };
  const DEFAULT_CONFIG = { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, cheekTarget: 0, topLidTarget: 8, bottomLidTarget: 0, showEyebrows: false, eyebrowOpacity: 0 };

  /**
   * Get the current emotion name (alias for getState for Phase 3 compatibility).
   */
  function getEmotion() {
    return currentState;
  }

  /**
   * Start the emotion evaluation loop.
   * Called by Brain after initialization.
   * Tracks emotion-derived state flags every 2000ms.
   */
  function startEmotionEngine(brainGetState, brainGetFocusLevel) {
    if (emotionEvaluationInterval) return;
    emotionEvaluationInterval = setInterval(() => {
      const state = window.DeskBuddyState;
      if (!state) return;
      const emo = currentState;
      state.wasInCryingOrSad = (emo === 'crying' || emo === 'sad');
      state.wasRecentlyAngry = (emo === 'grumpy' || emo === 'sulking');
    }, 2000);
  }

  /**
   * Stop the emotion evaluation loop.
   */
  function stopEmotionEngine() {
    if (emotionEvaluationInterval) {
      clearInterval(emotionEvaluationInterval);
      emotionEvaluationInterval = null;
    }
  }

  /**
   * Get complete emotion configuration object for rendering.
   * @param {string} [emotion] - Emotion name, defaults to current state.
   * @returns {object} Config with pupilSize, cheekTarget, topLidTarget, etc.
   */
  function getEmotionConfig(emotion) {
    return EMOTION_CONFIGS[emotion || currentState] || DEFAULT_CONFIG;
  }

  return { init, setState, getState, getStates, getEmotion, getEmotionConfig, startEmotionEngine, stopEmotionEngine };
})();
