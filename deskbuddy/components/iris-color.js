/**
 * IrisColor — custom iris + glow colour support.
 * Keeps iris recolouring on the existing `.eye::before` layer (no extra DOM layer).
 */
const IrisColor = (() => {
  // 12-stop curve mirrors the default iris layering: darker/saturated center → soft edge ring.
  const IRIS_STOP_PCTS = [0, 8, 18, 28, 38, 50, 62, 74, 84, 92, 97, 100];
  const IRIS_LIGHTNESS_DELTA = [-28, -22, -16, -10, -6, -1, 4, 10, 16, 24, 30, 34];
  const IRIS_SAT_MULT = [1.18, 1.14, 1.10, 1.06, 1.02, 1.00, 0.94, 0.88, 0.80, 0.70, 0.58, 0.48];

  let irisStyleEl = null;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function normalizeHex(hex) {
    if (typeof hex !== 'string') return '';
    const raw = hex.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw)) return '';
    if (raw.length === 3) {
      return '#' + raw.split('').map(ch => ch + ch).join('').toLowerCase();
    }
    return `#${raw.toLowerCase()}`;
  }

  function hexToRgb(hex) {
    const clean = normalizeHex(hex).replace('#', '');
    if (!clean) return [0, 0, 0];
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

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

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
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
      Math.round(clamp(x * 255, 0, 255)).toString(16).padStart(2, '0')
    ).join('');
  }

  function deriveIrisGradient(hex) {
    const normalized = normalizeHex(hex);
    if (!normalized) {
      return {
        center: '#7b8bd8',
        mid: '#9aa4de',
        edge: '#cccfe9',
        stops: ['#7b8bd8', '#8190d9', '#8795db', '#8d9adc', '#949fdd', '#9aa4de', '#a0aae0', '#a8b0e2', '#b2b9e3', '#bec3e6', '#cccfe9', '#dcdde8'],
      };
    }

    const [r, g, b] = hexToRgb(normalized);
    const [h, s, l] = rgbToHsl(r, g, b);
    const baseSat = clamp(s, 20, 82);
    const baseLight = clamp(l, 34, 66);

    const stops = IRIS_STOP_PCTS.map((_, i) => {
      const sat = clamp(baseSat * IRIS_SAT_MULT[i], 10, 98);
      const light = clamp(baseLight + IRIS_LIGHTNESS_DELTA[i], 14, 92);
      return hslToHex(h, sat, light);
    });

    return {
      center: stops[0],
      mid: normalized,
      edge: stops[10],
      stops,
    };
  }

  function buildIrisGradient(stops) {
    const lines = stops.map((color, i) => `          ${color} ${IRIS_STOP_PCTS[i]}%`);
    return `radial-gradient(
          circle at calc(50% + var(--gaze-x, 0%)) calc(50% + var(--gaze-y, 0%)),
${lines.join(',\n')}
        )`;
  }

  function getIrisStyleEl() {
    if (!irisStyleEl) {
      irisStyleEl = document.createElement('style');
      irisStyleEl.id = 'iris-color-dynamic';
      document.head.appendChild(irisStyleEl);
    }
    return irisStyleEl;
  }

  function applyIris(hex) {
    const normalized = normalizeHex(hex);
    if (!normalized) { clearIris(); return; }

    const { center, mid, edge, stops } = deriveIrisGradient(normalized);
    getIrisStyleEl().textContent = `
      body.eye-custom .eye::before {
        background: ${buildIrisGradient(stops)} !important;
        filter: none !important;
        transition: background 0.25s ease !important;
      }
    `;

    document.body.style.setProperty('--iris-color-center', center);
    document.body.style.setProperty('--iris-color-mid', mid);
    document.body.style.setProperty('--iris-color-edge', edge);
    document.body.classList.add('eye-custom');
  }

  function clearIris() {
    if (irisStyleEl) irisStyleEl.textContent = '';
    document.body.classList.remove('eye-custom');
    document.body.style.removeProperty('--iris-color-center');
    document.body.style.removeProperty('--iris-color-mid');
    document.body.style.removeProperty('--iris-color-edge');
  }

  function applyGlow(hex) {
    const normalized = normalizeHex(hex);
    if (!normalized) { clearGlow(); return; }
    const [r, g, b] = hexToRgb(normalized);
    const triplet = `${r}, ${g}, ${b}`;
    document.body.style.setProperty('--eye-glow-rgb', triplet);
    document.body.style.setProperty('--user-glow-rgb', triplet);
    document.body.classList.add('glow-custom');
  }

  function clearGlow() {
    document.body.classList.remove('glow-custom');
    document.body.style.removeProperty('--eye-glow-rgb');
    document.body.style.removeProperty('--user-glow-rgb');
  }

  function setEmotionSync(enabled) {
    document.body.classList.toggle('glow-emotion-lock', !!enabled);
  }

  function getCurrentIrisHex() {
    return document.body.style.getPropertyValue('--iris-color-mid').trim() || '';
  }

  function getCustomGlowHex() {
    const triplet = document.body.style.getPropertyValue('--eye-glow-rgb').trim();
    if (!triplet) return '';
    const parts = triplet.split(',').map(s => parseInt(s.trim(), 10));
    if (parts.length !== 3 || parts.some(isNaN)) return '';
    return '#' + parts.map(x => clamp(x, 0, 255).toString(16).padStart(2, '0')).join('');
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
