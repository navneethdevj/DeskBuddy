/**
 * Particle system for emotional effects.
 * Spawns lightweight DOM particles near the companion that fade out.
 * Particle type varies by current emotion state.
 */
const Particles = (() => {
  const MAX_PARTICLES = 15;
  let container = null;
  let particles = [];

  /**
   * Create the particle container inside the given parent element.
   */
  function init(parentEl) {
    container = document.createElement('div');
    container.className = 'particles-container';
    parentEl.appendChild(container);
  }

  /**
   * Spawn a single particle of the given emotion type.
   */
  function spawn(type) {
    if (!container) return;
    if (particles.length >= MAX_PARTICLES) return;

    const p = document.createElement('div');
    p.className = 'particle particle-' + type;

    // Random position near the center of the viewport
    p.style.left = (45 + Math.random() * 10) + '%';
    p.style.top = (40 + Math.random() * 20) + '%';

    // Random drift direction for the fade animation
    const driftX = (Math.random() - 0.5) * 40;
    const driftY = -(10 + Math.random() * 30);
    p.style.setProperty('--drift-x', driftX + 'px');
    p.style.setProperty('--drift-y', driftY + 'px');

    container.appendChild(p);
    particles.push(p);

    // Remove after animation completes
    setTimeout(function () {
      if (p.parentNode) p.parentNode.removeChild(p);
      particles = particles.filter(function (item) { return item !== p; });
    }, 2000);
  }

  /**
   * Called each frame to occasionally spawn particles based on emotion.
   * Spawn rates are kept low for performance but increased for more visual feedback.
   */
  function update(emotion) {
    if (!container) return;

    var rate;
    switch (emotion) {
      case 'focused':    rate = 0.025; break;  // Increased from 0.015
      case 'happy':      rate = 0.045; break;  // Increased from 0.03
      case 'curious':    rate = 0.030; break;  // Increased from 0.02
      case 'sleepy':     rate = 0.012; break;  // Increased from 0.008
      case 'overjoyed':  rate = 0.06;  break;  // Increased from 0.04
      case 'scared':     rate = 0.028; break;  // Increased from 0.018
      case 'sad':        rate = 0.012; break;  // Increased from 0.008
      case 'crying':     rate = 0.018; break;  // Increased from 0.012
      case 'suspicious': rate = 0.012; break;  // Increased from 0.008
      case 'pouty':      rate = 0.015; break;  // Increased from 0.010
      case 'grumpy':     rate = 0.014; break;  // Increased from 0.010
      case 'sulking':    rate = 0.010; break;  // Increased from 0.006
      case 'excited':    rate = 0.065; break;  // Increased from 0.05
      case 'love':       rate = 0.050; break;  // Increased from 0.035
      case 'cozy':       rate = 0.038; break;  // Increased from 0.025
      case 'shy':        rate = 0.018; break;  // Increased from 0.012
      case 'startled':   rate = 0.035; break;  // Increased from 0.022
      case 'embarrassed':rate = 0.018; break;  // Increased from 0.012
      case 'forgiven':   rate = 0.030; break;  // Increased from 0.020
      default:           rate = 0.008; break;  // Increased from 0.005
    }

    if (Math.random() < rate) {
      spawn(emotion || 'idle');
    }
  }

  /**
   * Immediately spawn N particles of the given type — used for burst reactions
   * (rapid-tap pet, overjoyed return, milestone, etc.)
   */
  function burst(type, count) {
    if (!container) return;
    const n = Math.min(count || 12, MAX_PARTICLES - particles.length);  // Increased default from 8 to 12
    for (var i = 0; i < n; i++) {
      // Small staggered delay so they don't all appear in the same frame
      (function (delay) {
        setTimeout(function () { spawn(type || 'happy'); }, delay);
      })(i * 30);  // Reduced delay from 40 to 30 for snappier burst effect
    }
  }

  return { init: init, update: update, spawn: spawn, burst: burst };
})();
