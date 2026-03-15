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

  /**
   * Phase 3: Spawn sparkle particles near the eye area.
   * Used for Overjoyed emotion transitions.
   * @param {number} count - Number of sparkles to spawn (from pool of 12)
   */
  function spawnSparkles(count) {
    if (!container) return;
    var shapes = ['✦', '•', '+', '—'];
    var colors = ['#FFFFFF', '#FFE89A', '#FFB8D0'];
    var toSpawn = Math.min(count || 12, 12);

    for (var i = 0; i < toSpawn; i++) {
      if (particles.length >= MAX_PARTICLES) break;

      var p = document.createElement('div');
      p.className = 'particle particle-sparkle';
      p.textContent = shapes[Math.floor(Math.random() * shapes.length)];

      var size = 3 + Math.random() * 2; // 3-5px
      p.style.fontSize = size + 'px';
      p.style.color = colors[Math.floor(Math.random() * colors.length)];
      p.style.lineHeight = '1';
      p.style.textAlign = 'center';

      // Position near eye area (center of viewport)
      p.style.left = (42 + Math.random() * 16) + '%';
      p.style.top = (35 + Math.random() * 20) + '%';

      // Upward arc + horizontal spread
      var driftX = (Math.random() - 0.5) * 60;
      var driftY = -(20 + Math.random() * 40);
      p.style.setProperty('--drift-x', driftX + 'px');
      p.style.setProperty('--drift-y', driftY + 'px');

      // Use sparkle-specific fade animation (900ms)
      p.style.animation = 'particleFadeSparkle 0.9s ease-out forwards';

      container.appendChild(p);
      particles.push(p);

      // Remove after animation
      (function (el) {
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
          particles = particles.filter(function (item) { return item !== el; });
        }, 900);
      })(p);
    }
  }

  return { init: init, update: update, spawnSparkles: spawnSparkles };
})();
