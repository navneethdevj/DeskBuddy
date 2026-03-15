/**
 * Emotion system for the companion.
 * Defines emotion states, applies CSS classes, and manages expression transitions.
 */
const Emotion = (() => {
  const STATES = [
    'idle', 'curious', 'focused', 'sleepy', 'suspicious', 'happy',
    'scared', 'sad', 'crying', 'embarrassed', 'pouty', 'grumpy',
    'overjoyed', 'sulking', 'forgiven'
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
      // Set data-emotion attribute for CSS selectors
      element.setAttribute('data-emotion', state);
    } else {
      currentState = null;
      element.removeAttribute('data-emotion');
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
  let lastEmotionChangeTime = Date.now();
  const emotionCooldownMs = 3000;

  /**
   * Emotion visual configurations for each state.
   * Used by Companion to drive cheeks, eyelids, pupil size, eyebrows.
   * Includes pupilLerpSpeed, blinkRateMs, glowColor, glowDuration for full Phase 3 spec.
   */
  const EMOTION_CONFIGS = {
    happy:       { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.070, cheekTarget: 0.20, topLidTarget: 8,  bottomLidTarget: 0,  floatAmpMult: 1.15, floatSpeedMult: 1.0, blinkRateMs: [3000, 5000], blinkDescentSpeed: 0.25, blinkHoldMs: 50, blinkRiseSpeed: 0.18, glowColor: 'rgba(255,228,192,{opacity})', glowDuration: 4000, showEyebrows: false, eyebrowOpacity: 0 },
    curious:     { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.040, cheekTarget: 0.14, topLidTarget: 4,  bottomLidTarget: 0,  floatAmpMult: 0.85, floatSpeedMult: 1.0, blinkRateMs: [2000, 4000], blinkDescentSpeed: 0.30, blinkHoldMs: 40, blinkRiseSpeed: 0.22, glowColor: 'rgba(192,228,255,{opacity})', glowDuration: 1000, showEyebrows: false, eyebrowOpacity: 0 },
    focused:     { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.060, cheekTarget: 0.10, topLidTarget: 6,  bottomLidTarget: 0,  floatAmpMult: 0.90, floatSpeedMult: 1.0, blinkRateMs: [3000, 5000], blinkDescentSpeed: 0.25, blinkHoldMs: 50, blinkRiseSpeed: 0.18, glowColor: 'rgba(180,200,240,{opacity})', glowDuration: 3500, showEyebrows: false, eyebrowOpacity: 0 },
    idle:        { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.050, cheekTarget: 0.0,  topLidTarget: 8,  bottomLidTarget: 0,  floatAmpMult: 1.0,  floatSpeedMult: 1.0, blinkRateMs: [3000, 5000], blinkDescentSpeed: 0.25, blinkHoldMs: 50, blinkRiseSpeed: 0.18, glowColor: 'rgba(200,210,240,{opacity})', glowDuration: 4000, showEyebrows: false, eyebrowOpacity: 0 },
    sleepy:      { pupilSize: { w: 11, h: 11 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.028, cheekTarget: 0.10, topLidTarget: 42, bottomLidTarget: 0,  floatAmpMult: 0.60, floatSpeedMult: 0.45, blinkRateMs: [9000, 13000], blinkDescentSpeed: 0.10, blinkHoldMs: 200, blinkRiseSpeed: 0.07, glowColor: 'rgba(212,204,244,{opacity})', glowDuration: 6000, showEyebrows: false, eyebrowOpacity: 0 },
    embarrassed: { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.070, cheekTarget: 0.55, topLidTarget: 0,  bottomLidTarget: 0,  floatAmpMult: 1.0,  floatSpeedMult: 1.0, blinkRateMs: [80, 80], blinkDescentSpeed: 0.50, blinkHoldMs: 20, blinkRiseSpeed: 0.45, isInstantTrigger: true, glowColor: 'rgba(255,180,196,{opacity})', glowDuration: 800, showEyebrows: false, eyebrowOpacity: 0, resolveAfterMs: 4000, resolveToEmotion: 'happy' },
    suspicious:  { pupilSize: { w: 14, h: 10 }, pupilScaleX: 0.72, pupilLerpSpeed: 0.070, cheekTarget: 0.11, topLidTarget: 22, bottomLidTarget: 18, floatAmpMult: 0.40, floatSpeedMult: 1.0, blinkRateMs: [6000, 9000], blinkDescentSpeed: 0.15, blinkHoldMs: 120, blinkRiseSpeed: 0.12, glowColor: 'rgba(240,216,136,{opacity})', glowDuration: 1000, showEyebrows: false, eyebrowOpacity: 0 },
    pouty:       { pupilSize: { w: 14, h: 10 }, pupilScaleX: 0.72, pupilLerpSpeed: 0.070, cheekTarget: 0.14, topLidTarget: 25, bottomLidTarget: 0,  floatAmpMult: 0.40, floatSpeedMult: 1.0, blinkRateMs: [5000, 8000], blinkDescentSpeed: 0.14, blinkHoldMs: 150, blinkRiseSpeed: 0.11, glowColor: 'rgba(255,208,160,{opacity})', glowDuration: 3500, showEyebrows: true,  eyebrowOpacity: 0.65 },
    grumpy:      { pupilSize: { w: 14, h: 10 }, pupilScaleX: 0.72, pupilLerpSpeed: 0.055, cheekTarget: 0.18, topLidTarget: 30, bottomLidTarget: 12, floatAmpMult: 0.40, floatSpeedMult: 1.0, blinkRateMs: [10000, 14000], blinkDescentSpeed: 0.12, blinkHoldMs: 180, blinkRiseSpeed: 0.10, glowColor: 'rgba(255,176,168,{opacity})', glowDuration: 2500, showEyebrows: true,  eyebrowOpacity: 0.85, gazeLocked: true },
    scared:      { pupilSize: { w: 18, h: 18 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.220, cheekTarget: 0.08, topLidTarget: 0,  bottomLidTarget: 0,  floatAmpMult: 1.0,  floatSpeedMult: 1.0, floatJitter: 3, blinkRateMs: [1000, 2000], blinkDescentSpeed: 0.40, blinkHoldMs: 30, blinkRiseSpeed: 0.35, isInstantTrigger: true, glowColor: 'rgba(228,242,255,{opacity})', glowDuration: 800, showEyebrows: false, eyebrowOpacity: 0 },
    sad:         { pupilSize: { w: 11, h: 11 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.020, cheekTarget: 0.09, topLidTarget: 28, bottomLidTarget: 0,  floatAmpMult: 0.35, floatSpeedMult: 1.0, blinkRateMs: [6000, 9000], blinkDescentSpeed: 0.13, blinkHoldMs: 130, blinkRiseSpeed: 0.09, glowColor: 'rgba(168,200,232,{opacity})', glowDuration: 1000, showEyebrows: false, eyebrowOpacity: 0, showTeardrops: true },
    crying:      { pupilSize: { w: 11, h: 11 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.020, cheekTarget: 0.07, topLidTarget: 33, bottomLidTarget: 0,  floatAmpMult: 0.15, floatSpeedMult: 0.30, blinkRateMs: [10000, 13000], blinkDescentSpeed: 0.10, blinkHoldMs: 200, blinkRiseSpeed: 0.07, glowColor: 'rgba(136,176,212,{opacity})', glowDuration: 1000, showEyebrows: false, eyebrowOpacity: 0, showTeardrops: true, showTearOverlay: true },
    overjoyed:   { pupilSize: { w: 18, h: 18 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.160, cheekTarget: 0.45, topLidTarget: 0,  bottomLidTarget: 0,  floatAmpMult: 1.80, floatSpeedMult: 1.60, blinkRateMs: [60, 100], blinkDescentSpeed: 0.45, blinkHoldMs: 20, blinkRiseSpeed: 0.40, isInstantTrigger: true, sparkleSpawn: 12, glowColor: 'rgba(255,244,220,{opacity})', glowDuration: 1000, showEyebrows: false, eyebrowOpacity: 0, resolveAfterMs: 6000, resolveToEmotion: 'sulking' },
    sulking:     { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.070, cheekTarget: 0.22, topLidTarget: 18, bottomLidTarget: 10, floatAmpMult: 0.35, floatSpeedMult: 1.0, blinkRateMs: [8000, 11000], blinkDescentSpeed: 0.14, blinkHoldMs: 160, blinkRiseSpeed: 0.11, glowColor: 'rgba(224,168,196,{opacity})', glowDuration: 2000, showEyebrows: false, eyebrowOpacity: 0 },
    forgiven:    { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.070, cheekTarget: 0.20, topLidTarget: 8,  bottomLidTarget: 0,  floatAmpMult: 1.15, floatSpeedMult: 1.0, blinkRateMs: [3000, 5000], blinkDescentSpeed: 0.25, blinkHoldMs: 50, blinkRiseSpeed: 0.18, glowColor: 'rgba(255,228,192,{opacity})', glowDuration: 8000, showEyebrows: false, eyebrowOpacity: 0, transitionDuration: 8000, transitionToEmotion: 'happy' }
  };
  const DEFAULT_CONFIG = { pupilSize: { w: 14, h: 14 }, pupilScaleX: 1.0, pupilLerpSpeed: 0.050, cheekTarget: 0, topLidTarget: 8, bottomLidTarget: 0, floatAmpMult: 1.0, floatSpeedMult: 1.0, blinkRateMs: [3000, 5000], blinkDescentSpeed: 0.25, blinkHoldMs: 50, blinkRiseSpeed: 0.18, showEyebrows: false, eyebrowOpacity: 0 };

  /**
   * Get the current emotion name (alias for getState for Phase 3 compatibility).
   */
  function getEmotion() {
    return currentState;
  }

  /**
   * Get milliseconds since last emotion transition.
   */
  function getTimeSinceTransition() {
    return Date.now() - lastEmotionChangeTime;
  }

  /**
   * Attempt to transition to a new emotion.
   * @param {string} emotion - Target emotion name (lowercase)
   * @param {boolean} instant - If true, bypass cooldown (for Embarrassed, Scared, Overjoyed)
   * @returns {boolean} True if transition succeeded
   */
  function transitionTo(emotion, instant) {
    if (!EMOTION_CONFIGS[emotion]) return false;
    if (emotion === currentState) return false;

    var timeSinceChange = getTimeSinceTransition();
    if (!instant && timeSinceChange < emotionCooldownMs) {
      return false;
    }

    setState(emotion);
    lastEmotionChangeTime = Date.now();

    // Update DOM data-emotion attribute for CSS glow animations
    if (element) {
      element.setAttribute('data-emotion', emotion);
    }

    return true;
  }

  /**
   * Start the emotion evaluation loop.
   * Called by Brain after initialization.
   * Evaluates triggers every 2000ms and tracks emotion-derived state flags.
   */
  function startEmotionEngine(brainGetState, brainGetFocusLevel) {
    if (emotionEvaluationInterval) return;
    emotionEvaluationInterval = setInterval(function () {
      var state = window.DeskBuddyState;
      if (!state) return;
      var emo = currentState;
      state.wasInCryingOrSad = (emo === 'crying' || emo === 'sad');
      state.wasRecentlyAngry = (emo === 'grumpy' || emo === 'sulking');

      // Evaluate emotion triggers based on brain state and durations
      evaluateEmotionTriggers(brainGetState, brainGetFocusLevel);
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
   * Core emotion trigger evaluation logic.
   * Called every 2000ms from startEmotionEngine interval.
   * Respects 3000ms cooldown between transitions.
   * Instant emotions (embarrassed, scared, overjoyed) bypass cooldown.
   */
  function evaluateEmotionTriggers(brainGetState, brainGetFocusLevel) {
    var dbs = window.DeskBuddyState;
    if (!dbs) return;

    var pState = window.perception ? window.perception.userState : '';
    var stillDurationMs = dbs.userStillMs || 0;
    var lookingAwayDurationMs = dbs.lookingAwayMs || 0;
    var noFaceDurationMs = dbs.noFaceMs || 0;

    // === INSTANT EMOTIONS (bypass 3s cooldown) ===

    if (dbs.triggerEmbarrassed) {
      if (transitionTo('embarrassed', true)) {
        if (typeof Companion !== 'undefined' && Companion.playEmbarrassedShudder) {
          Companion.playEmbarrassedShudder();
        }
        dbs.triggerEmbarrassed = false;
        dbs.embarrassedCount = (dbs.embarrassedCount || 0) + 1;
      }
      return;
    }

    if (pState === 'NoFace' && noFaceDurationMs >= 5000 && currentState !== 'scared' && currentState !== 'sad' && currentState !== 'crying') {
      transitionTo('scared', true);
      return;
    }

    if (dbs.wasInCryingOrSad && pState === 'Focused') {
      if (transitionTo('overjoyed', true)) {
        if (typeof Companion !== 'undefined' && Companion.playOverjoyedSequence) {
          Companion.playOverjoyedSequence();
        }
        if (typeof Particles !== 'undefined' && Particles.spawnSparkles) {
          Particles.spawnSparkles(12);
        }
        dbs.wasInCryingOrSad = false;
      }
      return;
    }

    // === REGULAR EMOTIONS (3s cooldown) ===

    // Sleepy: still for 60s+
    if (stillDurationMs >= 60000) {
      transitionTo('sleepy');
      return;
    }

    // Suspicious: LookingAway < 45s
    if (pState === 'LookingAway' && lookingAwayDurationMs < 45000) {
      transitionTo('suspicious');
      return;
    }

    // Pouty: LookingAway 45–90s
    if (pState === 'LookingAway' && lookingAwayDurationMs >= 45000 && lookingAwayDurationMs < 90000) {
      transitionTo('pouty');
      return;
    }

    // Grumpy: LookingAway 90s+
    if (pState === 'LookingAway' && lookingAwayDurationMs >= 90000) {
      transitionTo('grumpy');
      return;
    }

    // Sad: NoFace 30–45s
    if (pState === 'NoFace' && noFaceDurationMs >= 30000 && noFaceDurationMs < 45000) {
      transitionTo('sad');
      return;
    }

    // Crying: NoFace > 45s
    if (pState === 'NoFace' && noFaceDurationMs >= 45000) {
      if (transitionTo('crying')) {
        showTearOverlay();
      }
      return;
    }

    // Sulking: after Overjoyed sequence expires
    if (currentState === 'overjoyed' && getTimeSinceTransition() > 6000) {
      transitionTo('sulking');
      return;
    }

    // Forgiven: Focused for required duration after negative emotions
    var forgivenThreshold = dbs.wasRecentlyAngry ? 15000 : 10000;
    if (pState === 'Focused' && getTimeSinceTransition() > forgivenThreshold &&
        (currentState === 'sulking' || currentState === 'grumpy' || currentState === 'suspicious')) {
      transitionTo('forgiven');
      return;
    }

    // Curious: Focused + still for 10s+
    if (pState === 'Focused' && stillDurationMs >= 10000 && currentState !== 'curious') {
      transitionTo('curious');
      return;
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

  /**
   * Show tear overlay (for crying emotion).
   */
  function showTearOverlay() {
    var overlay = document.getElementById('tear-overlay');
    if (overlay) {
      overlay.style.display = 'block';
      var tearFill = document.getElementById('tear-fill');
      if (tearFill) {
        tearFill.style.height = '0%';
        tearFill.style.transition = 'none';
        setTimeout(function () {
          tearFill.style.transition = 'height 120s linear';
          tearFill.style.height = '65%';
        }, 10);
      }
    }
  }

  /**
   * Hide tear overlay.
   */
  function hideTearOverlay() {
    var overlay = document.getElementById('tear-overlay');
    if (overlay) {
      var tearFill = document.getElementById('tear-fill');
      if (tearFill) {
        tearFill.style.transition = 'height 3s ease-out';
        tearFill.style.height = '0%';
        setTimeout(function () {
          overlay.style.display = 'none';
        }, 3000);
      }
    }
  }

  return {
    init, setState, getState, getStates,
    getEmotion, getTimeSinceTransition, transitionTo,
    getEmotionConfig, startEmotionEngine, stopEmotionEngine,
    evaluateEmotionTriggers, showTearOverlay, hideTearOverlay
  };
})();
