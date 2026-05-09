/**
 * IrisColor — custom iris + glow colour support.
 * Recolours the real central iris element (`.pupil`) with no extra DOM layers.
 */
const IrisColor = (() => {
  // 16 paired stops create softer layered depth for a cuter iris look:
  // - stop positions: where each shade band lands from center to rim
  // - lightness deltas: controlled brightening toward edge (avoids a white ring)
  // - saturation multipliers: gentle desaturation toward edge (prevents muddy banding)
  // Stop positions from iris center (0) to edge (100).
  const IRIS_STOP_PCTS = [0, 4, 8, 13, 19, 26, 34, 43, 53, 63, 73, 82, 89, 94, 98, 100];
  // Brightness ramp: gentle fade from rich core to soft edge.
  const IRIS_LIGHTNESS_DELTA = [-28, -24, -20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20, 23, 25, 27];
  // Saturation falloff: keeps hue identity while fading outward.
  const IRIS_SAT_MULT = [1.26, 1.22, 1.18, 1.14, 1.10, 1.06, 1.02, 1.00, 0.97, 0.94, 0.90, 0.86, 0.83, 0.80, 0.77, 0.74];
  const IRIS_CENTER_STOP_INDEX = 0;
  const IRIS_EDGE_STOP_INDEX = IRIS_STOP_PCTS.length - 2;
  const DEFAULT_IRIS_BASE_HEX = '#8795db';
  const MIN_IRIS_BASE_SATURATION = 30;
  const MAX_IRIS_BASE_SATURATION = 86;
  const MIN_IRIS_BASE_LIGHTNESS = 32;
  const MAX_IRIS_BASE_LIGHTNESS = 56;

  let irisStyleEl = null;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function normalizeHex(hex) {
    if (typeof hex !== 'string') return '';
    const raw = hex.trim().replace(/^#/, '');
    // We intentionally support only 3/6-digit RGB hex here (input type=color output);
    // alpha-bearing 4/8-digit forms are treated as invalid for iris rendering.
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

  function buildStopsFromHsl(h, satBase, lightBase) {
    return IRIS_STOP_PCTS.map((_stopPct, i) => {
      const sat = clamp(satBase * IRIS_SAT_MULT[i], 20, 98);
      const light = clamp(lightBase + IRIS_LIGHTNESS_DELTA[i], 16, 78);
      return hslToHex(h, sat, light);
    });
  }

  function deriveIrisGradient(hex) {
    const normalized = normalizeHex(hex);
    if (!normalized) {
      const [r, g, b] = hexToRgb(DEFAULT_IRIS_BASE_HEX);
      const [h, s, l] = rgbToHsl(r, g, b);
      const satBase = clamp(s, MIN_IRIS_BASE_SATURATION, MAX_IRIS_BASE_SATURATION);
      const lightBase = clamp(l, MIN_IRIS_BASE_LIGHTNESS, MAX_IRIS_BASE_LIGHTNESS);
      const stops = buildStopsFromHsl(h, satBase, lightBase);
      return {
        center: stops[IRIS_CENTER_STOP_INDEX],
        mid: DEFAULT_IRIS_BASE_HEX,
        edge: stops[IRIS_EDGE_STOP_INDEX],
        stops,
      };
    }

    const [r, g, b] = hexToRgb(normalized);
    const [h, s, l] = rgbToHsl(r, g, b);
    // Clamp source colour into a "safe iris palette" band so edge stops stay coloured
    // and do not bleach into a fake middle layer between iris and sclera.
    const baseSat = clamp(s, MIN_IRIS_BASE_SATURATION, MAX_IRIS_BASE_SATURATION);
    const baseLight = clamp(l, MIN_IRIS_BASE_LIGHTNESS, MAX_IRIS_BASE_LIGHTNESS);
    const stops = buildStopsFromHsl(h, baseSat, baseLight);

    return {
      center: stops[IRIS_CENTER_STOP_INDEX],
      mid: normalized,
      edge: stops[IRIS_EDGE_STOP_INDEX],
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

  function buildIrisBackground(stops) {
    const spark = hexToRgb(stops[Math.min(5, stops.length - 1)]);
    const ring = hexToRgb(stops[Math.min(8, stops.length - 1)]);
    const rim = hexToRgb(stops[Math.max(0, stops.length - 2)]);
    return `
        radial-gradient(
          circle at 33% 30%,
          rgba(255, 255, 255, 0.58) 0%,
          rgba(255, 255, 255, 0.34) 10%,
          rgba(255, 255, 255, 0.14) 20%,
          rgba(255, 255, 255, 0) 40%
        ),
        radial-gradient(
          circle at 68% 74%,
          rgba(${spark[0]}, ${spark[1]}, ${spark[2]}, 0.26) 0%,
          rgba(${spark[0]}, ${spark[1]}, ${spark[2]}, 0.14) 18%,
          rgba(${spark[0]}, ${spark[1]}, ${spark[2]}, 0) 44%
        ),
        radial-gradient(
          circle at 50% 50%,
          rgba(${ring[0]}, ${ring[1]}, ${ring[2]}, 0) 30%,
          rgba(${ring[0]}, ${ring[1]}, ${ring[2]}, 0.12) 48%,
          rgba(${ring[0]}, ${ring[1]}, ${ring[2]}, 0.20) 58%,
          rgba(${ring[0]}, ${ring[1]}, ${ring[2]}, 0) 74%
        ),
        ${buildIrisGradient(stops)},
        radial-gradient(
          circle at 50% 50%,
          rgba(14, 18, 34, 0) 58%,
          rgba(${rim[0]}, ${rim[1]}, ${rim[2]}, 0.22) 82%,
          rgba(10, 12, 26, 0.46) 100%
        )
    `;
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
      body.eye-custom .pupil {
        background: ${buildIrisBackground(stops)} !important;
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
