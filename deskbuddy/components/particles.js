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

    var p = document.createElement('div');
    p.className = 'particle particle-' + type;

    // Random position near the center of the viewport
    p.style.left = (45 + Math.random() * 10) + '%';
    p.style.top = (40 + Math.random() * 20) + '%';

    // Random drift direction for the fade animation
    var driftX = (Math.random() - 0.5) * 40;
    var driftY = -(10 + Math.random() * 30);
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
   * Spawn rates are kept low for performance.
   */
  function update(emotion) {
    if (!container) return;

    var rate;
    switch (emotion) {
      case 'focused': rate = 0.015; break;
      case 'happy':   rate = 0.03;  break;
      case 'curious': rate = 0.02;  break;
      case 'sleepy':  rate = 0.008; break;
      default:        rate = 0.005; break;
    }

    if (Math.random() < rate) {
      spawn(emotion || 'idle');
    }
  }

  return { init: init, update: update };
})();
