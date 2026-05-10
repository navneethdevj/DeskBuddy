/**
 * IrisColor — custom iris + glow colour support.
 * Recolours the real central iris element (`.pupil`) with no extra DOM layers.
 *
 * Changes vs original:
 *  - buildStopsFromThreeColors: smootherstep easing → eliminates harsh banding
 *  - buildIrisBackground: softer limbal ring (0.08/0.14 vs 0.16/0.34) → no fake layer look
 *  - applyIrisProfile: exports --iris-color-inner-mid + --iris-color-outer-mid for richer CSS fallback
 *  - Partial layer overrides (only ring/highlight/pupilCore) no longer force 3-anchor mode,
 *    preserving smooth HSL ramp from base hex — was main "messes up" cause in original
 *  - Added getIrisProfile() for preset read-back / settings export
 *  - iris-border-width no longer multiplied by --iris-scale; border stays constant thickness
 */
const IrisColor = (() => {
  // 16 stop positions from iris center (0) to edge (100).
  const IRIS_STOP_PCTS = [0, 4, 8, 13, 19, 26, 34, 43, 53, 63, 73, 82, 89, 94, 98, 100];
  // Lightness ramp: darkening at core, brightening toward limbal edge.
  const IRIS_LIGHTNESS_DELTA = [-28, -24, -20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20, 23, 25, 27];
  // Saturation falloff: keeps hue identity while fading outward.
  const IRIS_SAT_MULT = [1.26, 1.22, 1.18, 1.14, 1.10, 1.06, 1.02, 1.00, 0.97, 0.94, 0.90, 0.86, 0.83, 0.80, 0.77, 0.74];

  const DEFAULT_IRIS_BASE_HEX = '#8795db';
  const MIN_IRIS_BASE_SATURATION = 30;
  const MAX_IRIS_BASE_SATURATION = 86;
  const MIN_IRIS_BASE_LIGHTNESS = 32;
  const MAX_IRIS_BASE_LIGHTNESS = 56;

  let irisStyleEl = null;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /** Smootherstep easing (Ken Perlin) — eliminates visible banding at stop boundaries */
  function smootherstep(t) {
    t = clamp(t, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function normalizeHex(hex) {
    if (typeof hex !== 'string') return '';
    const raw = hex.trim().replace(/^#/, '');
    if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return '';
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

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v =>
      Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
    ).join('');
  }

  /**
   * Mix two hex colours by ratio t (0=a, 1=b).
   * Uses smootherstep easing so transitions avoid flat zones and muddy midpoints.
   */
  function mixHex(a, b, t) {
    const te = smootherstep(t);
    const aa = hexToRgb(a);
    const bb = hexToRgb(b);
    return rgbToHex(
      aa[0] + (bb[0] - aa[0]) * te,
      aa[1] + (bb[1] - aa[1]) * te,
      aa[2] + (bb[2] - aa[2]) * te,
    );
  }

  function toRgbTriplet(hex, fallback) {
    const normalized = normalizeHex(hex);
    const rgb = normalized ? hexToRgb(normalized) : fallback;
    return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
  }

  // ── Stop builders ──────────────────────────────────────────────────────────

  function buildStopsFromHsl(h, satBase, lightBase) {
    return IRIS_STOP_PCTS.map((_stopPct, i) => {
      const sat = clamp(satBase * IRIS_SAT_MULT[i], 20, 98);
      const light = clamp(lightBase + IRIS_LIGHTNESS_DELTA[i], 16, 78);
      return hslToHex(h, sat, light);
    });
  }

  /**
   * Build stops from 3 anchor colours using smootherstep easing between zones.
   *
   * Previously used linear lerp → caused visible flat zones + muddy transitions.
   * Smootherstep S-curve: colour spends less time near boundaries, more near
   * each anchor → richer core, soft blending, no harsh band at split point.
   *
   * Split at 52% (slightly past midpoint) so core reads clearly without dominating.
   */
  function buildStopsFromThreeColors(centerHex, midHex, edgeHex) {
    const SPLIT = 52;
    return IRIS_STOP_PCTS.map((pct) => {
      if (pct <= SPLIT) {
        return mixHex(centerHex, midHex, pct / SPLIT);
      } else {
        return mixHex(midHex, edgeHex, (pct - SPLIT) / (100 - SPLIT));
      }
    });
  }

  // ── Core palette builder ───────────────────────────────────────────────────

  /**
   * Derive a full iris colour palette from a base hex + optional per-layer overrides.
   *
   * PARTIAL OVERRIDE FIX:
   *   Only use 3-anchor mode when center/mid/edge are overridden.
   *   Ring, highlight, pupilCore overrides apply ON TOP of the smooth HSL ramp.
   *   The original code triggered 3-anchor mode for ANY override, which caused
   *   harsh banding when only the ring or highlight colour was changed.
   */
  function deriveIrisGradient(hex, overrides = {}) {
    const normalized = normalizeHex(hex);
    const centerOverride    = normalizeHex(overrides.centerHex    || '');
    const midOverride       = normalizeHex(overrides.midHex       || '');
    const edgeOverride      = normalizeHex(overrides.edgeHex      || '');
    const ringOverride      = normalizeHex(overrides.ringHex      || '');
    const highlightOverride = normalizeHex(overrides.highlightHex || '');
    const pupilCoreOverride = normalizeHex(overrides.pupilCoreHex || '');

    // Only 3-anchor mode if gradient anchors are overridden, not accent-only overrides
    const hasGradientAnchorOverride = !!(centerOverride || midOverride || edgeOverride);

    const _build = (sourceMid, stops, h) => {
      const center = centerOverride || stops[0];
      const mid    = midOverride    || sourceMid;
      const edge   = edgeOverride   || stops[stops.length - 3]; // index 13

      const finalStops = hasGradientAnchorOverride
        ? buildStopsFromThreeColors(center, mid, edge)
        : stops;

      const innerMid = finalStops[6];           // ~34% — for CSS var export
      const outerMid = finalStops[10];           // ~73% — for CSS var export
      const ring      = ringOverride || finalStops[8];  // ~53% concentric accent
      const rim       = finalStops[finalStops.length - 3]; // index 13 — soft limbal edge
      const highlight = highlightOverride || finalStops[11]; // ~73% lighter stop
      const pupilCore = pupilCoreOverride || hslToHex(h, 42, 14);
      const pupilSheen = mixHex(highlight, '#ffffff', 0.32);

      return { center, mid, edge, innerMid, outerMid, stops: finalStops, rim, ring, highlight, pupilCore, pupilSheen };
    };

    if (!normalized) {
      const [r, g, b] = hexToRgb(DEFAULT_IRIS_BASE_HEX);
      const [h, s, l] = rgbToHsl(r, g, b);
      const satBase   = clamp(s, MIN_IRIS_BASE_SATURATION, MAX_IRIS_BASE_SATURATION);
      const lightBase = clamp(l, MIN_IRIS_BASE_LIGHTNESS,  MAX_IRIS_BASE_LIGHTNESS);
      const stops = buildStopsFromHsl(h, satBase, lightBase);
      return _build(DEFAULT_IRIS_BASE_HEX, stops, h);
    }

    const [r, g, b] = hexToRgb(normalized);
    const [h, s, l] = rgbToHsl(r, g, b);
    const baseSat   = clamp(s, MIN_IRIS_BASE_SATURATION, MAX_IRIS_BASE_SATURATION);
    const baseLight = clamp(l, MIN_IRIS_BASE_LIGHTNESS,  MAX_IRIS_BASE_LIGHTNESS);
    const stops = buildStopsFromHsl(h, baseSat, baseLight);
    return _build(normalized, stops, h);
  }

  // ── CSS gradient builders ──────────────────────────────────────────────────

  function buildIrisGradient(stops) {
    const lines = stops.map((color, i) => `          ${color} ${IRIS_STOP_PCTS[i]}%`);
    return `radial-gradient(
          circle at calc(50% + var(--gaze-x, 0%)) calc(50% + var(--gaze-y, 0%)),
${lines.join(',\n')}
        )`;
  }

  /**
   * Build the full layered iris background for injection into the dynamic <style> tag.
   *
   * Layer order (CSS paint order — first listed = frontmost):
   *   1. Highlight sparkle  — top-left bright lens glint
   *   2. Secondary shimmer  — bottom-right warm depth
   *   3. Ring accent band   — soft coloured concentric mid-iris ring
   *   4. Core iris gradient — 16-stop ramp following gaze direction
   *   5. Limbal ring        — very soft edge darkening (NOT a harsh border ring)
   *
   * Limbal alpha: 0.08 / 0.14 (was 0.16 / 0.34) — this was the main cause
   * of the "fake extra layer" between iris and sclera in the original.
   */
  function buildIrisBackground(palette) {
    const sparkRgb     = hexToRgb(palette.ring);
    const ringRgb      = hexToRgb(palette.ring);
    const rimRgb       = hexToRgb(palette.rim);
    const highlightRgb = hexToRgb(palette.highlight);
    return `
        radial-gradient(
          circle at 33% 30%,
          rgba(${highlightRgb[0]}, ${highlightRgb[1]}, ${highlightRgb[2]}, 0.78) 0%,
          rgba(${highlightRgb[0]}, ${highlightRgb[1]}, ${highlightRgb[2]}, 0.38) 12%,
          rgba(${highlightRgb[0]}, ${highlightRgb[1]}, ${highlightRgb[2]}, 0.14) 22%,
          rgba(${highlightRgb[0]}, ${highlightRgb[1]}, ${highlightRgb[2]}, 0.00) 44%
        ),
        radial-gradient(
          circle at 68% 74%,
          rgba(${sparkRgb[0]}, ${sparkRgb[1]}, ${sparkRgb[2]}, 0.26) 0%,
          rgba(${sparkRgb[0]}, ${sparkRgb[1]}, ${sparkRgb[2]}, 0.12) 22%,
          rgba(${sparkRgb[0]}, ${sparkRgb[1]}, ${sparkRgb[2]}, 0.00) 52%
        ),
        radial-gradient(
          circle at 50% 50%,
          rgba(${ringRgb[0]}, ${ringRgb[1]}, ${ringRgb[2]}, 0.00) 30%,
          rgba(${ringRgb[0]}, ${ringRgb[1]}, ${ringRgb[2]}, 0.16) 46%,
          rgba(${ringRgb[0]}, ${ringRgb[1]}, ${ringRgb[2]}, 0.24) 56%,
          rgba(${ringRgb[0]}, ${ringRgb[1]}, ${ringRgb[2]}, 0.00) 74%
        ),
        ${buildIrisGradient(palette.stops)},
        radial-gradient(
          circle at 50% 50%,
          rgba(14, 18, 34, 0.00) 65%,
          rgba(${rimRgb[0]}, ${rimRgb[1]}, ${rimRgb[2]}, 0.08) 85%,
          rgba(10, 12, 26, 0.14) 100%
        )
    `;
  }

  // ── Style injection ────────────────────────────────────────────────────────

  function getIrisStyleEl() {
    if (!irisStyleEl) {
      irisStyleEl = document.createElement('style');
      irisStyleEl.id = 'iris-color-dynamic';
      document.head.appendChild(irisStyleEl);
    }
    return irisStyleEl;
  }

  // ── Public application API ─────────────────────────────────────────────────

  function applyIris(hex) {
    applyIrisProfile({ baseHex: hex });
  }

  /**
   * Apply a full iris colour profile.
   *
   * @param {object} profile
   *   baseHex       — main hue; '' = use default periwinkle
   *   centerHex     — override iris center layer only
   *   midHex        — override iris mid layer only
   *   edgeHex       — override iris outer layer only
   *   ringHex       — override ring accent + iris border tint (does NOT cause banding)
   *   highlightHex  — override main sparkle only (does NOT cause banding)
   *   pupilCoreHex  — override pupil dark core only (does NOT cause banding)
   */
  function applyIrisProfile(profile = {}) {
    const baseHex = normalizeHex(profile.baseHex || '');
    const hasLayerOverride = !!(
      normalizeHex(profile.centerHex    || '') ||
      normalizeHex(profile.midHex       || '') ||
      normalizeHex(profile.edgeHex      || '') ||
      normalizeHex(profile.ringHex      || '') ||
      normalizeHex(profile.highlightHex || '') ||
      normalizeHex(profile.pupilCoreHex || '')
    );

    if (!baseHex && !hasLayerOverride) { clearIris(); return; }

    const effectiveBase = baseHex || DEFAULT_IRIS_BASE_HEX;
    const palette = deriveIrisGradient(effectiveBase, profile);

    // Inject complete gradient via dynamic style tag — wins over CSS static fallback
    getIrisStyleEl().textContent = `
      body.eye-custom .pupil {
        background: ${buildIrisBackground(palette)} !important;
        filter: none !important;
        transition: background 0.28s ease !important;
      }
    `;

    // Export palette as CSS vars — used by box-shadow border, emotion overrides, CSS fallback
    document.body.style.setProperty('--iris-color-center',           palette.center);
    document.body.style.setProperty('--iris-color-inner-mid',        palette.innerMid);
    document.body.style.setProperty('--iris-color-mid',              palette.mid);
    document.body.style.setProperty('--iris-color-outer-mid',        palette.outerMid);
    document.body.style.setProperty('--iris-color-edge',             palette.edge);
    document.body.style.setProperty('--iris-custom-ring-rgb',        toRgbTriplet(palette.ring,      [195, 206, 255]));
    document.body.style.setProperty('--iris-custom-highlight-rgb',   toRgbTriplet(palette.highlight, [255, 255, 255]));
    document.body.style.setProperty('--iris-custom-pupil-core',      normalizeHex(palette.pupilCore) || '#111a34');
    document.body.style.setProperty('--iris-custom-pupil-sheen-rgb', toRgbTriplet(palette.pupilSheen,[165, 188, 255]));

    document.body.classList.add('eye-custom');
  }

  function clearIris() {
    if (irisStyleEl) irisStyleEl.textContent = '';
    document.body.classList.remove('eye-custom');
    [
      '--iris-color-center', '--iris-color-inner-mid', '--iris-color-mid',
      '--iris-color-outer-mid', '--iris-color-edge', '--iris-custom-ring-rgb',
      '--iris-custom-highlight-rgb', '--iris-custom-pupil-core', '--iris-custom-pupil-sheen-rgb',
    ].forEach(v => document.body.style.removeProperty(v));
  }

  // ── Glow API ───────────────────────────────────────────────────────────────

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

  /**
   * Enable or disable emotion→glow sync.
   * On: body.glow-emotion-lock → emotion CSS overrides colour.
   * Off: class removed → emotion glows bypassed, user colour holds.
   */
  function setEmotionSync(enabled) {
    document.body.classList.toggle('glow-emotion-lock', !!enabled);
  }

  // ── Read-back helpers ──────────────────────────────────────────────────────

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

  /**
   * Return the current iris profile as an object suitable for re-applying.
   * Use baseHex for a clean round-trip — ring/highlight/pupilCore are derived.
   */
  function getIrisProfile() {
    return {
      baseHex:      document.body.style.getPropertyValue('--iris-color-mid').trim()         || '',
      centerHex:    document.body.style.getPropertyValue('--iris-color-center').trim()       || '',
      edgeHex:      document.body.style.getPropertyValue('--iris-color-edge').trim()         || '',
      ringHex:      '',
      highlightHex: '',
      pupilCoreHex: document.body.style.getPropertyValue('--iris-custom-pupil-core').trim() || '',
    };
  }

  // ── Exports ────────────────────────────────────────────────────────────────

  return {
    applyIris,
    applyIrisProfile,
    clearIris,
    applyGlow,
    clearGlow,
    setEmotionSync,
    deriveIrisGradient,
    hexToRgb,
    getCurrentIrisHex,
    getCustomGlowHex,
    getIrisProfile,
  };
})();
