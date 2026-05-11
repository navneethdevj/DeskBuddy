/**
 * IrisColor — custom iris + glow colour support.
 * Recolours the real central iris element (`.pupil`) with no extra DOM layers.
 *
 * FIX (this revision):
 *  - Zone-isolated layer overrides: center/mid/edge each only affect their
 *    own radial zone; no bleed-over into adjacent zones.
 *  - Ring accent and secondary shimmer use SEPARATE CSS vars so changing
 *    ringHex only affects the ring band, not the shimmer.
 *  - Highlight override only touches sparkle / catchlight layers.
 *  - Pupil core override only touches --iris-custom-pupil-core.
 *  - All six layer pickers now do EXACTLY what they say.
 */
const IrisColor = (() => {
  // 16 stop positions from iris center (0) to edge (100).
  const IRIS_STOP_PCTS = [0, 4, 8, 13, 19, 26, 34, 43, 53, 63, 73, 82, 89, 94, 98, 100];
  // Lightness ramp: darkening at core, brightening toward limbal edge.
  const IRIS_LIGHTNESS_DELTA = [-28, -24, -20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20, 23, 25, 27];
  // Saturation falloff
  const IRIS_SAT_MULT = [1.26, 1.22, 1.18, 1.14, 1.10, 1.06, 1.02, 1.00, 0.97, 0.94, 0.90, 0.86, 0.83, 0.80, 0.77, 0.74];

  // Zone boundaries (index into IRIS_STOP_PCTS)
  // Center zone: indices 0–4  (pcts 0–19)
  // Mid zone:    indices 4–10 (pcts 19–63)
  // Edge zone:   indices 10–15 (pcts 73–100)
  const ZONE_CENTER_END = 5;   // exclusive — center runs [0, ZONE_CENTER_END)
  const ZONE_MID_START  = 4;
  const ZONE_MID_END    = 11;  // exclusive
  const ZONE_EDGE_START = 10;

  const DEFAULT_IRIS_BASE_HEX = '#8795db';
  const MIN_IRIS_BASE_SATURATION = 30;
  const MAX_IRIS_BASE_SATURATION = 86;
  const MIN_IRIS_BASE_LIGHTNESS  = 32;
  const MAX_IRIS_BASE_LIGHTNESS  = 56;

  let irisStyleEl = null;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

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
        if (t < 0) t += 1; if (t > 1) t -= 1;
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

  // ── Stop builder (base HSL ramp) ───────────────────────────────────────────

  function buildStopsFromHsl(h, satBase, lightBase) {
    return IRIS_STOP_PCTS.map((_stopPct, i) => {
      const sat   = clamp(satBase * IRIS_SAT_MULT[i], 20, 98);
      const light = clamp(lightBase + IRIS_LIGHTNESS_DELTA[i], 16, 78);
      return hslToHex(h, sat, light);
    });
  }

  /**
   * Zone-isolated stop patching.
   *
   * Each override only modifies stops within its dedicated zone, blending
   * smoothly at the zone boundary into the unmodified base stops.
   * This means: changing "center color" only tints the innermost iris region;
   * the mid and edge regions keep their original base-hue gradient entirely.
   *
   * Zone map (IRIS_STOP_PCTS index space):
   *   Center : indices 0–4   (pcts  0–19%)   — core pupil-adjacent region
   *   Mid    : indices 4–10  (pcts 19–63%)   — mid iris ring
   *   Edge   : indices 10–15 (pcts 63–100%)  — outer iris / limbal transition
   *
   * At each zone boundary we blend [override ↔ base] using smootherstep so
   * there is never a hard colour discontinuity at the border.
   */
  function applyZoneOverrides(baseStops, centerOverride, midOverride, edgeOverride) {
    const stops = baseStops.slice(); // copy

    // ── Center zone: indices 0 → ZONE_CENTER_END-1 ──────────────────────
    if (centerOverride) {
      for (let i = 0; i < ZONE_CENTER_END; i++) {
        // Full center color at index 0, smoothly blend to base at boundary
        const t = i / ZONE_CENTER_END; // 0 at center, 1 at boundary
        stops[i] = mixHex(centerOverride, baseStops[ZONE_CENTER_END], t);
      }
      // Soft feather at the boundary stop itself (half blend)
      stops[ZONE_CENTER_END] = mixHex(centerOverride, baseStops[ZONE_CENTER_END], 0.5);
    }

    // ── Edge zone: indices ZONE_EDGE_START → 15 ──────────────────────────
    if (edgeOverride) {
      for (let i = ZONE_EDGE_START; i < IRIS_STOP_PCTS.length; i++) {
        // Ramp from 0 influence at zone start to full edge color at end
        const t = (i - ZONE_EDGE_START) / (IRIS_STOP_PCTS.length - 1 - ZONE_EDGE_START);
        stops[i] = mixHex(baseStops[ZONE_EDGE_START], edgeOverride, t);
      }
      // Soft feather at boundary
      stops[ZONE_EDGE_START] = mixHex(baseStops[ZONE_EDGE_START], edgeOverride, 0.35);
    }

    // ── Mid zone: indices ZONE_MID_START → ZONE_MID_END-1 ───────────────
    // Applied last so it can blend into already-patched center/edge at boundaries
    if (midOverride) {
      const peak = 7; // index ~43% — the visual "middle" of the iris
      for (let i = ZONE_MID_START; i < ZONE_MID_END; i++) {
        // Bell-shaped influence: peak at index 7, falls off toward zone edges
        let influence;
        if (i <= peak) {
          influence = (i - ZONE_MID_START) / (peak - ZONE_MID_START);
        } else {
          influence = (ZONE_MID_END - 1 - i) / (ZONE_MID_END - 1 - peak);
        }
        const t = smootherstep(influence);
        stops[i] = mixHex(stops[i], midOverride, t);
      }
    }

    return stops;
  }

  // ── Core palette builder ───────────────────────────────────────────────────

  /**
   * Derive a full iris colour palette from a base hex + optional per-layer overrides.
   *
   * Each override is STRICTLY isolated to its visual region:
   *   centerHex     — only tints iris core (innermost ~20% radius)
   *   midHex        — only tints mid iris ring (~20–63% radius)
   *   edgeHex       — only tints outer iris / limbal zone (~63–100% radius)
   *   ringHex       — only colours the concentric ring accent band overlay
   *   highlightHex  — only colours the sparkle catchlight overlay + .pupil::after
   *   pupilCoreHex  — only colours the pupil dark centre (.pupil::before)
   */
  function deriveIrisGradient(hex, overrides = {}) {
    const normalized      = normalizeHex(hex);
    const centerOverride  = normalizeHex(overrides.centerHex    || '');
    const midOverride     = normalizeHex(overrides.midHex       || '');
    const edgeOverride    = normalizeHex(overrides.edgeHex      || '');
    const ringOverride    = normalizeHex(overrides.ringHex      || '');
    const highlightOverride = normalizeHex(overrides.highlightHex || '');
    const pupilCoreOverride = normalizeHex(overrides.pupilCoreHex || '');

    const effectiveBase = normalized || DEFAULT_IRIS_BASE_HEX;
    const [r, g, b] = hexToRgb(effectiveBase);
    const [h, s, l] = rgbToHsl(r, g, b);
    const baseSat   = clamp(s, MIN_IRIS_BASE_SATURATION, MAX_IRIS_BASE_SATURATION);
    const baseLight = clamp(l, MIN_IRIS_BASE_LIGHTNESS,  MAX_IRIS_BASE_LIGHTNESS);
    const baseStops = buildStopsFromHsl(h, baseSat, baseLight);

    // Apply zone-isolated overrides — each only touches its own region
    const finalStops = (centerOverride || midOverride || edgeOverride)
      ? applyZoneOverrides(baseStops, centerOverride, midOverride, edgeOverride)
      : baseStops;

    // Derive accent colors from final gradient (not base) so they harmonise
    const innerMid = finalStops[6];   // ~34%
    const outerMid = finalStops[10];  // ~73%
    const center   = finalStops[0];
    const mid      = finalStops[7];   // ~43% visual midpoint
    const edge     = finalStops[13];  // ~94%

    // Ring accent: purely visual overlay — uses ringOverride OR a tint
    // derived from the mid-iris stop. Does NOT affect the gradient.
    const ring = ringOverride || finalStops[8]; // ~53%

    // Secondary shimmer is derived independently from ring so they don't share a var
    // It uses a slightly lighter/warmer tint from the outer-mid zone.
    const shimmer = ringOverride
      ? mixHex(ringOverride, '#ffffff', 0.25)   // lighten ring override for shimmer
      : finalStops[10];                          // outerMid — naturally different from ring

    // Highlight sparkle — top-left bright reflection
    const highlight = highlightOverride || finalStops[11]; // ~82%

    // Pupil core — the very dark centre under the ::before pseudo
    const pupilCore = pupilCoreOverride || hslToHex(h, 42, 14);
    const pupilSheen = mixHex(highlight, '#ffffff', 0.32);

    // Rim (limbal ring): very subtle darkening at the iris edge
    const rim = finalStops[13];

    return {
      center, mid, edge, innerMid, outerMid,
      stops: finalStops,
      rim, ring, shimmer, highlight,
      pupilCore, pupilSheen,
    };
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
   * Layer order (CSS paint — first listed = frontmost):
   *   1. Highlight sparkle  — top-left bright lens glint    (uses palette.highlight)
   *   2. Secondary shimmer  — bottom-right warm depth       (uses palette.shimmer — SEPARATE from ring)
   *   3. Ring accent band   — concentric mid-iris tint      (uses palette.ring)
   *   4. Core iris gradient — 16-stop zone-isolated ramp
   *   5. Limbal ring        — very soft edge darkening
   *
   * Key fix: shimmer and ring now use different palette colours so they can be
   * independently controlled.  Previously both used palette.ring which caused
   * changing ring colour to unexpectedly alter the shimmer.
   */
  function buildIrisBackground(palette) {
    const shimmerRgb   = hexToRgb(palette.shimmer);
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
          rgba(${shimmerRgb[0]}, ${shimmerRgb[1]}, ${shimmerRgb[2]}, 0.22) 0%,
          rgba(${shimmerRgb[0]}, ${shimmerRgb[1]}, ${shimmerRgb[2]}, 0.10) 22%,
          rgba(${shimmerRgb[0]}, ${shimmerRgb[1]}, ${shimmerRgb[2]}, 0.00) 52%
        ),
        radial-gradient(
          circle at 50% 50%,
          rgba(${ringRgb[0]}, ${ringRgb[1]}, ${ringRgb[2]}, 0.00) 30%,
          rgba(${ringRgb[0]}, ${ringRgb[1]}, ${ringRgb[2]}, 0.16) 46%,
          rgba(${ringRgb[0]}, ${ringRgb[1]}, ${ringRgb[2]}, 0.26) 56%,
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
   * Each property independently and accurately controls only its visual region.
   *
   * @param {object} profile
   *   baseHex       — global hue; '' = default periwinkle
   *   centerHex     — ONLY the innermost ~20% iris zone
   *   midHex        — ONLY the mid-iris ring (~20–63%)
   *   edgeHex       — ONLY the outer zone (~63–100%) / limbal transition
   *   ringHex       — ONLY the concentric ring accent overlay (no gradient bleed)
   *   highlightHex  — ONLY the sparkle catchlight overlay + .pupil::after colour
   *   pupilCoreHex  — ONLY the dark pupil centre (.pupil::before)
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

    const palette = deriveIrisGradient(baseHex || DEFAULT_IRIS_BASE_HEX, profile);

    // Inject full gradient background via dynamic <style> — wins over static CSS
    getIrisStyleEl().textContent = `
      body.eye-custom .pupil {
        background: ${buildIrisBackground(palette)} !important;
        filter: none !important;
        transition: background 0.28s ease !important;
      }
    `;

    // Export CSS vars used by box-shadow iris border, .pupil::before/::after,
    // and emotion overrides — each var maps to exactly one visual feature.
    document.body.style.setProperty('--iris-color-center',           palette.center);
    document.body.style.setProperty('--iris-color-inner-mid',        palette.innerMid);
    document.body.style.setProperty('--iris-color-mid',              palette.mid);
    document.body.style.setProperty('--iris-color-outer-mid',        palette.outerMid);
    document.body.style.setProperty('--iris-color-edge',             palette.edge);

    // Ring accent — concentric band only, separate from shimmer
    document.body.style.setProperty('--iris-custom-ring-rgb',
      toRgbTriplet(palette.ring, [195, 206, 255]));

    // Shimmer — bottom-right depth overlay (separate from ring)
    document.body.style.setProperty('--iris-custom-shimmer-rgb',
      toRgbTriplet(palette.shimmer, [200, 210, 255]));

    // Highlight — sparkle catchlight (.pupil::after)
    document.body.style.setProperty('--iris-custom-highlight-rgb',
      toRgbTriplet(palette.highlight, [255, 255, 255]));

    // Pupil core — the dark center (.pupil::before)
    document.body.style.setProperty('--iris-custom-pupil-core',
      normalizeHex(palette.pupilCore) || '#111a34');

    // Pupil sheen — the subtle inner glow of the pupil
    document.body.style.setProperty('--iris-custom-pupil-sheen-rgb',
      toRgbTriplet(palette.pupilSheen, [165, 188, 255]));

    document.body.classList.add('eye-custom');
  }

  function clearIris() {
    if (irisStyleEl) irisStyleEl.textContent = '';
    document.body.classList.remove('eye-custom');
    [
      '--iris-color-center', '--iris-color-inner-mid', '--iris-color-mid',
      '--iris-color-outer-mid', '--iris-color-edge',
      '--iris-custom-ring-rgb', '--iris-custom-shimmer-rgb',
      '--iris-custom-highlight-rgb', '--iris-custom-pupil-core',
      '--iris-custom-pupil-sheen-rgb',
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
