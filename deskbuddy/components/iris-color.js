/**
 * IrisColor — custom hex colour support for iris + glow, and emotion-glow sync.
 *
 * Architecture
 * ─────────────
 * Iris  → CSS vars --iris-color-center / --iris-color-mid / --iris-color-edge
 *         activated by body.eye-custom   (overrides hue-rotate presets)
 *
 * Glow  → CSS var  --eye-glow-rgb (RGB triplet, e.g. "200, 120, 255")
 *         also stores --user-glow-rgb so emotion overrides can restore it
 *
 * Sync  → body.glow-emotion-lock = emotion CSS rules allowed to change glow
 *         (class present = sync ON; absent = sync OFF, glow stays user colour)
 *
 * Usage
 * ─────
 *   IrisColor.applyIris('#ff80aa')   // custom hex → iris gradient
 *   IrisColor.clearIris()            // revert to preset swatch class
 *   IrisColor.applyGlow('#7b8bd8')   // custom hex → glow RGB var
 *   IrisColor.clearGlow()            // revert to preset swatch class
 *   IrisColor.setEmotionSync(true)   // enable / disable emotion glow overrides
 */
const IrisColor = (() => {

  // ── Colour math helpers ───────────────────────────────────────────────────

  /** Parse hex "#rrggbb" → [r, g, b] (0–255). */
  function hexToRgb(hex) {
    const clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
      return [
        parseInt(clean[0] + clean[0], 16),
        parseInt(clean[1] + clean[1], 16),
        parseInt(clean[2] + clean[2], 16),
      ];
    }
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

  /** [r, g, b] (0–255) → [h, s, l] (degrees, %, %). */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h * 360, s * 100, l * 100];
  }

  /** [h (°), s (%), l (%)] → "#rrggbb". */
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;   // normalise
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return '#' + [r, g, b].map(x =>
      Math.round(Math.min(255, Math.max(0, x * 255))).toString(16).padStart(2, '0')
    ).join('');
  }

  /**
   * deriveIrisGradient(hex)
   * Given a midpoint colour, returns { center, mid, edge } for the iris gradient:
   *   center — darker, more saturated (deep focal point)
   *   mid    — the chosen colour itself
   *   edge   — lighter, desaturated limbal ring
   */
  function deriveIrisGradient(hex) {
    const [r, g, b] = hexToRgb(hex);
    const [h, s, l] = rgbToHsl(r, g, b);

    const center = hslToHex(h, Math.min(100, s * 1.25),  Math.max(22, l * 0.72));
    const mid    = hex;
    const edge   = hslToHex(h, Math.max(8,  s * 0.42),  Math.min(94, l * 1.42));

    return { center, mid, edge };
  }

  // ── Injected <style> tag for custom iris (avoids CSS specificity battles) ──
  let _irisStyleEl = null;

  function _getIrisStyleEl() {
    if (!_irisStyleEl) {
      _irisStyleEl = document.createElement('style');
      _irisStyleEl.id = 'iris-color-dynamic';
      document.head.appendChild(_irisStyleEl);
    }
    return _irisStyleEl;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * applyIris(hex)
   * Injects a <style> tag with the highest-cascade iris gradient rule.
   * This reliably overrides all preset classes and emotion tint rules.
   */
  function applyIris(hex) {
    if (!hex) { clearIris(); return; }
    const { center, mid, edge } = deriveIrisGradient(hex);

    // Inject dynamic CSS — runs after the external stylesheet so it wins cascade.
    // High-specificity selector + !important covers all emotion-tint overrides.
    _getIrisStyleEl().textContent = `
      body .companion .eye::before {
        background: radial-gradient(
          circle at calc(50% + var(--gaze-x, 0%)) calc(50% + var(--gaze-y, 0%)),
          ${center}  0%,
          ${center} 10%,
          ${mid}    48%,
          ${edge}   90%,
          ${edge}  100%
        ) !important;
        filter: none !important;
        transition: none !important;
      }
    `;

    // Also set CSS vars (used by being_patted override which re-sets a pink gradient)
    document.body.style.setProperty('--iris-color-center', center);
    document.body.style.setProperty('--iris-color-mid',    mid);
    document.body.style.setProperty('--iris-color-edge',   edge);
    document.body.classList.add('eye-custom');
  }

  /**
   * clearIris()
   * Remove custom iris — preset swatch CSS class takes over again.
   */
  function clearIris() {
    if (_irisStyleEl) _irisStyleEl.textContent = '';
    document.body.classList.remove('eye-custom');
    document.body.style.removeProperty('--iris-color-center');
    document.body.style.removeProperty('--iris-color-mid');
    document.body.style.removeProperty('--iris-color-edge');
  }

  /**
   * applyGlow(hex)
   * Set custom glow colour by converting hex → RGB triplet for --eye-glow-rgb.
   * Also stores --user-glow-rgb so emotion animations can reference the base.
   */
  function applyGlow(hex) {
    if (!hex) { clearGlow(); return; }
    const [r, g, b] = hexToRgb(hex);
    const triplet = `${r}, ${g}, ${b}`;
    document.body.style.setProperty('--eye-glow-rgb',  triplet);
    document.body.style.setProperty('--user-glow-rgb', triplet);  // preserve base
    document.body.classList.add('glow-custom');
  }

  /**
   * clearGlow()
   * Remove custom glow — body.eye-glow-* preset class takes over.
   */
  function clearGlow() {
    document.body.classList.remove('glow-custom');
    document.body.style.removeProperty('--eye-glow-rgb');
    document.body.style.removeProperty('--user-glow-rgb');
  }

  /**
   * setEmotionSync(enabled)
   * Toggle whether emotion states are allowed to override eye-wrap glow.
   * true  = body.glow-emotion-lock present  → emotion CSS rules fire
   * false = class absent                    → user colour stays on all emotions
   */
  function setEmotionSync(enabled) {
    document.body.classList.toggle('glow-emotion-lock', !!enabled);
  }

  /**
   * getCurrentIrisHex()
   * Returns the stored iris CSS var midpoint colour, or '' if none set.
   */
  function getCurrentIrisHex() {
    return document.body.style.getPropertyValue('--iris-color-mid').trim() || '';
  }

  /**
   * hexFromGlowRgb()
   * Attempts to reconstruct a hex from --eye-glow-rgb if set by custom picker.
   */
  function getCustomGlowHex() {
    const triplet = document.body.style.getPropertyValue('--eye-glow-rgb').trim();
    if (!triplet) return '';
    const parts = triplet.split(',').map(s => parseInt(s.trim(), 10));
    if (parts.length !== 3 || parts.some(isNaN)) return '';
    return '#' + parts.map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  }

  return {
    applyIris,
    clearIris,
    applyGlow,
    clearGlow,
    setEmotionSync,
    deriveIrisGradient,
    hexToRgb,
    getCurrentIrisHex,
    getCustomGlowHex,
  };
})();
