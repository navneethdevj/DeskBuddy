/**
 * ThemeCanvas — canvas-based particle effects for animated full-screen themes.
 * Themes: galaxy (meteors), forest (leaves), cherry/sakura (petals),
 *         ocean (bubbles), rain (streaks/ripples), dreamscape (orbs/sparkles), aurora (glows), midnight (snow).
 * classic has no particles.
 * The canvas sits at z-index 0, behind the companion.
 */
const ThemeCanvas = (() => {
  let _canvas = null, _ctx = null, _animId = null;
  let _particles = [], _active = false, _paused = false, _theme = 'galaxy';
  let _frame = 0;
  let _stars = [];  // shared star array (galaxy + future themes)
  // Performance: cap canvas at ~30fps (33ms) to reduce GPU/CPU usage.
  // Companion animations stay at 60fps (CSS) — only background particles throttle.
  let _lastTickTime = 0;
  const TICK_INTERVAL_MS = 33; // ~30fps cap for particle canvas

  function _initStars(W, H, count) {
    _stars = Array.from({ length: count }, () => ({
      x: Math.random() * W, y: Math.random() * H * 0.88,
      r: 0.3 + Math.random() * 1.5,
      alpha: 0.25 + Math.random() * 0.70,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpd:   0.010 + Math.random() * 0.028,
    }));
  }

  // ── Branch builder shared by forest & cherry ────────────────────────────────
  function _buildBranches(W, H, seeds) {
    const out = [];
    function grow(x, y, angle, length, width, depth) {
      if (depth <= 0 || length < 5) return;
      const ex = x + Math.cos(angle) * length;
      const ey = y + Math.sin(angle) * length;
      out.push({ x1: x, y1: y, x2: ex, y2: ey, w: width });
      const sp = 0.28 + Math.random() * 0.30;
      grow(ex, ey, angle - sp,         length * 0.68, width * 0.64, depth - 1);
      grow(ex, ey, angle + sp * 0.85,  length * 0.65, width * 0.60, depth - 1);
      if (depth > 2) grow(ex, ey, angle - sp * 0.3, length * 0.52, width * 0.48, depth - 2);
    }
    seeds.forEach(s => grow(s.x, s.y, s.angle, s.len, s.w, s.depth));
    return out;
  }

  // ── Mountain builder for snow theme ─────────────────────────────────────────
  function _buildMountains(W, H) {
    function makeRange(numPeaks, peakMin, peakMax, valleyMin, valleyMax, baseY) {
      const step = W / (numPeaks + 1);
      const pts  = [{ x: -10, y: baseY }];
      for (let i = 0; i <= numPeaks; i++) {
        if (i < numPeaks) {
          pts.push({
            x: step * (i + 0.5) + (Math.random() - 0.5) * step * 0.55,
            y: H * (peakMin  + Math.random() * (peakMax  - peakMin)),
          });
        }
        pts.push({
          x: step * (i + 1) + (Math.random() - 0.5) * step * 0.22,
          y: H * (valleyMin + Math.random() * (valleyMax - valleyMin)),
        });
      }
      pts.push({ x: W + 10, y: baseY });
      pts.push({ x: W + 10, y: H + 10 });
      pts.push({ x: -10,    y: H + 10 });
      return pts;
    }
    return [
      // Farthest range — pale blue silhouette, highest on horizon
      { pts: makeRange(8, 0.30, 0.46, 0.50, 0.58, H * 0.58),
        fill: 'rgba(60, 78, 122, 0.45)', snowFade: H * 0.05 },
      // Middle range
      { pts: makeRange(5, 0.42, 0.56, 0.60, 0.66, H * 0.70),
        fill: 'rgba(30, 42, 78, 0.68)',  snowFade: H * 0.06 },
      // Near ridge — darkest foreground
      { pts: makeRange(3, 0.55, 0.66, 0.68, 0.74, H * 0.82),
        fill: 'rgba(14, 22, 48, 0.90)',  snowFade: H * 0.07 },
    ];
  }


  // ── Smooth time-of-day blend system ──────────────────────────────────────────
  // Returns a blend object { period, next, t } where t=0 means pure period,
  // t=1 means pure next. Transitions happen over 45min windows around hour marks.
  let H_CACHED = 600; // fallback for palm drawing before canvas is ready

  const _PERIOD_ORDER = ['NIGHT','MORNING','AFTERNOON','EVENING','NIGHT'];
  const _PERIOD_HOURS = {
    MORNING:   [5,  11],  // 05:00–11:00
    AFTERNOON: [11, 17],  // 11:00–17:00
    EVENING:   [17, 21],  // 17:00–21:00
    NIGHT:     [21, 29],  // 21:00–05:00 (+24 wrap)
  };
  // Transition windows (minutes before next period starts where blending begins)
  const _BLEND_WINDOW_MIN = 50;

  function _getTimePeriodRaw() {
    const h = new Date().getHours();
    if (h >= 5  && h < 11) return 'MORNING';
    if (h >= 11 && h < 17) return 'AFTERNOON';
    if (h >= 17 && h < 21) return 'EVENING';
    return 'NIGHT';
  }

  function _getSmoothBlend() {
    const now  = new Date();
    const h    = now.getHours();
    const m    = now.getMinutes();
    const totalMin = h * 60 + m;

    // Each boundary: minute of day when period changes
    const bounds = [
      { at: 5  * 60, from: 'NIGHT',     to: 'MORNING'   },
      { at: 11 * 60, from: 'MORNING',   to: 'AFTERNOON' },
      { at: 17 * 60, from: 'AFTERNOON', to: 'EVENING'   },
      { at: 21 * 60, from: 'EVENING',   to: 'NIGHT'     },
    ];

    for (const b of bounds) {
      const dist = b.at - totalMin;
      if (dist >= 0 && dist <= _BLEND_WINDOW_MIN) {
        // Approaching this boundary — blend toward `to`
        return { period: b.from, next: b.to, t: 1 - dist / _BLEND_WINDOW_MIN };
      }
      // Just past boundary — blend out of transition
      const pastDist = totalMin - b.at;
      if (pastDist >= 0 && pastDist <= 12) {
        return { period: b.to, next: b.to, t: 1.0 };
      }
    }
    // Stable period, no blending
    const p = _getTimePeriodRaw();
    return { period: p, next: p, t: 1.0 };
  }

  // Read period from body attribute (set by renderer main(), respects lock/auto)
  function _getCanvasPeriod() {
    return document.body.dataset.themePeriod || _getTimePeriodRaw();
  }

  // Color lerp helpers
  function _lrp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
  function _rgb(c, a) {
    if (a === undefined) return `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
    return `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a.toFixed(3)})`;
  }
  function _lrpRgbArr(c1, c2, t) {
    return [_lrp(c1[0],c2[0],t), _lrp(c1[1],c2[1],t), _lrp(c1[2],c2[2],t)];
  }

  // Blend between two period color palettes using the smooth blend object
  // palette = { MORNING:{...}, AFTERNOON:{...}, EVENING:{...}, NIGHT:{...} }
  // Each value is an array [r,g,b]
  function _blendPeriodColors(palette, blend) {
    const { period, next, t } = blend;
    const keys = Object.keys(palette[period] || palette.AFTERNOON);
    const result = {};
    keys.forEach(k => {
      const c1 = palette[period]  ? palette[period][k]  : palette.AFTERNOON[k];
      const c2 = palette[next]    ? palette[next][k]    : c1;
      result[k] = _lrpRgbArr(c1, c2, t);
    });
    return result;
  }

// ── Per-theme configs — PREMIUM REWORK ──────────────────────────────────────
//
// Time-aware helper: reads current period from body data-attribute.
// Returns object { period, rawH } where period ∈ MORNING/AFTERNOON/EVENING/NIGHT.
//
function _getCanvasPeriod() {
  return document.body.dataset.themePeriod || 'AFTERNOON';
}

// Lerp helper for smooth color blending
function _lrp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
function _lrpRgb(c1, c2, t) {
  return [_lrp(c1[0], c2[0], t), _lrp(c1[1], c2[1], t), _lrp(c1[2], c2[2], t)];
}
function _rgb(c, a) {
  if (a === undefined) return `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
  return `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a.toFixed(3)})`;
}

const CFG = {

  // ── Galaxy — kept pristine ────────────────────────────────────────────────
  galaxy: {
    max: 4, rate: 0.022,
    _nebulae: null,
    init(W, H) {
      _initStars(W, H, 130);
      this._nebulae = [
        { x: W*0.14, y: H*0.22, rx: W*0.24, ry: H*0.14, hue: 258, spd: 0.0025 },
        { x: W*0.80, y: H*0.16, rx: W*0.20, ry: H*0.11, hue: 198, spd: 0.0032 },
        { x: W*0.50, y: H*0.55, rx: W*0.32, ry: H*0.20, hue: 295, spd: 0.0018 },
        { x: W*0.28, y: H*0.72, rx: W*0.18, ry: H*0.09, hue: 230, spd: 0.0028 },
      ];
    },
    drawBackground(ctx, W, H) {
      _stars.forEach(s => {
        s.twinklePhase += s.twinkleSpd;
        const a = s.alpha * (0.45 + 0.55 * Math.sin(s.twinklePhase));
        ctx.save(); ctx.globalAlpha = a;
        if (s.r > 1.1) {
          ctx.strokeStyle = `rgba(218,224,255,${a*0.55})`; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(s.x-s.r*2.8,s.y); ctx.lineTo(s.x+s.r*2.8,s.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s.x,s.y-s.r*2.8); ctx.lineTo(s.x,s.y+s.r*2.8); ctx.stroke();
        }
        ctx.fillStyle='rgba(222,226,255,1)'; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
        ctx.restore();
      });
      const t = _frame;
      this._nebulae.forEach(n => {
        const pulse = 0.038 + 0.014*Math.sin(t*n.spd);
        const g = ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.rx);
        g.addColorStop(0,`hsla(${n.hue},72%,55%,${pulse*1.6})`);
        g.addColorStop(0.4,`hsla(${n.hue+18},65%,48%,${pulse*0.7})`);
        g.addColorStop(1,`hsla(${n.hue},58%,38%,0)`);
        ctx.save(); ctx.scale(1, n.ry/n.rx); ctx.fillStyle=g;
        ctx.beginPath(); ctx.arc(n.x,n.y*(n.rx/n.ry),n.rx,0,Math.PI*2); ctx.fill(); ctx.restore();
      });
    },
    create(W,H) {
      return { x:Math.random()*W*0.8, y:Math.random()*H*0.38-H*0.05,
        vx:2.8+Math.random()*3, vy:1.8+Math.random()*2, len:85+Math.random()*80,
        alpha:0, maxAlpha:0.7+Math.random()*0.25, life:0, maxLife:48+Math.random()*65 };
    },
    draw(ctx, p) {
      const d=Math.hypot(p.vx,p.vy), tx=p.x-(p.vx/d)*p.len, ty=p.y-(p.vy/d)*p.len;
      const g=ctx.createLinearGradient(p.x,p.y,tx,ty);
      g.addColorStop(0,`rgba(255,255,255,${p.alpha})`);
      g.addColorStop(0.3,`rgba(185,200,255,${p.alpha*0.5})`);
      g.addColorStop(1,'rgba(140,165,255,0)');
      ctx.save(); ctx.strokeStyle=g; ctx.lineWidth=1.8;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(tx,ty); ctx.stroke(); ctx.restore();
    },
    update(p,W,H) {
      p.x+=p.vx; p.y+=p.vy; p.life++;
      p.alpha = p.life<10?(p.life/10)*p.maxAlpha : p.life>p.maxLife-14?Math.max(0,p.alpha-p.maxAlpha/14):p.maxAlpha;
      return p.life<p.maxLife && p.x<W+p.len && p.y<H+p.len;
    },
  },

  // ── FOREST — Premium Enchanted Forest Scene ───────────────────────────────
  // Inspired by Ghibli forest tunnel: ancient arching trees, twisting roots,
  // hanging vines, a forest path, time-of-day sky, fireflies at dusk/night.
  forest: {
    max: 55, rate: 0.14,
    _trunks: null, _vines: null, _groundFlora: null,
    _canopyPoints: null, _spores: null,

    init(W, H) {
      _stars = [];
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);

      // Left trunk system: 2 large trunks from bottom-left edge
      this._trunks = {
        L: [
          { bx: W*0.02, by: H, tx: W*0.08, ty: H*0.02, cp1x: W*0.04, cp1y: H*0.55, cp2x: W*0.06, cp2y: H*0.28, w1: W*0.10, w2: W*0.030 },
          { bx: W*0.14, by: H, tx: W*0.16, ty: H*0.05, cp1x: W*0.13, cp1y: H*0.55, cp2x: W*0.17, cp2y: H*0.28, w1: W*0.07, w2: W*0.022 },
        ],
        R: [
          { bx: W*0.98, by: H, tx: W*0.92, ty: H*0.02, cp1x: W*0.96, cp1y: H*0.55, cp2x: W*0.94, cp2y: H*0.28, w1: W*0.10, w2: W*0.030 },
          { bx: W*0.86, by: H, tx: W*0.84, ty: H*0.05, cp1x: W*0.87, cp1y: H*0.55, cp2x: W*0.83, cp2y: H*0.28, w1: W*0.07, w2: W*0.022 },
        ],
      };

      // Vine tendrils
      this._vines = Array.from({ length: 12 }, (_, i) => {
        const side = i < 6 ? 'L' : 'R';
        const sx = side === 'L' ? W*rng(0.04,0.22) : W*rng(0.78,0.96);
        return {
          sx, sy: H*rng(0.0, 0.25),
          length: H*rng(0.18, 0.48),
          sway: rng(0, Math.PI*2),
          swSpd: rng(0.006, 0.014),
          swAmp: rng(8, 22),
          col: `hsl(${110+rng(0,40)|0},${60+rng(0,20)|0}%,${22+rng(0,14)|0}%)`,
          w: rng(1.5, 3.5),
          segs: Math.floor(rng(6, 14)),
        };
      });

      // Ground flora: small plants, flowers, rocks along the path edges
      this._groundFlora = Array.from({ length: 28 }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const xBase = W*0.5 + side * W*rng(0.08, 0.42);
        return {
          x: xBase + rng(-W*0.04, W*0.04),
          y: H*rng(0.72, 0.98),
          type: Math.random() < 0.6 ? 'leaf' : Math.random() < 0.5 ? 'flower' : 'fern',
          hue: 95 + rng(0, 55)|0,
          sz: rng(0.015, 0.040) * Math.min(W, H),
          rot: rng(-0.5, 0.5),
          phase: rng(0, Math.PI*2),
          spd: rng(0.008, 0.018),
        };
      });

      // Canopy arch points (top of screen, connecting both tree groups)
      this._canopyPoints = Array.from({ length: 20 }, (_, i) => ({
        x: W * i/19,
        y: H * (0.0 + 0.22 * Math.pow(Math.abs(i/19 - 0.5)*2, 1.6)),
        phase: rng(0, Math.PI*2),
        spd: rng(0.004, 0.01),
      }));

      // Bioluminescent spores for evening
      this._spores = Array.from({ length: 22 }, () => ({
        x: W*rng(0.1, 0.9), y: H*rng(0.38, 0.92),
        r: rng(2, 5), hue: rng(0,1) < 0.5 ? 165 : 280,
        phase: rng(0, Math.PI*2), spd: rng(0.02, 0.04),
      }));
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend  = _getSmoothBlend();
      const t = _frame * 0.012;

      // ── 1. Deep forest base gradient — atmospheric, no scenery ─────────
      // Reference: MORNING=bright yellow-green radial burst center on dark green
      // AFTERNOON=golden center glow on rich deep green
      // EVENING=teal-green dark with cyan horizon glow (right edge)
      // NIGHT=near-black mossy dark with subtle moonlit cyan
      const SKY = {
        MORNING:   { t:[ 2, 12,  4], m:[ 4, 24,  8], b:[ 6, 32, 10] },
        AFTERNOON: { t:[ 1,  9,  2], m:[ 3, 18,  5], b:[ 5, 28,  8] },
        EVENING:   { t:[ 0,  6,  8], m:[ 1, 14, 18], b:[ 2, 22, 28] },
        NIGHT:     { t:[ 0,  4,  1], m:[ 0,  7,  2], b:[ 1, 10,  3] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,    _rgb(sk.t));
      skyG.addColorStop(0.48, _rgb(sk.m));
      skyG.addColorStop(1,    _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Signature period light source — the identity of each time ────
      // MORNING: brilliant yellow-green canopy light burst from center-top
      if (period === 'MORNING') {
        // Primary canopy burst — dominant center-top
        const mg = ctx.createRadialGradient(W*0.50, H*0.08, 0, W*0.50, H*0.08, W*0.68);
        mg.addColorStop(0,    'rgba(220,255,120,0.88)');
        mg.addColorStop(0.08, 'rgba(185,255,80,0.68)');
        mg.addColorStop(0.22, 'rgba(120,235,45,0.38)');
        mg.addColorStop(0.50, 'rgba(48,185,22,0.14)');
        mg.addColorStop(1,    'rgba(12,95,5,0)');
        ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H*0.75);
        // Secondary warm golden fill through canopy
        const mg2 = ctx.createRadialGradient(W*0.50, H*0.35, 0, W*0.50, H*0.35, W*0.48);
        mg2.addColorStop(0,    'rgba(255,255,180,0.42)');
        mg2.addColorStop(0.22, 'rgba(220,255,120,0.18)');
        mg2.addColorStop(0.55, 'rgba(120,220,48,0.07)');
        mg2.addColorStop(1,    'rgba(28,120,8,0)');
        ctx.fillStyle = mg2; ctx.fillRect(0, 0, W, H);
        // Light shafts — diagonal golden rays
        for (let i = 0; i < 6; i++) {
          const shx = W * (0.28 + i * 0.082) + Math.sin(t*0.4+i) * W*0.018;
          const sha = 0.05 + 0.04 * Math.abs(Math.sin(t*0.6+i*1.4));
          const sg = ctx.createLinearGradient(shx, 0, shx + W*0.028, H*0.75);
          sg.addColorStop(0,   `rgba(200,255,100,${sha*2.2})`);
          sg.addColorStop(0.4, `rgba(170,245,80,${sha*0.9})`);
          sg.addColorStop(1,   'rgba(90,195,30,0)');
          ctx.fillStyle = sg;
          ctx.beginPath();
          ctx.moveTo(shx - W*0.008, 0); ctx.lineTo(shx + W*0.025, 0);
          ctx.lineTo(shx + W*0.058, H*0.80); ctx.lineTo(shx + W*0.018, H*0.80);
          ctx.closePath(); ctx.fill();
        }
      }
      // AFTERNOON: golden-white center sunlight through canopy gap
      if (period === 'AFTERNOON') {
        const pulse = 0.92 + 0.08 * Math.sin(t * 1.2);
        const ag = ctx.createRadialGradient(W*0.50, H*0.32, 0, W*0.50, H*0.32, W*0.60);
        ag.addColorStop(0,    `rgba(255,255,210,${0.62 * pulse})`);
        ag.addColorStop(0.10, `rgba(235,255,140,${0.42 * pulse})`);
        ag.addColorStop(0.28, `rgba(165,235,55,${0.20 * pulse})`);
        ag.addColorStop(0.55, `rgba(72,188,18,${0.08 * pulse})`);
        ag.addColorStop(1,    'rgba(18,98,5,0)');
        ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H*0.80);
        // Atmospheric canopy green ambient
        const ag2 = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.78);
        ag2.addColorStop(0,    `rgba(80,195,22,${0.22 * pulse})`);
        ag2.addColorStop(0.55, 'rgba(38,145,10,0.08)');
        ag2.addColorStop(1,    'rgba(12,72,4,0)');
        ctx.fillStyle = ag2; ctx.fillRect(0, 0, W, H*0.62);
      }
      // EVENING: teal/cyan horizon glow from right side (reference shows right-edge cyan)
      if (period === 'EVENING') {
        // Right edge cyan-teal horizon glow
        const eg = ctx.createRadialGradient(W*0.92, H*0.58, 0, W*0.92, H*0.58, W*0.72);
        eg.addColorStop(0,    'rgba(0,235,188,0.55)');
        eg.addColorStop(0.12, 'rgba(0,195,148,0.32)');
        eg.addColorStop(0.35, 'rgba(0,145,105,0.15)');
        eg.addColorStop(0.65, 'rgba(0,88,62,0.06)');
        eg.addColorStop(1,    'rgba(0,45,32,0)');
        ctx.fillStyle = eg; ctx.fillRect(W*0.28, 0, W*0.72, H);
        // Deep teal upper atmospheric depth
        const ev = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.62);
        ev.addColorStop(0,    'rgba(0,88,68,0.35)');
        ev.addColorStop(0.55, 'rgba(0,55,42,0.14)');
        ev.addColorStop(1,    'rgba(0,28,20,0)');
        ctx.fillStyle = ev; ctx.fillRect(0, 0, W, H*0.72);
        // Warm left counterbalance
        const ew = ctx.createRadialGradient(0, H*0.52, 0, 0, H*0.52, W*0.45);
        ew.addColorStop(0,    'rgba(18,88,12,0.22)');
        ew.addColorStop(0.55, 'rgba(8,52,6,0.08)');
        ew.addColorStop(1,    'rgba(2,22,2,0)');
        ctx.fillStyle = ew; ctx.fillRect(0, 0, W*0.60, H);
      }
      // NIGHT: moonlit blue-green glow
      if (period === 'NIGHT') {
        const ng = ctx.createRadialGradient(W*0.28, H*0.08, 0, W*0.28, H*0.08, W*0.52);
        ng.addColorStop(0,    'rgba(75,195,118,0.22)');
        ng.addColorStop(0.45, 'rgba(35,138,72,0.09)');
        ng.addColorStop(1,    'rgba(8,68,28,0)');
        ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H*0.55);
        // Bioluminescent ground glow
        const nb = ctx.createRadialGradient(W*0.50, H, 0, W*0.50, H, W*0.72);
        nb.addColorStop(0,    'rgba(18,155,72,0.22)');
        nb.addColorStop(0.45, 'rgba(8,88,35,0.09)');
        nb.addColorStop(1,    'rgba(2,28,8,0)');
        ctx.fillStyle = nb; ctx.fillRect(0, H*0.48, W, H*0.52);
      }

      // ── 3. Atmospheric layered forest depth fog ──────────────────────────
      const fogVis = { MORNING:0.55, AFTERNOON:0.38, EVENING:0.65, NIGHT:0.42 }[period] || 0.5;
      const [fogR,fogGc,fogB] = period === 'EVENING' ? [0,185,140] : period === 'NIGHT' ? [28,105,52] : period === 'MORNING' ? [165,255,100] : [120,220,55];
      for (let fi = 0; fi < 5; fi++) {
        const fy = H * (0.22 + fi * 0.15);
        const fw = W * (1.2 + fi * 0.18);
        const fh = H * (0.06 + fi * 0.012);
        const fAlpha = (0.018 + fi*0.012) * fogVis * (0.65 + 0.35 * Math.sin(t*0.6 + fi*1.1));
        const fX = (t * (0.08 + fi*0.02) * W * 0.1) % (fw * 0.5) - fw * 0.25;
        const fg = ctx.createLinearGradient(fX, fy, fX + fw, fy);
        fg.addColorStop(0,    `rgba(${fogR},${fogGc},${fogB},0)`);
        fg.addColorStop(0.22, `rgba(${fogR},${fogGc},${fogB},${fAlpha})`);
        fg.addColorStop(0.78, `rgba(${fogR},${fogGc},${fogB},${fAlpha * 0.80})`);
        fg.addColorStop(1,    `rgba(${fogR},${fogGc},${fogB},0)`);
        ctx.save();
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.ellipse(fX + fw*0.5, fy, fw*0.5, fh, 0, 0, Math.PI*2);
        ctx.fill(); ctx.restore();
      }

      // ── 4. Fireflies / bioluminescent spores (evening + night) ──────────
      if (period === 'EVENING' || period === 'NIGHT') {
        const ffCount = period === 'NIGHT' ? 32 : 18;
        const ffHue = period === 'EVENING' ? 158 : 128;
        for (let ff = 0; ff < ffCount; ff++) {
          const ffx = W * ((ff * 0.137 + Math.sin(t*0.55+ff*1.3)*0.06 + 1.0) % 1.0);
          const ffy = H * (0.25 + 0.68 * ((ff * 0.211 + Math.cos(t*0.48+ff*0.88)*0.05 + 1.0) % 1.0));
          const ffa = Math.max(0, 0.06 + 0.32 * Math.sin(t*1.8+ff*2.3));
          const ffG = ctx.createRadialGradient(ffx, ffy, 0, ffx, ffy, 9);
          ffG.addColorStop(0, `hsla(${ffHue+ff%3*18},92%,78%,${ffa*3.2})`);
          ffG.addColorStop(0.45, `hsla(${ffHue+ff%3*12},82%,58%,${ffa*1.4})`);
          ffG.addColorStop(1,    'rgba(8,120,32,0)');
          ctx.fillStyle = ffG; ctx.beginPath(); ctx.arc(ffx, ffy, 9, 0, Math.PI*2); ctx.fill();
        }
      }

      // ── 5. Ground atmospheric depth — dense lower shadow ────────────────
      const groundG = ctx.createLinearGradient(0, H*0.60, 0, H);
      const [gR,gGc,gB] = period === 'EVENING' ? [0,22,18] : period === 'NIGHT' ? [0,8,3] : period === 'MORNING' ? [2,22,5] : [1,16,3];
      groundG.addColorStop(0,    `rgba(${gR},${gGc},${gB},0)`);
      groundG.addColorStop(0.38, `rgba(${gR},${gGc},${gB},0.62)`);
      groundG.addColorStop(1,    `rgba(${gR},${gGc},${gB},0.92)`);
      ctx.fillStyle = groundG; ctx.fillRect(0, H*0.60, W, H*0.40);

      // ── 6. Cinematic edge vignette — darkness at both sides ──────────────
      const vigA = period === 'NIGHT' ? 0.95 : period === 'EVENING' ? 0.88 : 0.82;
      const [vR,vGc,vB] = period === 'EVENING' ? [0,4,4] : period === 'NIGHT' ? [0,2,0] : [0,4,1];
      // Left dark edge
      const vigL = ctx.createLinearGradient(0, 0, W*0.30, 0);
      vigL.addColorStop(0,    `rgba(${vR},${vGc},${vB},${vigA})`);
      vigL.addColorStop(0.55, `rgba(${vR},${vGc},${vB},${vigA*0.22})`);
      vigL.addColorStop(1,    `rgba(${vR},${vGc},${vB},0)`);
      ctx.fillStyle = vigL; ctx.fillRect(0, 0, W*0.32, H);
      // Right dark edge
      const vigR = ctx.createLinearGradient(W, 0, W*0.70, 0);
      vigR.addColorStop(0,    `rgba(${vR},${vGc},${vB},${vigA})`);
      vigR.addColorStop(0.55, `rgba(${vR},${vGc},${vB},${vigA*0.22})`);
      vigR.addColorStop(1,    `rgba(${vR},${vGc},${vB},0)`);
      ctx.fillStyle = vigR; ctx.fillRect(W*0.68, 0, W*0.32, H);
      // Radial center-depth vignette
      const vigRad = ctx.createRadialGradient(W*0.5, H*0.5, W*0.15, W*0.5, H*0.5, W*0.80);
      vigRad.addColorStop(0,    `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(0.62, `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(1,    `rgba(${vR},${vGc},${vB},${vigA*0.45})`);
      ctx.fillStyle = vigRad; ctx.fillRect(0, 0, W, H);
    },

    create(W, H) {
      const period = _getCanvasPeriod();
      const r = Math.random();
      if (r < 0.42) {
        // Falling leaf — real tumbling physics
        return {
          type: 'leaf',
          x: Math.random()*W*1.3 - W*0.15, y: -18 - Math.random()*50,
          vx: (Math.random()-0.5)*0.80,
          vy:  1.0 + Math.random()*1.8,   // real leaf speed
          rot: Math.random()*Math.PI*2,
          rotV: (Math.random()-0.5)*0.055,
          sz: 5 + Math.random()*9,
          hue: (period==='EVENING'||period==='NIGHT') ? 120+Math.random()*45|0 : 88+Math.random()*55|0,
          sat: 55+Math.random()*25|0,
          alpha: 0, maxAlpha: 0.60+Math.random()*0.30,
          life: 0, fadeIn: 10,
          sw: Math.random()*Math.PI*2, swAmp: 1.0+Math.random()*1.8, swSpd: 0.016+Math.random()*0.020,
        };
      } else if (r < 0.72) {
        // Bioluminescent spore (evening/night) or dust mote (day)
        return {
          type: period==='EVENING'||period==='NIGHT' ? 'spore' : 'dust',
          x: Math.random()*W*1.1-W*0.05, y: H+15,
          vx: (Math.random()-0.5)*0.5,
          vy: -(0.30+Math.random()*0.60),
          r: 1.5+Math.random()*3,
          hue: period==='EVENING'||period==='NIGHT' ? (Math.random()<0.5?168:285) : 105+Math.random()*60|0,
          alpha: 0, maxAlpha: period==='EVENING'||period==='NIGHT' ? 0.60+Math.random()*0.30 : 0.22+Math.random()*0.22,
          life: 0, fadeIn: 20, maxLife: 140+Math.random()*100|0,
          sw: Math.random()*Math.PI*2, swAmp: 0.5+Math.random()*1.0, swSpd: 0.010+Math.random()*0.015,
        };
      } else {
        // Forest mote — drifting upward
        return {
          type: 'mote',
          x: Math.random()*W, y: H*0.2+Math.random()*H*0.75,
          vx: (Math.random()-0.5)*0.28,
          vy: -(0.08+Math.random()*0.25),
          r: 0.8+Math.random()*1.5,
          alpha: 0, maxAlpha: 0.18+Math.random()*0.22,
          life: 0, fadeIn: 28, maxLife: 220+Math.random()*130|0,
          sw: Math.random()*Math.PI*2, swAmp: 0.35+Math.random()*0.75, swSpd: 0.007+Math.random()*0.011,
        };
      }
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.type === 'leaf') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = `hsl(${p.hue},${p.sat}%,32%)`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-p.sz*0.55, -p.sz*0.38, -p.sz*0.55, -p.sz*2.5, 0, -p.sz*3.0);
        ctx.bezierCurveTo( p.sz*0.55, -p.sz*2.5,  p.sz*0.55, -p.sz*0.38, 0, 0);
        ctx.fill();
        ctx.strokeStyle = `hsl(${p.hue+15},${p.sat-10}%,42%)`;
        ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-p.sz*3.0); ctx.stroke();
      } else if (p.type === 'spore') {
        const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*3.5);
        g.addColorStop(0, `hsla(${p.hue},90%,72%,1)`);
        g.addColorStop(0.4, `hsla(${p.hue},78%,55%,0.5)`);
        g.addColorStop(1, `hsla(${p.hue},65%,38%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*3.5,0,Math.PI*2); ctx.fill();
      } else if (p.type === 'dust') {
        ctx.fillStyle = 'rgba(195,240,195,1)';
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(220,230,210,0.8)';
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    },

    update(p, W, H) {
      p.life++;
      if (p.sw !== undefined) { p.sw+=p.swSpd; p.x+=p.vx+Math.sin(p.sw)*p.swAmp; } else p.x+=p.vx;
      p.y += p.vy;
      if (p.rot !== undefined) p.rot += p.rotV;
      const fi = Math.min(1, p.life/p.fadeIn);
      const fo = (p.maxLife && p.life>p.maxLife-22) ? Math.max(0,(p.maxLife-p.life)/22) : 1;
      p.alpha = p.maxAlpha*fi*fo;
      if (p.type==='leaf') return p.y < H+35;
      if (p.type==='spore'||p.type==='dust'||p.type==='mote') return p.life<(p.maxLife||280) && p.y>-50 && p.y<H+40;
      return p.y < H+30;
    },
  },

  // ── SAKURA (cherry) — Premium Japanese Garden Scene ──────────────────────
  // Reference: garden with stone path, reflective pond, red bridge, pagoda,
  // cherry tree trunks framing left+right, rolling blossoms hills.
  // Time-of-day: MORNING (pink/peach dawn), AFTERNOON (blue sky vivid),
  //              EVENING (dusk purple, lanterns), NIGHT (deep indigo, stars).
  cherry: {
    max: 70, rate: 0.20,
    _bokeh: null, _lanterns: null, _stars: null, _clouds: null,

    init(W, H) {
      _stars = [];
      // Background bokeh orbs
      this._bokeh = Array.from({ length: 24 }, (_, i) => ({
        x: (i%2===0 ? Math.random()*W*0.45 : W*0.55+Math.random()*W*0.45),
        y: H*0.42+Math.random()*H*0.62,
        r: 24+Math.random()*68,
        hue: 326+Math.floor(Math.random()*30),
        alpha: 0.04+Math.random()*0.08,
        phase: Math.random()*Math.PI*2,
        spd: 0.006+Math.random()*0.010,
        driftX: (Math.random()-0.5)*0.16,
        driftY: -(0.035+Math.random()*0.09),
      }));
      // Lanterns for evening
      this._lanterns = [
        { x: W*0.22, y: H*0.72, r: W*0.018, phase: 0, spd: 0.055 },
        { x: W*0.31, y: H*0.68, r: W*0.015, phase: 1.2, spd: 0.048 },
        { x: W*0.68, y: H*0.71, r: W*0.016, phase: 0.7, spd: 0.062 },
        { x: W*0.78, y: H*0.69, r: W*0.014, phase: 2.1, spd: 0.052 },
        // Bridge lanterns
        { x: W*0.58, y: H*0.60, r: W*0.012, phase: 0.3, spd: 0.070 },
        { x: W*0.72, y: H*0.58, r: W*0.011, phase: 1.5, spd: 0.058 },
      ];
      // Soft clouds
      this._clouds = Array.from({ length: 8 }, (_, i) => ({
        x: W*(0.05+i*0.12)+Math.random()*W*0.08, y: H*(0.04+Math.random()*0.18),
        w: W*(0.08+Math.random()*0.12), h: H*(0.028+Math.random()*0.04),
        phase: Math.random()*Math.PI*2, spd: 0.003+Math.random()*0.004,
        alpha: 0.45+Math.random()*0.35,
      }));
      // Night stars
      this._stars = Array.from({ length: 60 }, () => ({
        x: Math.random()*W, y: Math.random()*H*0.55,
        r: 0.4+Math.random()*1.2, alpha: 0.2+Math.random()*0.65,
        phase: Math.random()*Math.PI*2, spd: 0.015+Math.random()*0.025,
      }));
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend  = _getSmoothBlend();
      const t = _frame * 0.010;

      // ── 1. Sky gradient — atmospheric sakura emotional palette ──────────
      // Reference: warm saturated rose-pink from bottom, violet depth at top
      // MORNING: medium pink with brighter center warmth
      // AFTERNOON: deeper saturated crimson-red-pink
      // EVENING: warm pink with golden orange low glow
      // NIGHT: deep indigo-violet with subtle moonlit rose
      const SKY = {
        MORNING:   { t:[ 88, 32,105], m:[165, 65,128], b:[225,105,148] },
        AFTERNOON: { t:[ 62, 12, 58], m:[138, 32, 88], b:[210, 62,108] },
        EVENING:   { t:[ 55, 18, 62], m:[145, 48,105], b:[228, 95,128] },
        NIGHT:     { t:[ 10,  6, 28], m:[ 28, 12, 52], b:[ 58, 22, 82] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,    _rgb(sk.t));
      skyG.addColorStop(0.46, _rgb(sk.m));
      skyG.addColorStop(1,    _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Signature period glow ─────────────────────────────────────────
      // MORNING: soft pink-white center bloom (filtered sun through petals)
      if (period === 'MORNING') {
        const mg = ctx.createRadialGradient(W*0.50, H*0.44, 0, W*0.50, H*0.44, W*0.55);
        mg.addColorStop(0,    'rgba(255,225,240,0.52)');
        mg.addColorStop(0.16, 'rgba(255,190,220,0.30)');
        mg.addColorStop(0.42, 'rgba(235,148,188,0.12)');
        mg.addColorStop(1,    'rgba(200,90,148,0)');
        ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H);
      }
      // AFTERNOON: deeper bottom warmth + upper violet depth
      if (period === 'AFTERNOON') {
        const ag = ctx.createRadialGradient(W*0.50, H*0.88, 0, W*0.50, H*0.88, W*0.72);
        ag.addColorStop(0,    'rgba(255,85,115,0.52)');
        ag.addColorStop(0.28, 'rgba(220,42,88,0.25)');
        ag.addColorStop(0.60, 'rgba(175,22,65,0.10)');
        ag.addColorStop(1,    'rgba(120,8,42,0)');
        ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H);
        // Upper violet atmospheric press
        const av = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.62);
        av.addColorStop(0,    'rgba(95,15,75,0.32)');
        av.addColorStop(0.55, 'rgba(62,8,52,0.14)');
        av.addColorStop(1,    'rgba(38,4,32,0)');
        ctx.fillStyle = av; ctx.fillRect(0, 0, W, H*0.65);
      }
      // EVENING: warm orange-gold glow from lower right
      if (period === 'EVENING') {
        const eg = ctx.createRadialGradient(W*0.78, H*0.82, 0, W*0.78, H*0.82, W*0.65);
        eg.addColorStop(0,    'rgba(255,158,55,0.58)');
        eg.addColorStop(0.18, 'rgba(245,95,32,0.30)');
        eg.addColorStop(0.42, 'rgba(195,45,18,0.12)');
        eg.addColorStop(1,    'rgba(110,12,8,0)');
        ctx.fillStyle = eg; ctx.fillRect(0, H*0.40, W, H*0.60);
        // Violet upper complement
        const ev = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.58);
        ev.addColorStop(0,    'rgba(115,22,105,0.28)');
        ev.addColorStop(0.55, 'rgba(72,10,68,0.12)');
        ev.addColorStop(1,    'rgba(42,4,40,0)');
        ctx.fillStyle = ev; ctx.fillRect(0, 0, W, H*0.62);
      }
      // NIGHT: moonlit rose glow — subtle
      if (period === 'NIGHT') {
        const ng = ctx.createRadialGradient(W*0.32, H*0.12, 0, W*0.32, H*0.12, W*0.42);
        ng.addColorStop(0,    'rgba(215,175,245,0.22)');
        ng.addColorStop(0.45, 'rgba(158,105,210,0.09)');
        ng.addColorStop(1,    'rgba(88,42,130,0)');
        ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H*0.48);
      }

      // ── 3. Full-screen warm atmospheric bloom — the signature atmosphere
      // This creates the characteristic "glowing petal air" of sakura season
      const abloom = { MORNING:0.25, AFTERNOON:0.32, EVENING:0.28, NIGHT:0.14 }[period] || 0.22;
      const [aR,aGc,aB] = period === 'NIGHT' ? [130,60,148] : period === 'EVENING' ? [245,115,145] : [255,140,185];
      // Left atmospheric edge warmth
      const albL = ctx.createRadialGradient(0, H*0.52, 0, 0, H*0.52, W*0.52);
      albL.addColorStop(0,    `rgba(${aR},${aGc},${aB},${abloom})`);
      albL.addColorStop(0.55, `rgba(${aR},${aGc},${aB},${abloom*0.45})`);
      albL.addColorStop(1,    `rgba(${aR},${aGc},${aB},0)`);
      ctx.fillStyle = albL; ctx.fillRect(0, 0, W*0.60, H);
      // Right atmospheric edge warmth
      const albR = ctx.createRadialGradient(W, H*0.50, 0, W, H*0.50, W*0.52);
      albR.addColorStop(0,    `rgba(${aR},${aGc},${aB},${abloom * 0.85})`);
      albR.addColorStop(0.55, `rgba(${aR},${aGc},${aB},${abloom*0.38})`);
      albR.addColorStop(1,    `rgba(${aR},${aGc},${aB},0)`);
      ctx.fillStyle = albR; ctx.fillRect(W*0.40, 0, W*0.60, H);
      // Bottom warmth (the "petal carpet" atmospheric glow)
      const albBtm = ctx.createRadialGradient(W*0.50, H, 0, W*0.50, H, W*0.80);
      albBtm.addColorStop(0,    `rgba(${aR+10},${Math.max(0,aGc-30)},${aB-20},${abloom*1.28})`);
      albBtm.addColorStop(0.45, `rgba(${aR},${aGc},${aB},${abloom*0.52})`);
      albBtm.addColorStop(1,    `rgba(${aR},${aGc},${aB},0)`);
      ctx.fillStyle = albBtm; ctx.fillRect(0, H*0.38, W, H*0.62);

      // ── 4. Bokeh depth field — background petal-light orbs ──────────────
      // These simulate the out-of-focus petal glow visible in reference image
      const bokehVis = { MORNING:1.0, AFTERNOON:0.88, EVENING:0.78, NIGHT:0.48 }[period] || 0.8;
      const bR = period === 'NIGHT' ? 175 : period === 'EVENING' ? 255 : 255;
      const bGc = period === 'NIGHT' ? 110 : period === 'EVENING' ? 148 : 168;
      const bB = period === 'NIGHT' ? 205 : period === 'EVENING' ? 175 : 215;
      const numBokeh = 18;
      for (let bi = 0; bi < numBokeh; bi++) {
        const bx = W * ((bi * 0.0618 + Math.sin(t*0.22 + bi*0.75)*0.012 + 1.0) % 1.0);
        const by = H * (0.12 + ((bi*0.1618 + Math.sin(t*0.18 + bi)*0.02) % 0.88));
        const br = W * (0.025 + 0.045 * ((bi*0.382) % 1.0));
        const ba = 0.04 + 0.07 * ((bi * 0.618 + Math.sin(t*0.30 + bi*0.42)) % 1.0);
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        bg.addColorStop(0,    `rgba(${bR},${bGc},${bB},${Math.abs(ba) * bokehVis})`);
        bg.addColorStop(0.55, `rgba(${bR},${bGc},${bB},${Math.abs(ba)*0.42 * bokehVis})`);
        bg.addColorStop(1,    `rgba(${bR},${bGc},${bB},0)`);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2); ctx.fill();
      }

      // ── 5. Horizon atmospheric line ─────────────────────────────────────
      const horizY = H * 0.72;
      const hGlow = ctx.createLinearGradient(0, horizY - 5, 0, horizY + 5);
      hGlow.addColorStop(0,   `rgba(${aR},${aGc},${aB},0)`);
      hGlow.addColorStop(0.5, `rgba(${aR},${aGc},${aB},0.38)`);
      hGlow.addColorStop(1,   `rgba(${aR},${aGc},${aB},0)`);
      ctx.fillStyle = hGlow; ctx.fillRect(0, horizY - 8, W, 16);

      // ── 6. Cinematic edge + radial vignette ─────────────────────────────
      const [vR,vGc,vB] = period === 'NIGHT' ? [4,2,12] : period === 'EVENING' ? [8,4,18] : [6,2,14];
      const vigA = period === 'NIGHT' ? 0.80 : 0.62;
      const vigRad = ctx.createRadialGradient(W*0.5, H*0.5, W*0.20, W*0.5, H*0.5, W*0.88);
      vigRad.addColorStop(0,    `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(0.58, `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(1,    `rgba(${vR},${vGc},${vB},${vigA})`);
      ctx.fillStyle = vigRad; ctx.fillRect(0, 0, W, H);
    },

    create(W, H) {
      const r = Math.random();
      if (r < 0.68) {
        // Cherry petal — real tumbling fall speed (2.5x faster)
        return {
          type: 'petal',
          x: Math.random()*W*1.40-W*0.20,
          y: -22-Math.random()*80,
          vx: (Math.random()-0.5)*1.80,
          vy:  2.8+Math.random()*2.8,  // real petal speed — faster tumble
          rot: Math.random()*Math.PI*2,
          rotV: (Math.random()-0.5)*0.18,
          sz: 3.5+Math.random()*7.5,
          alpha: 0, maxAlpha: 0.60+Math.random()*0.35,
          life: 0, fadeIn: 8,
          sw: Math.random()*Math.PI*2,
          swAmp: 1.8+Math.random()*3.2, swSpd: 0.018+Math.random()*0.028,
          col: `hsl(${328+Math.random()*32|0},${65+Math.random()*22|0}%,${70+Math.random()*18|0}%)`,
        };
      } else if (r < 0.88) {
        return {
          type: 'bokeh',
          x: Math.random()*W, y: H*0.55+Math.random()*H*0.5,
          vx: (Math.random()-0.5)*0.35, vy: -(0.12+Math.random()*0.35),
          r: 5+Math.random()*20, hue: 323+Math.floor(Math.random()*38),
          alpha: 0, maxAlpha: 0.07+Math.random()*0.12,
          life: 0, fadeIn: 28, maxLife: 140+Math.floor(Math.random()*90),
          sw: Math.random()*Math.PI*2, swAmp: 0.4+Math.random()*0.9, swSpd: 0.009+Math.random()*0.012,
        };
      } else {
        return {
          type: 'sparkle',
          x: Math.random()*W, y: Math.random()*H,
          vx: (Math.random()-0.5)*0.42, vy: -(0.12+Math.random()*0.32),
          r: 0.7+Math.random()*1.6,
          alpha: 0, maxAlpha: 0.50+Math.random()*0.35,
          life: 0, fadeIn: 9, maxLife: 50+Math.floor(Math.random()*42),
        };
      }
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.type === 'petal') {
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.col;
        // Realistic oval petal shape
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-p.sz*0.58, -p.sz*0.42, -p.sz*0.55, -p.sz*2.55, 0, -p.sz*3.05);
        ctx.bezierCurveTo( p.sz*0.55, -p.sz*2.55,  p.sz*0.58, -p.sz*0.42, 0, 0);
        ctx.fill();
        // Petal vein
        ctx.strokeStyle = `rgba(255,255,255,0.28)`;
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-p.sz*3.0); ctx.stroke();
      } else if (p.type === 'bokeh') {
        const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
        g.addColorStop(0,`hsla(${p.hue},92%,82%,1)`); g.addColorStop(0.45,`hsla(${p.hue},82%,65%,0.5)`);
        g.addColorStop(1,`hsla(${p.hue},72%,50%,0)`); ctx.fillStyle=g;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      } else {
        ctx.strokeStyle='rgba(255,215,252,1)'; ctx.lineWidth=p.r; ctx.lineCap='round';
        const s=p.r*4;
        ctx.beginPath(); ctx.moveTo(p.x-s,p.y); ctx.lineTo(p.x+s,p.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x,p.y-s); ctx.lineTo(p.x,p.y+s); ctx.stroke();
      }
      ctx.restore();
    },

    update(p, W, H) {
      p.life++; p.sw += p.swSpd;
      p.x += p.vx + Math.sin(p.sw)*p.swAmp; p.y += p.vy;
      if (p.rot !== undefined) p.rot += p.rotV;
      const fi = Math.min(1, p.life/p.fadeIn);
      const fo = (p.maxLife && p.life>p.maxLife-18) ? Math.max(0,(p.maxLife-p.life)/18) : 1;
      p.alpha = p.maxAlpha*fi*fo;
      if (p.type==='petal') return p.y < H+45;
      if (p.type==='bokeh') return p.life<p.maxLife && p.y>-45;
      return p.life<p.maxLife;
    },
  },


  // ── OCEAN — Deep Sea Premium Rework ─────────────────────────────────────────
  // Layered underwater world: caustic light, real kelp, clickable bubbles,
  // realistic fish schools, coral reef, time-of-day depth lighting.
  ocean: {
    max: 45, rate: 0.14,
    _caustics: null, _kelp: null, _coral: null, _fishSchools: null,
    _bubblesStore: [],  // permanent bubble store for click detection
    _pops: [],          // pop animations

    init(W, H) {
      _stars = [];
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);

      // Animated caustic light patches — organic shifting ellipses from surface
      this._caustics = Array.from({ length: 22 }, () => ({
        x: rng(0, W), y: rng(H * 0.0, H * 0.55),
        rx: rng(18, 72), ry: rng(6, 20),
        rot: rng(0, Math.PI),
        phase: rng(0, Math.PI * 2),
        spd:   rng(0.012, 0.030),
        driftX: rng(-0.18, 0.18),
      }));

      // Sea grass — wide flat leaves dense at seafloor
      this._seaGrass = Array.from({ length: 42 }, (_, i) => ({
        x: W * 0.005 + (i / 41) * W * 0.99 + rng(-W * 0.012, W * 0.012),
        baseY: H,
        height: H * rng(0.038, 0.11),
        blades: Math.floor(rng(3, 7)),
        phase: rng(0, Math.PI * 2),
        swSpd: rng(0.010, 0.022),
        swAmp: rng(8, 22),
        hue: 130 + rng(0, 40)|0,
        sat: 62 + rng(0, 25)|0,
      }));

      // Kelp forest: tall swaying seaweed along sides + scattered mid
      this._kelp = Array.from({ length: 18 }, (_, i) => {
        const side = i < 7 ? 'L' : i < 14 ? 'R' : 'M';
        const x = side === 'L' ? rng(W * 0.0, W * 0.28)
                : side === 'R' ? rng(W * 0.72, W * 1.0)
                : rng(W * 0.30, W * 0.70);
        return {
          x, baseY: H,
          height: H * rng(0.30, 0.72),
          segs: Math.floor(rng(7, 13)),
          hue: 128 + rng(0, 30)|0,
          sat: 58 + rng(0, 22)|0,
          w: rng(3.5, 8.0),
          phase: rng(0, Math.PI * 2),
          swSpd: rng(0.008, 0.018),
          swAmp: rng(12, 36),
          sub: Math.floor(rng(0, 3)), // sub-fronds count
        };
      });

      // Coral formations: fan coral, brain coral, branch coral, anemone
      this._coral = Array.from({ length: 20 }, (_, i) => {
        const types = ['fan', 'branch', 'anemone', 'brain', 'tube'];
        return {
          x: W * 0.02 + (i / 19) * W * 0.96,
          h: H * rng(0.06, 0.20),
          type: types[i % types.length],
          hue: [0, 22, 280, 185, 320, 45, 350, 60, 200][i % 9],
          w: rng(6, 20),
          phase: rng(0, Math.PI * 2),
          swSpd: rng(0.010, 0.022),
          sub: Math.floor(rng(2, 6)),
        };
      });

      // Fish schools: vibrant tropical colors, varied sizes and behaviors
      this._fishSchools = [
        // Tropical school - small, fast, vivid colorful
        { fish: Array.from({ length: 7 }, (_, i) => ({
          x: rng(-200, W + 200), y: H * rng(0.12, 0.55),
          vx: (rng(0,1) < 0.5 ? -1 : 1) * rng(0.8, 1.6),
          vy: (rng(-1,1)) * 0.2,
          sz: rng(8, 14), phase: i * 0.7,
          hue: [18, 44, 185, 330, 55, 280, 12][i % 7],
          sat: 92, col2: [355, 55, 210, 280, 90, 320, 42][i % 7],
          bodyRatio: 0.35, finH: 0.55,
        })), type: 'tropical', offsetSpread: 28 },
        // Deep fish - larger, slower, jewel tones
        { fish: Array.from({ length: 4 }, (_, i) => ({
          x: rng(-300, W + 300), y: H * rng(0.50, 0.80),
          vx: (rng(0,1) < 0.5 ? -1 : 1) * rng(0.3, 0.65),
          vy: (rng(-1,1)) * 0.12,
          sz: rng(22, 42), phase: i * 1.1,
          hue: [195, 225, 185, 215][i % 4], sat: 72, col2: [240, 260, 200, 185][i % 4],
          bodyRatio: 0.30, finH: 0.48,
        })), type: 'deep', offsetSpread: 45 },
        // Clownfish school - iconic orange+white stripe
        { fish: Array.from({ length: 5 }, (_, i) => ({
          x: rng(-150, W + 150), y: H * rng(0.30, 0.68),
          vx: (rng(0,1) < 0.5 ? -1 : 1) * rng(0.5, 1.0),
          vy: (rng(-1,1)) * 0.15,
          sz: rng(15, 25), phase: i * 0.9,
          hue: 22, sat: 95, col2: 0, // orange with white-ish stripe
          bodyRatio: 0.40, finH: 0.65,
        })), type: 'clown', offsetSpread: 18 },
      ];

      this._bubblesStore = [];
      this._pops = [];
    },

    _drawKelp(ctx, k, t, period) {
      const segLen = k.height / k.segs;
      const sway = Math.sin(k.phase + t) * k.swAmp;
      const kLight = period === 'NIGHT' ? 18 : period === 'EVENING' ? 22 : 32;
      ctx.save();
      ctx.strokeStyle = `hsl(${k.hue},${k.sat}%,${kLight}%)`;
      ctx.lineWidth = k.w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      let px = k.x, py = k.baseY;
      const pts = [[px, py]];
      for (let s = 0; s < k.segs; s++) {
        const prog = s / k.segs;
        const sw = sway * prog * prog; // more sway at tip
        const nx = k.x + sw;
        const ny = k.baseY - (s + 1) * segLen;
        pts.push([nx, ny]);
      }

      // Draw main stalk as smooth bezier chain
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i+1][0]) * 0.5;
        const my = (pts[i][1] + pts[i+1][1]) * 0.5;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length-1][0], pts[pts.length-1][1]);
      ctx.stroke();

      // Sub-fronds every few segments
      if (k.sub > 0) {
        ctx.lineWidth = k.w * 0.42;
        for (let sf = 0; sf < k.sub; sf++) {
          const si = Math.floor((sf + 1) * k.segs / (k.sub + 1));
          if (si >= pts.length) continue;
          const [fx, fy] = pts[si];
          const flen = segLen * 1.2;
          const fdir = sf % 2 === 0 ? 1 : -1;
          const fsway = sw * (si / k.segs);
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.quadraticCurveTo(
            fx + fdir * flen * 0.55 + fsway * 0.4, fy - flen * 0.45,
            fx + fdir * flen * 0.85 + fsway, fy - flen * 0.92
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    },

    _drawFish(ctx, f, t, period) {
      const dir = f.vx >= 0 ? 1 : -1;
      f.phase += 0.055;
      const tailWag = Math.sin(f.phase * 2.2) * f.sz * 0.25;
      const bodyWobble = Math.sin(f.phase) * f.sz * 0.03;

      const alpha = period === 'NIGHT' ? 0.65 : 0.90;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(f.x, f.y + bodyWobble);
      ctx.scale(dir, 1);

      // Vibrant body gradient
      const bg = ctx.createLinearGradient(-f.sz, 0, f.sz, 0);
      bg.addColorStop(0,    `hsl(${f.hue},${f.sat}%,30%)`);
      bg.addColorStop(0.35, `hsl(${f.hue},${f.sat}%,58%)`);
      bg.addColorStop(0.65, `hsl(${f.hue},${f.sat}%,62%)`);
      bg.addColorStop(1,    `hsl(${f.hue},${f.sat - 8}%,38%)`);

      // Fish body
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(f.sz * 0.10, 0, f.sz * 0.82, f.sz * f.bodyRatio, 0, 0, Math.PI * 2);
      ctx.fill();

      // Belly highlight shimmer
      ctx.save(); ctx.globalAlpha = 0.28;
      const belly = ctx.createLinearGradient(0, -f.sz * f.bodyRatio, 0, f.sz * f.bodyRatio);
      belly.addColorStop(0,   `hsl(${f.hue},${f.sat}%,85%)`);
      belly.addColorStop(0.5, `hsl(${f.hue},${f.sat - 5}%,75%)`);
      belly.addColorStop(1,   `hsl(${f.hue},${f.sat}%,50%)`);
      ctx.fillStyle = belly;
      ctx.beginPath();
      ctx.ellipse(f.sz * 0.10, f.sz * f.bodyRatio * 0.20, f.sz * 0.55, f.sz * f.bodyRatio * 0.50, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.restore();

      // Caudal fin (tail)
      ctx.fillStyle = `hsl(${f.hue - 12},${f.sat}%,45%)`;
      ctx.beginPath();
      ctx.moveTo(-f.sz * 0.70, 0);
      ctx.lineTo(-f.sz * 1.45, -f.sz * f.finH * 0.65 + tailWag);
      ctx.lineTo(-f.sz * 1.48, 0);
      ctx.lineTo(-f.sz * 1.45,  f.sz * f.finH * 0.65 - tailWag);
      ctx.closePath(); ctx.fill();

      // Dorsal fin
      ctx.beginPath();
      ctx.moveTo(-f.sz * 0.10, -f.sz * f.bodyRatio);
      ctx.quadraticCurveTo(f.sz * 0.15, -f.sz * f.bodyRatio * 1.65, f.sz * 0.55, -f.sz * f.bodyRatio);
      ctx.closePath();
      ctx.fillStyle = `hsl(${f.hue + 5},${f.sat}%,42%)`; ctx.fill();

      // Pectoral fin (tall-body fish)
      if (f.bodyRatio > 0.38) {
        ctx.beginPath();
        ctx.moveTo(f.sz * 0.10, f.sz * 0.10);
        ctx.quadraticCurveTo(-f.sz * 0.15, f.sz * 0.68, f.sz * 0.30, f.sz * f.bodyRatio * 0.90);
        ctx.quadraticCurveTo(f.sz * 0.50, f.sz * 0.42, f.sz * 0.10, f.sz * 0.10);
        ctx.fillStyle = `hsl(${f.hue + 14},${f.sat - 5}%,50%)`; ctx.fill();
      }

      // Vivid contrast stripe
      ctx.save(); ctx.globalAlpha *= 0.60;
      ctx.fillStyle = `hsl(${f.col2},92%,78%)`;
      ctx.beginPath();
      ctx.ellipse(f.sz * 0.20, 0, f.sz * 0.21, f.sz * f.bodyRatio * 0.65, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.restore();

      // Eye
      const eyeX = f.sz * 0.52, eyeY = -f.sz * 0.08;
      ctx.fillStyle = 'rgba(5,3,1,0.95)';
      ctx.beginPath(); ctx.arc(eyeX, eyeY, f.sz * 0.100, 0, Math.PI * 2); ctx.fill();
      // Iris ring
      ctx.fillStyle = `hsl(${f.hue + 25},72%,55%)`;
      ctx.beginPath(); ctx.arc(eyeX + f.sz * 0.018, eyeY - f.sz * 0.016, f.sz * 0.056, 0, Math.PI * 2); ctx.fill();
      // Pupil
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.beginPath(); ctx.arc(eyeX + f.sz * 0.022, eyeY - f.sz * 0.018, f.sz * 0.034, 0, Math.PI * 2); ctx.fill();
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      ctx.beginPath(); ctx.arc(eyeX + f.sz * 0.040, eyeY - f.sz * 0.040, f.sz * 0.030, 0, Math.PI * 2); ctx.fill();

      ctx.restore();
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend  = _getSmoothBlend();
      const t = _frame * 0.016;

      // ── 1. Water column gradient — the infinite ocean depth ──────────────
      // MORNING: lighter teal-blue near surface, dark abyss below
      // AFTERNOON: vivid cyan-blue mid-water, radiant caustic light
      // EVENING: cooler teal shifting toward twilight-deep
      // NIGHT: near-black abyss with bioluminescent hints
      const WATER = {
        MORNING:   { t:[ 0,105,168], m:[  0, 62,118], b:[  0, 28, 72] },
        AFTERNOON: { t:[ 0,148,215], m:[  0, 98,172], b:[  0, 48,112] },
        EVENING:   { t:[ 0, 62,118], m:[  0, 38, 88], b:[  0, 18, 52] },
        NIGHT:     { t:[ 0, 18, 52], m:[  0,  8, 28], b:[  0,  3, 14] },
      };
      const wc = _blendPeriodColors(WATER, blend);
      const wg = ctx.createLinearGradient(0, 0, 0, H);
      wg.addColorStop(0,    _rgb(wc.t));
      wg.addColorStop(0.42, _rgb(wc.m));
      wg.addColorStop(1,    _rgb(wc.b));
      ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);

      // ── 2. Surface caustic light — light refracting through water ────────
      // This is the signature effect: rippling light from above
      const causticAmt = { MORNING:1.0, AFTERNOON:1.35, EVENING:0.55, NIGHT:0.0 }[period] || 0.5;
      if (causticAmt > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        this._caustics.forEach(c => {
          c.phase += c.spd; c.x += c.driftX;
          if (c.x < -80) c.x = W + 80;
          if (c.x > W + 80) c.x = -80;
          const pulse = 0.42 + 0.58 * Math.abs(Math.sin(c.phase));
          const a = causticAmt * 0.045 * pulse;
          const cy = c.y + Math.sin(c.phase * 0.72) * 16;
          ctx.save();
          ctx.translate(c.x, cy); ctx.rotate(c.rot + c.phase * 0.06);
          ctx.scale(1, c.ry / c.rx);
          const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, c.rx);
          cg.addColorStop(0,    `rgba(108,248,255,${a * 3.2})`);
          cg.addColorStop(0.38, `rgba(48,218,255,${a * 1.4})`);
          cg.addColorStop(1,    'rgba(8,168,235,0)');
          ctx.fillStyle = cg;
          ctx.beginPath(); ctx.arc(0, 0, c.rx, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        });
        ctx.restore();
      }

      // ── 3. Volumetric light shafts from surface ───────────────────────────
      // Diagonal shafts of sunlight piercing down through water
      const shaftAmt = { MORNING:0.65, AFTERNOON:0.88, EVENING:0.28, NIGHT:0.0 }[period] || 0.5;
      if (shaftAmt > 0.05) {
        for (let si = 0; si < 6; si++) {
          const sx = W * (0.08 + si * 0.16) + Math.sin(t * 0.25 + si * 1.1) * W * 0.025;
          const sw2 = W * (0.055 + 0.025 * Math.sin(t * 0.3 + si));
          const sa = shaftAmt * (0.05 + 0.028 * Math.abs(Math.sin(t * 0.55 + si * 1.4)));
          const shG = ctx.createLinearGradient(sx, 0, sx + sw2 * 0.5, H * 0.72);
          shG.addColorStop(0,    `rgba(145,245,255,${sa * 2.2})`);
          shG.addColorStop(0.30, `rgba(68,215,248,${sa * 1.0})`);
          shG.addColorStop(0.65, `rgba(22,168,225,${sa * 0.35})`);
          shG.addColorStop(1,    'rgba(0,105,185,0)');
          ctx.fillStyle = shG;
          ctx.beginPath();
          ctx.moveTo(sx, 0); ctx.lineTo(sx + sw2, 0);
          ctx.lineTo(sx + sw2 * 2.2, H * 0.72); ctx.lineTo(sx - sw2 * 0.8, H * 0.72);
          ctx.closePath(); ctx.fill();
        }
      }

      // ── 4. Ocean surface shimmer — top gradient band ──────────────────────
      const surfAmt = { MORNING:0.35, AFTERNOON:0.48, EVENING:0.18, NIGHT:0.0 }[period] || 0.2;
      if (surfAmt > 0) {
        const sfG = ctx.createLinearGradient(0, 0, 0, H * 0.28);
        sfG.addColorStop(0,   `rgba(58,228,255,${surfAmt * 0.82})`);
        sfG.addColorStop(0.28, `rgba(22,188,245,${surfAmt * 0.38})`);
        sfG.addColorStop(1,   'rgba(0,125,210,0)');
        ctx.fillStyle = sfG; ctx.fillRect(0, 0, W, H * 0.28);
      }

      // ── 5. Bioluminescent ambient glow (evening + night) ──────────────────
      const bioAmt = { MORNING:0.0, AFTERNOON:0.0, EVENING:0.45, NIGHT:1.0 }[period] || 0;
      if (bioAmt > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (let bi = 0; bi < 22; bi++) {
          const bx = W * ((bi * 0.0809 + Math.sin(t*0.38+bi*1.22)*0.04 + 1.0) % 1.0);
          const by = H * (0.18 + 0.75 * ((bi * 0.1618 + Math.cos(t*0.28+bi*0.88)*0.03 + 1.0) % 1.0));
          const ba = bioAmt * 0.045 * (0.38 + 0.62 * Math.abs(Math.sin(t * 2.2 + bi * 1.7)));
          const br = 18 + 22 * ((bi * 0.382) % 1.0);
          const hue = 165 + (bi % 4) * 22;
          const bg2 = ctx.createRadialGradient(bx, by, 0, bx, by, br);
          bg2.addColorStop(0,   `hsla(${hue},95%,75%,${ba * 4.5})`);
          bg2.addColorStop(0.45, `hsla(${hue},85%,55%,${ba * 1.8})`);
          bg2.addColorStop(1,   `hsla(${hue},72%,38%,0)`);
          ctx.fillStyle = bg2; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }

      // ── 6. Atmospheric depth fog layers — mid-water haze ─────────────────
      const [fogR,fogGc,fogB] = period === 'NIGHT' ? [0,28,62] : period === 'EVENING' ? [0,42,88] : [0,88,155];
      for (let fi = 0; fi < 4; fi++) {
        const fy = H * (0.25 + fi * 0.18);
        const fw = W * (1.5 + fi * 0.2);
        const fA = (0.025 + fi * 0.012) * (period === 'NIGHT' ? 0.65 : 0.95)
                   * (0.55 + 0.45 * Math.sin(t * 0.45 + fi * 1.3));
        const fX = ((t * (0.06 + fi * 0.015) * W * 0.08) % (fw * 0.4)) - fw * 0.2;
        const fgr = ctx.createLinearGradient(fX, fy, fX + fw, fy);
        fgr.addColorStop(0,    `rgba(${fogR},${fogGc},${fogB},0)`);
        fgr.addColorStop(0.25, `rgba(${fogR},${fogGc},${fogB},${fA})`);
        fgr.addColorStop(0.75, `rgba(${fogR},${fogGc},${fogB},${fA * 0.78})`);
        fgr.addColorStop(1,    `rgba(${fogR},${fogGc},${fogB},0)`);
        ctx.save(); ctx.fillStyle = fgr;
        ctx.beginPath(); ctx.ellipse(fX + fw * 0.5, fy, fw * 0.5, H * 0.055, 0, 0, Math.PI*2);
        ctx.fill(); ctx.restore();
      }

      // ── 7. Pop animations ─────────────────────────────────────────────────
      this._pops = this._pops.filter(pop => {
        pop.frame++;
        const prog = pop.frame / pop.maxFrame;
        ctx.save();
        ctx.globalAlpha = (1 - prog) * 0.85;
        ctx.strokeStyle = 'rgba(180,240,255,1)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pop.x, pop.y, pop.r * (1 + prog * 2.5), 0, Math.PI * 2); ctx.stroke();
        for (let di = 0; di < 6; di++) {
          const da = (di / 6) * Math.PI * 2;
          const dr = pop.r * (1.8 + prog * 3.5);
          ctx.fillStyle = 'rgba(150,235,255,1)';
          ctx.beginPath(); ctx.arc(pop.x + Math.cos(da)*dr, pop.y + Math.sin(da)*dr, 1.5*(1-prog), 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();
        return pop.frame < pop.maxFrame;
      });

      // ── 8. Cinematic depth vignette ───────────────────────────────────────
      // Edges are very dark — the abyss closes in
      const [vR,vGc,vB] = period === 'NIGHT' ? [0,1,8] : period === 'EVENING' ? [0,3,14] : [0,4,18];
      const vigA = period === 'NIGHT' ? 0.88 : period === 'EVENING' ? 0.72 : 0.58;
      const dv = ctx.createRadialGradient(W*0.5, H*0.46, W*0.18, W*0.5, H*0.46, W*0.88);
      dv.addColorStop(0,    `rgba(${vR},${vGc},${vB},0)`);
      dv.addColorStop(0.58, `rgba(${vR},${vGc},${vB},0)`);
      dv.addColorStop(1,    `rgba(${vR},${vGc},${vB},${vigA})`);
      ctx.fillStyle = dv; ctx.fillRect(0, 0, W, H);

      // Sea floor dark band
      const sfG = ctx.createLinearGradient(0, H * 0.82, 0, H);
      sfG.addColorStop(0,   `rgba(${vR},${vGc},${vB},0)`);
      sfG.addColorStop(0.5, `rgba(${vR},${vGc},${vB},${vigA * 0.62})`);
      sfG.addColorStop(1,   `rgba(${vR},${vGc},${vB},${vigA * 0.95})`);
      ctx.fillStyle = sfG; ctx.fillRect(0, H * 0.82, W, H * 0.18);
    },


    // Bubble click detection
    handleClick(x, y) {
      let popped = false;
      this._bubblesStore = this._bubblesStore.filter(b => {
        const dist = Math.hypot(b.x - x, b.y - y);
        if (dist <= b.r + 8) {
          this._pops.push({ x: b.x, y: b.y, r: b.r, frame: 0, maxFrame: 22 });
          popped = true;
          return false; // remove bubble
        }
        return true;
      });
      return popped;
    },

    create(W, H) {
      const b = {
        type: 'bubble',
        x: W * 0.04 + Math.random() * W * 0.92,
        y: H + 18 + Math.random() * 60, // start below screen
        vx: (Math.random() - 0.5) * 0.45,
        vy: -(0.40 + Math.random() * 1.10),
        r: 2.5 + Math.random() * 11,
        alpha: 0, maxAlpha: 0.12 + Math.random() * 0.22,
        sw: Math.random() * Math.PI * 2,
        swAmp: 0.6 + Math.random() * 1.4,
        swSpd: 0.015 + Math.random() * 0.022,
        life: 0,
        popped: false,
      };
      this._bubblesStore.push(b);
      return b;
    },

    draw(ctx, p) {
      if (p.popped) return;
      ctx.save(); ctx.globalAlpha = p.alpha;
      // Main bubble
      ctx.strokeStyle = 'rgba(160, 240, 255, 0.90)';
      ctx.lineWidth = Math.max(0.6, p.r * 0.08);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      // Inner shimmer fill
      const bg = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, 0, p.x, p.y, p.r);
      bg.addColorStop(0, 'rgba(255,255,255,0.14)');
      bg.addColorStop(0.6, 'rgba(180,245,255,0.06)');
      bg.addColorStop(1, 'rgba(80,195,240,0)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      // Highlight specular
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(p.x - p.r * 0.30, p.y - p.r * 0.32, p.r * 0.22, 0, Math.PI * 2); ctx.fill();
      if (p.r > 6) {
        ctx.fillStyle = 'rgba(200,245,255,0.28)';
        ctx.beginPath(); ctx.arc(p.x + p.r * 0.18, p.y + p.r * 0.22, p.r * 0.10, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    },

    update(p, W, H) {
      if (p.popped) return false;
      p.life++; p.sw += p.swSpd;
      p.x += p.vx + Math.sin(p.sw) * p.swAmp;
      p.y += p.vy;
      // Gentle x clamp
      if (p.x < p.r) p.x = p.r;
      if (p.x > W - p.r) p.x = W - p.r;
      // Fade in at bottom, fade out at top
      const fadeIn = Math.min(1, p.life / 15);
      const fadeOut = p.y < H * 0.08 ? Math.max(0, (p.y - (-p.r)) / (H * 0.08)) : 1;
      p.alpha = p.maxAlpha * fadeIn * fadeOut;
      const alive = p.y > -p.r - 10;
      if (!alive) this._bubblesStore = this._bubblesStore.filter(b => b !== p);
      return alive;
    },
  },

  classic: null,

  // ── SNOW — Complete Rework: Premium Winter Scene ─────────────────────────
  // Time-aware: MORNING (blue-grey dawn, light purple aurora hints),
  //             AFTERNOON (crisp bright white, blue sky),
  //             EVENING (golden hour on snow, warm edges),
  //             NIGHT (deep navy, full aurora, frozen silence).
  // ── SNOW — Cinematic atmospheric winter ───────────────────────────────────
  // Reference: MORNING=icy pale blue + diffused cloud haze + sparkles,
  // AFTERNOON=saturated blue + volumetric cloud formations + dense snow,
  // EVENING=deep violet-purple + warm aurora hint.
  snow: {
    max: 90, rate: 0.28,
    _clouds: null, _sparkles: null, _aurora: null,

    init(W, H) {
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);
      _stars = []; _initStars(W, H, 75);
      _stars.forEach(s => { s.y *= 0.58; });

      // Volumetric cloud formations — soft drifting cloud masses
      this._clouds = Array.from({ length: 10 }, (_, i) => ({
        x: W * (i / 10) + rng(-W*0.05, W*0.05),
        y: H * rng(0.08, 0.68),
        rx: W * rng(0.12, 0.32),
        ry: H * rng(0.06, 0.16),
        alpha: rng(0.06, 0.22),
        phase: rng(0, Math.PI * 2),
        spd: rng(0.003, 0.008),
        drift: rng(0.04, 0.14),
      }));

      // Sparkle/ice-crystal shimmer field
      this._sparkles = Array.from({ length: 110 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H * 0.90,
        r: 0.28 + Math.random() * 1.65,
        baseAlpha: 0.06 + Math.random() * 0.50,
        phase: Math.random() * Math.PI * 2,
        spd: 0.015 + Math.random() * 0.038,
      }));

      // Aurora ribbons for evening/night
      this._aurora = Array.from({ length: 4 }, (_, i) => ({
        phase: i * 1.6, spd: 0.005 + i * 0.003,
        hue: 200 + i * 40,
        y: H * (0.05 + i * 0.07),
        amp: H * (0.04 + i * 0.01),
        alpha: 0,
      }));
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend = _getSmoothBlend();
      const t = _frame * 0.010;

      // ── 1. Sky gradient — precisely matched to reference ─────────────────
      // MORNING: icy pale blue (top=cool blue, bottom=near-white)
      // AFTERNOON: saturated medium-blue cinematic sky
      // EVENING: deep violet-purple (reference is clearly purple not orange)
      // NIGHT: near-black with moonlit blue hints
      const SKY = {
        MORNING:   { t:[105,148,198], m:[148,190,228], b:[195,218,245] },
        AFTERNOON: { t:[ 18, 45,118], m:[ 35, 75,162], b:[ 65,118,210] },
        EVENING:   { t:[ 18,  8, 55], m:[ 38, 12, 90], b:[ 72, 22,145] },
        NIGHT:     { t:[  4,  6, 22], m:[  8, 12, 38], b:[ 14, 20, 56] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,    _rgb(sk.t));
      skyG.addColorStop(0.48, _rgb(sk.m));
      skyG.addColorStop(1,    _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Stars (night + faint morning) ────────────────────────────────
      if (period === 'NIGHT' || period === 'MORNING') {
        const sA = period === 'NIGHT' ? 1.0 : 0.32;
        _stars.forEach(s => {
          s.twinklePhase += s.twinkleSpd;
          const a = s.alpha * sA * (0.35 + 0.65 * Math.abs(Math.sin(s.twinklePhase)));
          ctx.save(); ctx.globalAlpha = a;
          ctx.fillStyle = 'rgba(215,228,255,1)';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.80, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        });
      }

      // ── 3. Signature period glow ─────────────────────────────────────────
      // MORNING: diffused white-silver center glow (sun behind cloud)
      if (period === 'MORNING') {
        const mg = ctx.createRadialGradient(W*0.50, H*0.38, 0, W*0.50, H*0.38, W*0.50);
        mg.addColorStop(0,    'rgba(255,255,255,0.52)');
        mg.addColorStop(0.18, 'rgba(235,245,255,0.28)');
        mg.addColorStop(0.45, 'rgba(205,228,252,0.12)');
        mg.addColorStop(1,    'rgba(175,210,248,0)');
        ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H);
      }
      // AFTERNOON: sharp sun disc + volumetric upper-sky glow
      if (period === 'AFTERNOON') {
        const pulse = 0.90 + 0.10 * Math.sin(t * 1.4);
        const ag = ctx.createRadialGradient(W*0.68, H*0.09, 0, W*0.68, H*0.09, W*0.38);
        ag.addColorStop(0,    `rgba(255,252,225,${0.72 * pulse})`);
        ag.addColorStop(0.10, `rgba(255,242,195,${0.42 * pulse})`);
        ag.addColorStop(0.28, `rgba(240,225,168,${0.18 * pulse})`);
        ag.addColorStop(1,    'rgba(215,200,145,0)');
        ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H*0.45);
        // Bright sky ambient
        const ag2 = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.72);
        ag2.addColorStop(0,   `rgba(120,178,248,${0.30 * pulse})`);
        ag2.addColorStop(0.55, `rgba(85,148,225,0.10)`);
        ag2.addColorStop(1,   'rgba(65,125,210,0)');
        ctx.fillStyle = ag2; ctx.fillRect(0, 0, W, H*0.55);
      }
      // EVENING: aurora glow + deep violet atmospheric bloom
      if (period === 'EVENING') {
        // Violet upper bloom
        const eg = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.65);
        eg.addColorStop(0,    'rgba(145,55,215,0.38)');
        eg.addColorStop(0.45, 'rgba(85,22,155,0.15)');
        eg.addColorStop(1,    'rgba(48,8,95,0)');
        ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H*0.72);
        // Warm pink horizon touch
        const eh = ctx.createRadialGradient(W*0.50, H*0.82, 0, W*0.50, H*0.82, W*0.62);
        eh.addColorStop(0,    'rgba(255,120,180,0.28)');
        eh.addColorStop(0.38, 'rgba(200,58,135,0.12)');
        eh.addColorStop(1,    'rgba(120,20,80,0)');
        ctx.fillStyle = eh; ctx.fillRect(0, H*0.45, W, H*0.55);
      }
      // NIGHT: moonlit glow
      if (period === 'NIGHT') {
        const mx = W*0.72, my = H*0.08;
        const ng = ctx.createRadialGradient(mx, my, 0, mx, my, W*0.32);
        ng.addColorStop(0,  'rgba(230,242,255,0.28)');
        ng.addColorStop(0.4,'rgba(175,208,252,0.11)');
        ng.addColorStop(1,  'rgba(120,168,235,0)');
        ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H*0.45);
        // Moon disc
        ctx.fillStyle = 'rgba(242,248,255,0.88)';
        ctx.beginPath(); ctx.arc(mx, my, Math.min(W,H)*0.032, 0, Math.PI*2); ctx.fill();
        // Crescent cutout
        ctx.fillStyle = `rgba(${8+4},${12+10},${38+20},1)`;
        ctx.beginPath(); ctx.arc(mx + Math.min(W,H)*0.016, my - Math.min(W,H)*0.005, Math.min(W,H)*0.028, 0, Math.PI*2); ctx.fill();
      }

      // ── 4. Aurora Borealis (evening + night) ────────────────────────────
      const auroraVis = period === 'NIGHT' ? 0.85 : period === 'EVENING' ? 0.55 : 0;
      if (auroraVis > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        this._aurora.forEach(au => {
          au.phase += au.spd;
          au.alpha = auroraVis * (0.055 + 0.04 * Math.sin(au.phase * 0.65));
          const pts = [];
          for (let xi = 0; xi <= W; xi += W / 32)
            pts.push({ x: xi, y: au.y + Math.sin(xi/W*Math.PI*3.2 + au.phase)*au.amp + Math.sin(xi/W*Math.PI*5.8 + au.phase*1.4)*au.amp*0.35 });
          const auH = H * 0.088;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          pts.forEach((p,i) => { if (i > 0) ctx.lineTo(p.x, p.y); });
          ctx.lineTo(W, pts[pts.length-1].y + auH); ctx.lineTo(0, pts[0].y + auH); ctx.closePath();
          const ag = ctx.createLinearGradient(0, au.y - au.amp, 0, au.y + au.amp + auH);
          ag.addColorStop(0,    `hsla(${au.hue},88%,68%,0)`);
          ag.addColorStop(0.35, `hsla(${au.hue},88%,68%,${au.alpha * 2.2})`);
          ag.addColorStop(0.65, `hsla(${au.hue+35},85%,62%,${au.alpha * 1.5})`);
          ag.addColorStop(1,    `hsla(${au.hue},80%,58%,0)`);
          ctx.fillStyle = ag; ctx.fill();
        });
        ctx.restore();
      }

      // ── 5. Volumetric cloud formations ────────────────────────────────────
      // Reference shows billowing cloud masses especially in MORNING/AFTERNOON
      const cloudVis = { MORNING:1.2, AFTERNOON:0.90, EVENING:0.50, NIGHT:0.25 }[period] || 0.8;
      const [cR,cGc,cB] = period === 'EVENING' ? [200,160,240] : period === 'NIGHT' ? [120,148,210] : [245,250,255];
      this._clouds.forEach(cl => {
        cl.x += cl.drift;
        cl.phase += cl.spd;
        if (cl.x > W + cl.rx * 2) cl.x = -cl.rx * 2;
        const pulse = 0.70 + 0.30 * Math.sin(cl.phase);
        const ca = cl.alpha * pulse * cloudVis;
        if (ca < 0.01) return;
        const cg = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, Math.max(cl.rx, cl.ry));
        cg.addColorStop(0,    `rgba(${cR},${cGc},${cB},${ca})`);
        cg.addColorStop(0.55, `rgba(${cR},${cGc},${cB},${ca * 0.55})`);
        cg.addColorStop(1,    `rgba(${cR},${cGc},${cB},0)`);
        ctx.save();
        ctx.scale(1, cl.ry / cl.rx);
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(cl.x, cl.y * (cl.rx / cl.ry), cl.rx, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // ── 6. Sparkle / ice-crystal shimmer ────────────────────────────────
      const sparkVis = { MORNING:0.50, AFTERNOON:0.88, EVENING:0.30, NIGHT:0.22 }[period] || 0.5;
      const [spR,spGc,spB] = period === 'EVENING' ? [212,168,255] : period === 'NIGHT' ? [175,205,255] : [222,238,255];
      this._sparkles.forEach(s => {
        s.phase += s.spd;
        const sa = s.baseAlpha * sparkVis * (0.28 + 0.72 * Math.abs(Math.sin(s.phase)));
        if (sa < 0.012) return;
        ctx.save(); ctx.globalAlpha = sa;
        if (s.r > 1.1) {
          ctx.strokeStyle = `rgba(${spR},${spGc},${spB},1)`;
          ctx.lineWidth = s.r * 0.36; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s.x - s.r*2.6, s.y); ctx.lineTo(s.x + s.r*2.6, s.y);
          ctx.moveTo(s.x, s.y - s.r*2.6); ctx.lineTo(s.x, s.y + s.r*2.6);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${spR},${spGc},${spB},1)`;
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.3, s.r * 0.50), 0, Math.PI*2); ctx.fill();
        ctx.restore();
      });

      // ── 7. Snow ground plane — atmospheric, horizon-based ───────────────
      const groundY = H * 0.78;
      const [gR,gGc,gB] = period === 'EVENING' ? [65,28,105] : period === 'NIGHT' ? [22,32,72] : [215,228,248];
      const gAlpha = period === 'EVENING' ? 0.85 : period === 'NIGHT' ? 0.90 : 0.92;
      const gndG = ctx.createLinearGradient(0, groundY, 0, H);
      gndG.addColorStop(0,    `rgba(${gR},${gGc},${gB},${gAlpha})`);
      gndG.addColorStop(0.45, `rgba(${gR},${gGc},${gB},${Math.min(1,gAlpha+0.05)})`);
      gndG.addColorStop(1,    `rgba(${Math.max(0,gR-10)},${Math.max(0,gGc-8)},${Math.max(0,gB-5)},${Math.min(1,gAlpha+0.08)})`);
      ctx.fillStyle = gndG; ctx.fillRect(0, groundY, W, H - groundY);

      // Horizon glow line
      const [hR,hGc,hB] = period === 'EVENING' ? [165,88,235] : period === 'NIGHT' ? [88,125,215] : [198,225,255];
      const hGlow = ctx.createLinearGradient(0, groundY-6, 0, groundY+6);
      hGlow.addColorStop(0,   `rgba(${hR},${hGc},${hB},0)`);
      hGlow.addColorStop(0.5, `rgba(${hR},${hGc},${hB},0.45)`);
      hGlow.addColorStop(1,   `rgba(${hR},${hGc},${hB},0)`);
      ctx.fillStyle = hGlow; ctx.fillRect(0, groundY-10, W, 20);

      // ── 8. Cinematic edge vignette ────────────────────────────────────────
      const [vR,vGc,vB] = period === 'EVENING' ? [6,2,18] : period === 'NIGHT' ? [2,3,12] : [4,8,22];
      const vigA = period === 'NIGHT' ? 0.75 : period === 'EVENING' ? 0.68 : 0.50;
      const vigRad = ctx.createRadialGradient(W*0.5, H*0.5, W*0.28, W*0.5, H*0.5, W*0.88);
      vigRad.addColorStop(0,    `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(0.62, `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(1,    `rgba(${vR},${vGc},${vB},${vigA})`);
      ctx.fillStyle = vigRad; ctx.fillRect(0, 0, W, H);
    },

    create(W) {
      const big = Math.random() < 0.14;
      return {
        x: Math.random() * W * 1.35 - W * 0.17,
        y: -18 - Math.random() * 45,
        vx: -0.35 + Math.random() * 0.70,
        vy: big ? (0.28 + Math.random() * 0.42) : (0.48 + Math.random() * 0.90),
        r:  big ? (4.0  + Math.random() * 5.5)  : (0.9  + Math.random() * 3.0),
        alpha: big ? (0.30 + Math.random() * 0.22) : (0.52 + Math.random() * 0.38),
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.028,
        sw: Math.random() * Math.PI * 2,
        swAmp: 0.45 + Math.random() * 1.40, swSpd: 0.008 + Math.random() * 0.016,
        windResp: 0.35 + Math.random() * 1.1,
        isBig: big,
      };
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.isBig) {
        // 6-arm snowflake
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.strokeStyle = 'rgba(218,232,255,0.92)';
        ctx.lineWidth = Math.max(0.5, p.r * 0.14); ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          ctx.save(); ctx.rotate(i * Math.PI / 3);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -p.r);
          ctx.moveTo(0, -p.r * 0.40); ctx.lineTo(-p.r * 0.24, -p.r * 0.60);
          ctx.moveTo(0, -p.r * 0.40); ctx.lineTo( p.r * 0.24, -p.r * 0.60);
          ctx.moveTo(0, -p.r * 0.70); ctx.lineTo(-p.r * 0.20, -p.r * 0.88);
          ctx.moveTo(0, -p.r * 0.70); ctx.lineTo( p.r * 0.20, -p.r * 0.88);
          ctx.stroke(); ctx.restore();
        }
        ctx.restore();
      } else {
        // Small snowflake circle with cross
        ctx.strokeStyle = 'rgba(215,228,255,0.85)';
        ctx.lineWidth = Math.max(0.4, p.r * 0.18); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.42, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - p.r, p.y); ctx.lineTo(p.x + p.r, p.y);
        ctx.moveTo(p.x, p.y - p.r); ctx.lineTo(p.x, p.y + p.r);
        ctx.stroke();
      }
      ctx.restore();
    },

    update(p, W, H) {
      const wind = Math.sin(_frame * 0.004) * 1.2 + Math.sin(_frame * 0.019) * 0.48;
      p.sw += p.swSpd; p.rot += p.rotV;
      p.x += p.vx + Math.sin(p.sw) * p.swAmp + wind * p.windResp;
      p.y += p.vy;
      if (p.x < -35) p.x = W + 22;
      if (p.x > W + 35) p.x = -22;
      return p.y < H + 25;
    },
  },

  // ── SUNSET → "CHROMAWAVE" — Retro Drive / Vaporwave Scene ───────────────
  // Renamed. Premium retro-wave aesthetic: perspective grid, neon horizon,
  // palm silhouettes, scanlines, time-of-day sky.
  // ── SUNSET REMOVED — replaced by Rain + Dreamscape ──────────────────────

  // ── ANIME — Premium Manga × Anime Scene ─────────────────────────────────
  // Stylized: anime sky with painterly clouds, manga speed-line bursts,
  // floating sakura/energy petals, halftone texture, light flares.
  // Time-of-day: day/evening/night anime atmosphere.
  anime: {
    max: 35, rate: 0.085,
    _stars: null, _clouds: null, _halftone: null, _flares: null, _speedBursts: null,

    init(W, H) {
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);

      this._stars = Array.from({ length: 65 }, () => ({
        x: rng(0, W), y: rng(0, H * 0.88),
        r: 0.5 + rng(0, 1.5), alpha: 0.20 + rng(0, 0.70),
        phase: rng(0, Math.PI * 2), spd: 0.015 + rng(0, 0.030),
      }));

      // Anime-style chunky clouds
      this._clouds = Array.from({ length: 6 }, (_, i) => ({
        x: W * (0.06 + i * 0.16) + rng(-W * 0.06, W * 0.06),
        y: H * (0.08 + rng(0, 0.25)),
        w: W * (0.09 + rng(0, 0.12)),
        phase: rng(0, Math.PI * 2),
        spd: 0.004 + rng(0, 0.004),
        alpha: 0.60 + rng(0, 0.32),
        hue: 220 + rng(0, 80)|0,
        puffs: Math.floor(rng(3, 7)),
      }));

      // Halftone dot grid (pre-computed positions)
      this._halftone = [];
      const dot_spacing = Math.max(10, Math.min(W, H) * 0.022);
      for (let hx = dot_spacing; hx < W; hx += dot_spacing) {
        for (let hy = dot_spacing; hy < H; hy += dot_spacing) {
          this._halftone.push({ x: hx, y: hy, r: dot_spacing * 0.18 });
        }
      }

      // Light lens flares
      this._flares = Array.from({ length: 5 }, (_, i) => ({
        x: W * (0.12 + i * 0.19),
        y: H * (0.08 + rng(0, 0.20)),
        r: W * (0.012 + rng(0, 0.022)),
        hue: [220, 280, 180, 320, 60][i],
        phase: rng(0, Math.PI * 2),
        spd: rng(0.012, 0.025),
      }));

      // Occasional speed-line burst events
      this._speedBursts = [];
      this._nextBurst = 200 + Math.floor(rng(0, 300));
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend = _getSmoothBlend();
      const t = _frame * 0.013;

      // ── 1. Anime sky ─────────────────────────────────────────────────────
      const SKY = {
        MORNING:   { t:[60,40,105], m:[130,80,170], b:[210,130,200] },
        AFTERNOON: { t:[22,18,68],  m:[80, 45,145], b:[180,100,200] },
        EVENING:   { t:[18,10,48],  m:[55, 22,100], b:[175,68, 145] },
        NIGHT:     { t:[5, 3, 22],  m:[18, 8, 52],  b:[45, 22, 88]  },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,   _rgb(sk.t));
      skyG.addColorStop(0.45, _rgb(sk.m));
      skyG.addColorStop(1,   _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Stars ─────────────────────────────────────────────────────────
      const starVis = period === 'NIGHT' ? 1.0 : period === 'EVENING' ? 0.50 : 0.15;
      this._stars.forEach(s => {
        s.phase += s.spd;
        const a = s.alpha * starVis * (0.3 + 0.7 * Math.sin(s.phase));
        if (a < 0.02) return;
        ctx.save(); ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(225,210,255,1)';
        ctx.beginPath();
        // Star cross shape
        const sr = s.r;
        ctx.moveTo(s.x - sr * 0.5, s.y); ctx.lineTo(s.x + sr * 0.5, s.y);
        ctx.moveTo(s.x, s.y - sr * 0.5); ctx.lineTo(s.x, s.y + sr * 0.5);
        ctx.strokeStyle = 'rgba(225,210,255,1)'; ctx.lineWidth = sr * 0.4; ctx.stroke();
        ctx.fillStyle = 'rgba(255,245,255,0.90)';
        ctx.beginPath(); ctx.arc(s.x, s.y, sr * 0.25, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // ── 3. Halftone texture ──────────────────────────────────────────────
      const htA = period === 'NIGHT' ? 0.055 : 0.035;
      ctx.save(); ctx.globalAlpha = htA;
      ctx.fillStyle = period === 'NIGHT' ? 'rgba(150,100,200,1)' : 'rgba(180,130,220,1)';
      this._halftone.forEach(d => {
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();

      // ── 4. Anime clouds (chunky, cel-shaded style) ────────────────────────
      if (period !== 'NIGHT') {
        const cloudLight = period === 'MORNING' ? 85 : period === 'AFTERNOON' ? 92 : 75;
        const cloudAlphaScale = period === 'MORNING' ? 0.7 : 1.0;
        this._clouds.forEach(c => {
          c.phase += c.spd;
          const pulse = 0.88 + 0.12 * Math.sin(c.phase);
          const puffR = c.w / (c.puffs * 0.65);
          ctx.save(); ctx.globalAlpha = c.alpha * pulse * cloudAlphaScale;

          // Shadow layer
          ctx.fillStyle = `hsla(${c.hue + 20},55%,${cloudLight - 22}%,0.35)`;
          for (let pi = 0; pi < c.puffs; pi++) {
            const px = c.x + (pi - c.puffs * 0.5) * puffR * 1.15;
            const py = c.y + puffR * (0.22 + 0.10 * Math.sin(pi * 1.3));
            ctx.beginPath(); ctx.arc(px + puffR * 0.15, py + puffR * 0.18, puffR * (0.78 - pi * 0.04 + 0.04), 0, Math.PI * 2); ctx.fill();
          }
          // Main cloud body
          ctx.fillStyle = `hsla(${c.hue},${45 + (period === 'EVENING' ? 20 : 0)}%,${cloudLight}%,1)`;
          for (let pi = 0; pi < c.puffs; pi++) {
            const px = c.x + (pi - c.puffs * 0.5) * puffR * 1.15;
            const py = c.y + puffR * (0.18 + 0.08 * Math.sin(pi * 1.3));
            ctx.beginPath(); ctx.arc(px, py, puffR * (0.85 - pi * 0.04 + 0.04), 0, Math.PI * 2); ctx.fill();
          }
          // Outline (manga style)
          ctx.strokeStyle = `hsla(${c.hue},40%,${cloudLight - 30}%,0.30)`;
          ctx.lineWidth = 1.5;
          for (let pi = 0; pi < c.puffs; pi++) {
            const px = c.x + (pi - c.puffs * 0.5) * puffR * 1.15;
            const py = c.y + puffR * (0.18 + 0.08 * Math.sin(pi * 1.3));
            ctx.beginPath(); ctx.arc(px, py, puffR * (0.85 - pi * 0.04 + 0.04), 0, Math.PI * 2); ctx.stroke();
          }
          ctx.restore();
        });
      }

      // ── 5. Lens flares ────────────────────────────────────────────────────
      this._flares.forEach(fl => {
        fl.phase += fl.spd;
        const fa = (0.04 + 0.03 * Math.sin(fl.phase));
        const fg = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, fl.r * 3.5);
        fg.addColorStop(0,    `hsla(${fl.hue},90%,82%,${fa * 3.5})`);
        fg.addColorStop(0.35, `hsla(${fl.hue},82%,65%,${fa * 1.4})`);
        fg.addColorStop(1,    `hsla(${fl.hue},72%,48%,0)`);
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r * 3.5, 0, Math.PI * 2); ctx.fill();
        // Cross flare lines
        ctx.save(); ctx.globalAlpha = fa * 2.5;
        ctx.strokeStyle = `hsla(${fl.hue},88%,80%,1)`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(fl.x - fl.r * 5, fl.y); ctx.lineTo(fl.x + fl.r * 5, fl.y);
        ctx.moveTo(fl.x, fl.y - fl.r * 5); ctx.lineTo(fl.x, fl.y + fl.r * 5);
        ctx.stroke(); ctx.restore();
      });

      // ── 6. Speed line burst (occasional dramatic effect) ──────────────────
      if (_frame >= this._nextBurst) {
        this._speedBursts.push({
          x: W * (0.28 + Math.random() * 0.44),
          y: H * (0.22 + Math.random() * 0.45),
          frame: 0, maxFrame: 35,
          hue: [280, 320, 200, 45, 180][Math.floor(Math.random() * 5)],
          lines: Math.floor(18 + Math.random() * 16),
          maxR: Math.min(W, H) * (0.28 + Math.random() * 0.22),
        });
        this._nextBurst = _frame + 240 + Math.floor(Math.random() * 360);
      }
      this._speedBursts = this._speedBursts.filter(sb => {
        sb.frame++;
        const prog = sb.frame / sb.maxFrame;
        const a = prog < 0.3 ? prog / 0.3 : prog > 0.7 ? (1 - prog) / 0.3 : 1.0;
        ctx.save(); ctx.globalAlpha = 0.18 * a;
        for (let li = 0; li < sb.lines; li++) {
          const ang = (li / sb.lines) * Math.PI * 2;
          const r1 = sb.maxR * (0.32 + prog * 0.68) * (0.6 + Math.random() * 0.4);
          const r2 = sb.maxR * (0.42 + prog * 0.58) * (0.7 + Math.random() * 0.3);
          ctx.strokeStyle = `hsla(${sb.hue},88%,75%,1)`;
          ctx.lineWidth = 0.8 + Math.random() * 1.2;
          ctx.beginPath();
          ctx.moveTo(sb.x + Math.cos(ang) * r1, sb.y + Math.sin(ang) * r1);
          ctx.lineTo(sb.x + Math.cos(ang) * r2, sb.y + Math.sin(ang) * r2);
          ctx.stroke();
        }
        ctx.restore();
        return sb.frame < sb.maxFrame;
      });

      // ── 7. Vignette ───────────────────────────────────────────────────────
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.25, W * 0.5, H * 0.5, W * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(0.72, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    },

    create(W, H) {
      const period = _getCanvasPeriod();
      const r = Math.random();
      if (r < 0.50) {
        // Anime energy petal / fragment
        const hues = period === 'NIGHT' ? [260,295,315,200,170] : [310,330,50,200,270];
        return {
          type: 'petal',
          x: Math.random() * W * 1.3 - W * 0.15,
          y: -20 - Math.random() * 60,
          vx: (Math.random() - 0.5) * 2.0,
          vy: 0.8 + Math.random() * 1.8,
          rot: Math.random() * Math.PI * 2,
          rotV: (Math.random() - 0.5) * 0.12,
          sz: 3 + Math.random() * 8,
          hue: hues[Math.floor(Math.random() * hues.length)],
          alpha: 0, maxAlpha: 0.55 + Math.random() * 0.35,
          life: 0, fadeIn: 10,
          sw: Math.random() * Math.PI * 2,
          swAmp: 1.2 + Math.random() * 2.8, swSpd: 0.014 + Math.random() * 0.022,
        };
      } else if (r < 0.78) {
        // Sparkle burst
        return {
          type: 'sparkle',
          x: Math.random() * W, y: Math.random() * H * 0.92,
          r: 1.0 + Math.random() * 3.5,
          hue: [220, 280, 320, 180, 55][Math.floor(Math.random() * 5)],
          alpha: 0, maxAlpha: 0.62 + Math.random() * 0.32,
          life: 0, fadeIn: 7, maxLife: 40 + Math.floor(Math.random() * 38),
          vx: (Math.random() - 0.5) * 0.5, vy: -(0.08 + Math.random() * 0.35),
        };
      } else {
        // Manga ink stroke (subtle)
        return {
          type: 'ink',
          x: Math.random() * W, y: Math.random() * H * 0.85,
          len: W * (0.03 + Math.random() * 0.07),
          angle: (Math.random() - 0.5) * Math.PI * 0.4,
          alpha: 0, maxAlpha: 0.12 + Math.random() * 0.14,
          life: 0, fadeIn: 12, maxLife: 60 + Math.floor(Math.random() * 50),
        };
      }
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.type === 'petal') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        // Diamond / anime fragment shape
        const s = p.sz;
        ctx.fillStyle = `hsla(${p.hue},90%,72%,1)`;
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.8); ctx.lineTo(s * 0.65, 0);
        ctx.lineTo(0,  s * 1.8); ctx.lineTo(-s * 0.65, 0);
        ctx.closePath(); ctx.fill();
        // Inner highlight
        ctx.fillStyle = `hsla(${p.hue + 20},95%,88%,0.55)`;
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.0); ctx.lineTo(s * 0.28, -s * 0.2);
        ctx.lineTo(0, s * 0.35); ctx.lineTo(-s * 0.28, -s * 0.2);
        ctx.closePath(); ctx.fill();
      } else if (p.type === 'sparkle') {
        const s = p.r;
        ctx.strokeStyle = `hsla(${p.hue},92%,80%,1)`; ctx.lineWidth = s * 0.45; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - s * 2.8, p.y); ctx.lineTo(p.x + s * 2.8, p.y);
        ctx.moveTo(p.x, p.y - s * 2.8); ctx.lineTo(p.x, p.y + s * 2.8);
        ctx.moveTo(p.x - s * 1.8, p.y - s * 1.8); ctx.lineTo(p.x + s * 1.8, p.y + s * 1.8);
        ctx.moveTo(p.x + s * 1.8, p.y - s * 1.8); ctx.lineTo(p.x - s * 1.8, p.y + s * 1.8);
        ctx.stroke();
      } else {
        // Ink stroke
        ctx.strokeStyle = 'rgba(180,140,210,1)';
        ctx.lineWidth = 1.0; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(p.angle) * p.len * 0.5, p.y - Math.sin(p.angle) * p.len * 0.5);
        ctx.lineTo(p.x + Math.cos(p.angle) * p.len * 0.5, p.y + Math.sin(p.angle) * p.len * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    },

    update(p, W, H) {
      p.life++;
      if (p.sw !== undefined) { p.sw += p.swSpd; p.x += p.vx + Math.sin(p.sw) * p.swAmp; }
      else { p.x += p.vx; }
      p.y += p.vy || 0;
      if (p.rot !== undefined) p.rot += p.rotV;
      const fi = Math.min(1, p.life / p.fadeIn);
      const fo = (p.maxLife && p.life > p.maxLife - 18) ? Math.max(0, (p.maxLife - p.life) / 18) : 1;
      p.alpha = p.maxAlpha * fi * fo;
      if (p.type === 'petal') return p.y < H + 40;
      return p.life < p.maxLife;
    },
  },

  // ── NEON CITY — Premium Cyberpunk City with Time-of-Day ─────────────────
  // City skyline, neon signs, wet street reflections, moving traffic,
  // rain streaks, moon/sun, animated billboard glow.
  neon: {
    max: 58, rate: 0.16,
    _buildings: null, _signs: null, _cars: null, _rain: null, _stars: null, _moon: null,

    init(W, H) {
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);

      // City skyline: multiple building layers
      this._buildings = Array.from({ length: 32 }, (_, i) => {
        const layer = i < 10 ? 2 : i < 22 ? 1 : 0;
        const bW = W * (rng(0.038, 0.085));
        const bH = H * rng(0.18 + layer * 0.07, 0.52 + layer * 0.05);
        return {
          x: W * (i / 31) - bW * 0.4,
          bW, bH,
          baseY: H * (0.62 + layer * 0.02),
          layer,
          hue: rng(0, 1) < 0.5 ? rng(185, 220) : rng(270, 300),
          windowsW: Math.floor(rng(2, 5)),
          windowsH: Math.floor(rng(4, 10)),
          phase: rng(0, Math.PI * 2),
          antennaH: bH * rng(0, 0.18),
        };
      });

      // Neon signs (animated glow elements on buildings)
      this._signs = Array.from({ length: 12 }, (_, i) => ({
        x: W * rng(0.05, 0.95),
        y: H * rng(0.25, 0.60),
        w: W * rng(0.03, 0.08),
        h: H * rng(0.018, 0.040),
        hue: [185, 280, 320, 55, 125, 0][i % 6],
        phase: rng(0, Math.PI * 2),
        spd: rng(0.03, 0.10),
        on: Math.random() > 0.15, // some signs start flickering
        flicker: Math.random() < 0.22,
      }));

      // Moving cars (light trails in street reflection zone)
      this._cars = Array.from({ length: 7 }, (_, i) => ({
        x: rng(-W * 0.3, W * 1.3),
        y: H * (0.80 + rng(0, 0.06)),
        speed: (rng(0, 1) < 0.5 ? 1 : -1) * rng(1.2, 3.5),
        lane: i % 3,
        hue: [185, 0, 55, 270, 120][i % 5],
        sz: rng(W * 0.022, W * 0.040),
        phase: rng(0, Math.PI * 2),
      }));

      this._stars = Array.from({ length: 55 }, () => ({
        x: rng(0, W), y: rng(0, H * 0.62),
        r: 0.4 + rng(0, 1.1), alpha: 0.15 + rng(0, 0.55),
        phase: rng(0, Math.PI * 2), spd: 0.015 + rng(0, 0.025),
      }));

      this._moon = { x: W * 0.80, y: H * 0.12, r: Math.min(W, H) * 0.036, phase: 0 };
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend = _getSmoothBlend();
      const t = _frame * 0.014;

      // ── 1. Base gradient — precisely matched to reference ───────────────
      // MORNING: soft blue atmospheric (reference: cool pale blue, subtle)
      // AFTERNOON: deep cold navy (reference: very dark midnight with neon points)
      // EVENING: ultra-deep purple-black + hot magenta right corner
      // NIGHT: pure near-black with deep indigo
      const SKY = {
        MORNING:   { t:[ 15, 28, 88],  m:[ 28, 48,125],  b:[ 42, 68,155] },
        AFTERNOON: { t:[  2,  4, 22],  m:[  4,  8, 42],   b:[  7, 14, 62] },
        EVENING:   { t:[  2,  1,  8],  m:[  4,  2, 18],   b:[  8,  3, 28] },
        NIGHT:     { t:[  1,  0,  5],  m:[  2,  1, 12],   b:[  4,  2, 20] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,    _rgb(sk.t));
      skyG.addColorStop(0.48, _rgb(sk.m));
      skyG.addColorStop(1,    _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Signature period glow ─────────────────────────────────────────
      // MORNING: soft cyan center bloom + left edge blue glow
      if (period === 'MORNING') {
        const pulse = 0.88 + 0.12 * Math.sin(t * 1.5);
        const mg = ctx.createRadialGradient(W*0.38, H*0.52, 0, W*0.38, H*0.52, W*0.62);
        mg.addColorStop(0,    `rgba(88,210,255,${0.55 * pulse})`);
        mg.addColorStop(0.12, `rgba(48,168,242,${0.32 * pulse})`);
        mg.addColorStop(0.35, `rgba(22,112,215,${0.14 * pulse})`);
        mg.addColorStop(1,    'rgba(8,48,145,0)');
        ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H);
        // Top atmospheric blue diffusion
        const mg2 = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.72);
        mg2.addColorStop(0,    `rgba(62,165,255,${0.25 * pulse})`);
        mg2.addColorStop(0.55, 'rgba(28,95,210,0.09)');
        mg2.addColorStop(1,    'rgba(8,38,155,0)');
        ctx.fillStyle = mg2; ctx.fillRect(0, 0, W, H*0.62);
        // Star-bright point at glow center
        const mc = ctx.createRadialGradient(W*0.38, H*0.52, 0, W*0.38, H*0.52, W*0.042);
        mc.addColorStop(0,    `rgba(255,255,255,${0.82 * pulse})`);
        mc.addColorStop(0.45, `rgba(178,232,255,${0.52 * pulse})`);
        mc.addColorStop(1,    'rgba(68,188,255,0)');
        ctx.fillStyle = mc; ctx.fillRect(0, 0, W, H);
      }
      // AFTERNOON: multi-point neon star glows (reference: 3 bright neon points + sparkle field)
      if (period === 'AFTERNOON') {
        // Primary center cyan star
        const pulse = 0.84 + 0.16 * Math.sin(t * 2.1);
        const ap1 = ctx.createRadialGradient(W*0.48, H*0.50, 0, W*0.48, H*0.50, W*0.38);
        ap1.addColorStop(0,    `rgba(255,255,255,${0.82 * pulse})`);
        ap1.addColorStop(0.06, `rgba(158,248,255,${0.62 * pulse})`);
        ap1.addColorStop(0.20, `rgba(62,198,255,${0.28 * pulse})`);
        ap1.addColorStop(0.50, `rgba(18,125,215,${0.10 * pulse})`);
        ap1.addColorStop(1,    'rgba(4,42,115,0)');
        ctx.fillStyle = ap1; ctx.fillRect(0, 0, W, H);
        // Left magenta star point
        const ap2 = ctx.createRadialGradient(W*0.24, H*0.62, 0, W*0.24, H*0.62, W*0.28);
        ap2.addColorStop(0,    `rgba(255,255,255,${0.62 * pulse})`);
        ap2.addColorStop(0.06, `rgba(255,58,235,${0.52 * pulse})`);
        ap2.addColorStop(0.22, `rgba(210,18,195,${0.22 * pulse})`);
        ap2.addColorStop(1,    'rgba(88,0,88,0)');
        ctx.fillStyle = ap2; ctx.fillRect(0, 0, W, H);
        // Right magenta star point
        const ap3 = ctx.createRadialGradient(W*0.78, H*0.62, 0, W*0.78, H*0.62, W*0.28);
        ap3.addColorStop(0,    `rgba(255,255,255,${0.62 * pulse})`);
        ap3.addColorStop(0.06, `rgba(255,32,218,${0.52 * pulse})`);
        ap3.addColorStop(0.22, `rgba(208,8,188,${0.22 * pulse})`);
        ap3.addColorStop(1,    'rgba(80,0,80,0)');
        ctx.fillStyle = ap3; ctx.fillRect(0, 0, W, H);
        // Upper blue-indigo haze
        const aph = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.70);
        aph.addColorStop(0,    'rgba(38,28,145,0.32)');
        aph.addColorStop(0.55, 'rgba(22,12,98,0.12)');
        aph.addColorStop(1,    'rgba(8,4,42,0)');
        ctx.fillStyle = aph; ctx.fillRect(0, 0, W, H*0.65);
      }
      // EVENING: hot pink/magenta corner fire from upper-right (reference exact)
      if (period === 'EVENING') {
        const eg = ctx.createRadialGradient(W*0.88, H*0.08, 0, W*0.88, H*0.08, W*0.65);
        eg.addColorStop(0,    'rgba(255,28,178,0.82)');
        eg.addColorStop(0.08, 'rgba(245,12,148,0.60)');
        eg.addColorStop(0.22, 'rgba(205,4,118,0.32)');
        eg.addColorStop(0.45, 'rgba(145,0,88,0.14)');
        eg.addColorStop(1,    'rgba(48,0,32,0)');
        ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
        // Counter left-bottom blue depth
        const ep = ctx.createRadialGradient(0, H, 0, 0, H, W*0.55);
        ep.addColorStop(0,    'rgba(0,48,185,0.32)');
        ep.addColorStop(0.45, 'rgba(0,22,105,0.12)');
        ep.addColorStop(1,    'rgba(0,6,42,0)');
        ctx.fillStyle = ep; ctx.fillRect(0, 0, W, H);
      }
      // NIGHT: subtle dual edge neon bleeds
      if (period === 'NIGHT') {
        const ncL = ctx.createRadialGradient(0, H*0.50, 0, 0, H*0.50, W*0.42);
        ncL.addColorStop(0,    'rgba(0,200,255,0.22)');
        ncL.addColorStop(0.42, 'rgba(0,140,215,0.08)');
        ncL.addColorStop(1,    'rgba(0,58,145,0)');
        ctx.fillStyle = ncL; ctx.fillRect(0, 0, W*0.52, H);
        const ncR = ctx.createRadialGradient(W, H*0.48, 0, W, H*0.48, W*0.42);
        ncR.addColorStop(0,    'rgba(215,0,195,0.20)');
        ncR.addColorStop(0.42, 'rgba(165,0,155,0.08)');
        ncR.addColorStop(1,    'rgba(68,0,62,0)');
        ctx.fillStyle = ncR; ctx.fillRect(W*0.48, 0, W*0.52, H);
      }

      // ── 3. Sparkle / star field — matches reference density ─────────────
      const sparkVis = { MORNING:0.42, AFTERNOON:1.0, EVENING:0.25, NIGHT:0.62 }[period] || 0.5;
      const [spR,spGc,spB] = period === 'AFTERNOON' ? [158,248,255] : period === 'EVENING' ? [255,48,212] : [165,205,255];
      for (let si = 0; si < 120; si++) {
        const sx = W * ((si * 0.0809 + Math.sin(t*0.18 + si*0.42)*0.008 + 1.0) % 1.0);
        const sy = H * ((si * 0.1618 + Math.cos(t*0.14 + si*0.55)*0.006 + 1.0) % 1.0);
        const sr = 0.25 + 1.55 * ((si*0.382) % 1.0);
        const phase = t * 1.8 + si * 2.42;
        const sa = (0.05 + 0.60 * ((si*0.618) % 1.0)) * sparkVis * (0.28 + 0.72 * Math.abs(Math.sin(phase)));
        if (sa < 0.015) continue;
        ctx.save(); ctx.globalAlpha = sa;
        if (sr > 1.0) {
          // Star cross sparkle
          ctx.strokeStyle = `rgba(${spR},${spGc},${spB},1)`;
          ctx.lineWidth = sr * 0.38; ctx.lineCap = 'round';
          const sl = sr * 2.8;
          ctx.beginPath();
          ctx.moveTo(sx - sl, sy); ctx.lineTo(sx + sl, sy);
          ctx.moveTo(sx, sy - sl); ctx.lineTo(sx, sy + sl);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${spR},${spGc},${spB},1)`;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.28, sr * 0.48), 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }

      // ── 4. Reflective ground plane ───────────────────────────────────────
      const horizY = H * 0.74;
      const [gR,gGc,gB] = period === 'EVENING' ? [35,2,25] : period === 'MORNING' ? [12,22,65] : [4,6,28];
      const gndG = ctx.createLinearGradient(0, horizY, 0, H);
      gndG.addColorStop(0,    `rgba(${gR},${gGc},${gB},0.88)`);
      gndG.addColorStop(0.40, `rgba(${gR},${gGc},${gB},0.95)`);
      gndG.addColorStop(1,    `rgba(${Math.max(0,gR-4)},${Math.max(0,gGc-2)},${Math.max(0,gB-4)},0.99)`);
      ctx.fillStyle = gndG; ctx.fillRect(0, horizY, W, H - horizY);

      // Horizontal neon shimmer strips (the "reflective street" in reference)
      const [hR,hGc,hB] = period === 'EVENING' ? [255,28,178] : period === 'MORNING' ? [88,205,255] : [98,215,255];
      for (let ri = 0; ri < 8; ri++) {
        const ry = horizY + (H - horizY) * (0.04 + ri * 0.13);
        const rw = W * (0.08 + 0.05 * Math.sin(t*0.22 + ri * 1.38));
        const rx = W * (0.20 + ri * 0.076) + Math.cos(t*0.15 + ri*0.85) * W * 0.045;
        const rAlpha = (0.18 + 0.08 * Math.abs(Math.sin(t*0.65 + ri))) * (period === 'NIGHT' ? 1.65 : period === 'AFTERNOON' ? 1.45 : 0.85);
        ctx.globalAlpha = rAlpha;
        const rG = ctx.createLinearGradient(rx - rw, ry, rx + rw, ry);
        rG.addColorStop(0,   `rgba(${hR},${hGc},${hB},0)`);
        rG.addColorStop(0.5, `rgba(${hR},${hGc},${hB},1)`);
        rG.addColorStop(1,   `rgba(${hR},${hGc},${hB},0)`);
        ctx.fillStyle = rG; ctx.fillRect(rx - rw, ry - 1.2, rw*2, 2.6);
      }
      ctx.globalAlpha = 1;

      // Horizon luminance band
      const hGlow = ctx.createLinearGradient(0, horizY - 6, 0, horizY + 6);
      hGlow.addColorStop(0,   `rgba(${hR},${hGc},${hB},0)`);
      hGlow.addColorStop(0.5, `rgba(${hR},${hGc},${hB},0.48)`);
      hGlow.addColorStop(1,   `rgba(${hR},${hGc},${hB},0)`);
      ctx.fillStyle = hGlow; ctx.fillRect(0, horizY - 10, W, 20);

      // ── 5. Edge cinematic vignette ───────────────────────────────────────
      const vigA = period === 'NIGHT' ? 0.88 : 0.72;
      const [vR,vGc,vB] = period === 'EVENING' ? [4,0,4] : period === 'MORNING' ? [2,3,14] : [1,1,8];
      const vigRad = ctx.createRadialGradient(W*0.5, H*0.5, W*0.22, W*0.5, H*0.5, W*0.92);
      vigRad.addColorStop(0,    `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(0.62, `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(1,    `rgba(${vR},${vGc},${vB},${vigA})`);
      ctx.fillStyle = vigRad; ctx.fillRect(0, 0, W, H);
    },


    create(W, H) {
      const period = _getCanvasPeriod();
      const r = Math.random();
      if (r < 0.52) {
        // Rain streak
        return {
          type: 'rain',
          x: Math.random() * W * 1.2 - W * 0.10,
          y: -20 - Math.random() * H * 0.35,
          vx: -0.8 + Math.random() * 0.4, vy: 5.5 + Math.random() * 4.0,
          len: 8 + Math.random() * 22,
          alpha: 0.08 + Math.random() * 0.18,
          hue: 185 + Math.floor(Math.random() * 80),
        };
      } else if (r < 0.78) {
        // Neon particle / spark
        return {
          type: 'spark',
          x: Math.random() * W, y: H * 0.20 + Math.random() * H * 0.65,
          vx: (Math.random() - 0.5) * 1.8, vy: -(0.35 + Math.random() * 1.2),
          r: 0.8 + Math.random() * 3.5,
          hue: [185, 280, 320, 55, 125, 0][Math.floor(Math.random() * 6)],
          alpha: 0, maxAlpha: 0.72 + Math.random() * 0.25,
          life: 0, fadeIn: 6, maxLife: 38 + Math.floor(Math.random() * 42),
          sw: Math.random() * Math.PI * 2, swAmp: 0.6 + Math.random() * 1.4, swSpd: 0.022 + Math.random() * 0.030,
        };
      } else {
        // Neon sign reflection ripple in street
        return {
          type: 'ripple',
          x: Math.random() * W,
          y: H * (0.82 + Math.random() * 0.12),
          r: 0, maxR: 15 + Math.random() * 28,
          alpha: 0.18 + Math.random() * 0.22,
          hue: [185, 270, 320][Math.floor(Math.random() * 3)],
          life: 0, maxLife: 40 + Math.floor(Math.random() * 30),
        };
      }
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.type === 'rain') {
        ctx.strokeStyle = `hsla(${p.hue},70%,72%,1)`;
        ctx.lineWidth = 0.7; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 2.5, p.y + p.len);
        ctx.stroke();
        // Street splash if near bottom
      } else if (p.type === 'spark') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.8);
        g.addColorStop(0,   `hsla(${p.hue},100%,88%,1)`);
        g.addColorStop(0.40, `hsla(${p.hue},92%,68%,0.65)`);
        g.addColorStop(1,   `hsla(${p.hue},80%,45%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.8, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'ripple') {
        ctx.strokeStyle = `hsla(${p.hue},85%,65%,1)`;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    },

    update(p, W, H) {
      if (p.type === 'rain') {
        p.x += p.vx; p.y += p.vy;
        return p.y < H + 20;
      } else if (p.type === 'spark') {
        p.life++; p.sw += p.swSpd;
        p.x += p.vx + Math.sin(p.sw) * p.swAmp; p.y += p.vy;
        const fi = Math.min(1, p.life / p.fadeIn);
        const fo = p.life > p.maxLife - 14 ? Math.max(0, (p.maxLife - p.life) / 14) : 1;
        p.alpha = p.maxAlpha * fi * fo;
        return p.life < p.maxLife;
      } else if (p.type === 'ripple') {
        p.life++; p.r += p.maxR / p.maxLife;
        p.alpha = (1 - p.life / p.maxLife) * (0.18 + Math.random() * 0.22);
        return p.life < p.maxLife;
      }
      return false;
    },
  },

  // ── COZY — Premium Cozy Interior Scene ───────────────────────────────────
  // Indoor warmth: wooden floor, fireplace, rain on window, steam,
  // bookshelf, candle flicker, soft lamplight. Pure cozy.
  cozy: {
    max: 28, rate: 0.065,
    _fireParticles: null, _steam: null, _rainDrops: null, _books: null, _candles: null,

    init(W, H) {
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);

      // Fireplace flame base
      this._fireParticles = Array.from({ length: 18 }, (_, i) => ({
        x: W * 0.5 + (i - 9) * W * 0.012,
        y: H * 0.88,
        vx: (rng(-1,1)) * 0.45,
        vy: -(0.5 + rng(0, 0.8)),
        r: rng(6, 20),
        hue: rng(10, 40)|0,
        life: rng(0, 40)|0, maxLife: 35 + rng(0, 25)|0,
        alpha: 0,
      }));

      // Steam wisps from mug (bottom center-right)
      this._steam = Array.from({ length: 5 }, (_, i) => ({
        x: W * (0.65 + i * 0.008), y: H * 0.88,
        vy: -(0.28 + rng(0, 0.25)),
        vx: (rng(-1,1)) * 0.15,
        r: 3 + rng(0, 4),
        alpha: 0, maxAlpha: 0.22 + rng(0, 0.14),
        life: rng(0, 30)|0, maxLife: 55 + rng(0, 35)|0,
        sw: rng(0, Math.PI * 2), swAmp: rng(2, 6), swSpd: rng(0.012, 0.025),
      }));

      // Window rain streaks (outside the window)
      this._rainDrops = Array.from({ length: 30 }, () => ({
        x: W * (0.04 + rng(0, 0.22)),
        y: H * rng(0.08, 0.55),
        len: H * rng(0.03, 0.09),
        speed: H * rng(0.003, 0.009),
        alpha: rng(0.08, 0.25),
        width: rng(0.6, 1.2),
      }));

      // Bookshelf items
      this._books = Array.from({ length: 14 }, (_, i) => ({
        x: W * (0.04 + i * (W * 0.22 / 14) / W),
        w: W * rng(0.010, 0.018),
        h: H * (0.065 + rng(0, 0.050)),
        hue: [22, 42, 180, 350, 120, 60, 280, 18, 200, 320, 85, 38, 155, 240][i],
        lean: rng(-0.12, 0.12),
      }));

      // Candles
      this._candles = [
        { x: W * 0.18, y: H * 0.74, phase: 0, spd: 0.08, h: H * 0.032, r: W * 0.008 },
        { x: W * 0.82, y: H * 0.78, phase: 1.5, spd: 0.065, h: H * 0.025, r: W * 0.006 },
      ];
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend = _getSmoothBlend();
      const t = _frame * 0.014;

      // ── 1. Base warm gradient — matched to reference ─────────────────────
      // MORNING: warm golden amber (light through warm room)
      // AFTERNOON: saturated deep orange (rich warm interior light)
      // EVENING: rich flaming orange-ember tones (fireplace dominant)
      // NIGHT: very dark warm brown with ember glow
      const SKY = {
        MORNING:   { t:[62, 38, 12],  m:[95, 58, 18],  b:[132, 82, 24] },
        AFTERNOON: { t:[48, 22,  4],  m:[ 82, 38,  8],  b:[122, 55, 10] },
        EVENING:   { t:[38, 12,  2],  m:[ 68, 22,  3],  b:[108, 35,  4] },
        NIGHT:     { t:[18,  6,  0],  m:[ 32, 10,  1],  b:[ 52, 16,  2] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,    _rgb(sk.t));
      skyG.addColorStop(0.48, _rgb(sk.m));
      skyG.addColorStop(1,    _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Fireplace / hearth dominant glow — the emotional core ─────────
      const fireFlicker = 0.82 + 0.18 * Math.sin(t * 5.8) + 0.08 * Math.sin(t * 11.5);
      const fireAmt = { MORNING:0.52, AFTERNOON:0.65, EVENING:0.82, NIGHT:0.72 }[period] || 0.6;
      // Bottom central fire bloom
      const fg = ctx.createRadialGradient(W*0.50, H*1.05, 0, W*0.50, H*1.05, W*0.78);
      fg.addColorStop(0,    `rgba(255,175,42,${fireAmt * fireFlicker * 1.10})`);
      fg.addColorStop(0.12, `rgba(248,115,18,${fireAmt * fireFlicker * 0.75})`);
      fg.addColorStop(0.30, `rgba(215,68,8,${fireAmt * fireFlicker * 0.38})`);
      fg.addColorStop(0.55, `rgba(160,35,4,${fireAmt * fireFlicker * 0.15})`);
      fg.addColorStop(1,    'rgba(62,8,0,0)');
      ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);

      // ── 3. Left amber warmth edge — lamp / side window light ─────────────
      const lampAmt = { MORNING:0.55, AFTERNOON:0.42, EVENING:0.35, NIGHT:0.45 }[period] || 0.4;
      const lg = ctx.createRadialGradient(0, H*0.38, 0, 0, H*0.38, W*0.65);
      lg.addColorStop(0,    `rgba(255,192,65,${lampAmt * fireFlicker})`);
      lg.addColorStop(0.18, `rgba(235,145,35,${lampAmt * 0.48 * fireFlicker})`);
      lg.addColorStop(0.45, `rgba(195,88,12,${lampAmt * 0.18 * fireFlicker})`);
      lg.addColorStop(1,    'rgba(80,22,2,0)');
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W*0.68, H);

      // ── 4. MORNING signature: vertical window light bars ──────────────────
      // This is the key visual from the reference — vertical golden bars
      if (period === 'MORNING') {
        const barCount = 4;
        for (let bi = 0; bi < barCount; bi++) {
          const bx = W * (0.08 + bi * 0.058);
          const bw = W * (0.012 + 0.006 * Math.sin(t*0.3+bi));
          const ba = (0.32 + 0.12 * Math.sin(t*0.55 + bi*0.82)) * fireFlicker;
          const barG = ctx.createLinearGradient(bx - bw, 0, bx + bw, 0);
          barG.addColorStop(0,   'rgba(255,215,108,0)');
          barG.addColorStop(0.5, `rgba(255,225,128,${ba})`);
          barG.addColorStop(1,   'rgba(255,215,108,0)');
          ctx.fillStyle = barG; ctx.fillRect(bx - bw*2, 0, bw*4, H);
        }
        // Warm golden top diffusion (morning sun)
        const mng = ctx.createRadialGradient(W*0.18, 0, 0, W*0.18, 0, W*0.58);
        mng.addColorStop(0,    `rgba(255,218,118,0.42)`);
        mng.addColorStop(0.42, 'rgba(235,165,52,0.16)');
        mng.addColorStop(1,    'rgba(175,88,12,0)');
        ctx.fillStyle = mng; ctx.fillRect(0, 0, W*0.62, H*0.72);
      }

      // ── 5. AFTERNOON: saturated amber deep fill ───────────────────────────
      if (period === 'AFTERNOON') {
        const ag = ctx.createRadialGradient(W*0.50, H*0.60, 0, W*0.50, H*0.60, W*0.82);
        ag.addColorStop(0,    `rgba(255,138,22,0.48)`);
        ag.addColorStop(0.30, `rgba(228,92,8,0.22)`);
        ag.addColorStop(0.65, `rgba(175,45,4,0.09)`);
        ag.addColorStop(1,    'rgba(68,12,0,0)');
        ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H);
      }

      // ── 6. EVENING: intense ember glow — cinematic fireplace dominant ─────
      if (period === 'EVENING') {
        // Upper ambient from fireplace heat
        const eg = ctx.createRadialGradient(W*0.50, H*0.20, 0, W*0.50, H*0.20, W*0.75);
        eg.addColorStop(0,    `rgba(255,115,18,${0.35 * fireFlicker})`);
        eg.addColorStop(0.32, `rgba(215,65,6,${0.15 * fireFlicker})`);
        eg.addColorStop(1,    'rgba(88,18,2,0)');
        ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H*0.62);
        // Right ember side
        const er = ctx.createRadialGradient(W, H*0.55, 0, W, H*0.55, W*0.55);
        er.addColorStop(0,    `rgba(228,85,8,${0.28 * fireFlicker})`);
        er.addColorStop(0.45, 'rgba(165,42,4,0.10)');
        er.addColorStop(1,    'rgba(55,10,0,0)');
        ctx.fillStyle = er; ctx.fillRect(W*0.42, 0, W*0.58, H);
      }

      // ── 7. NIGHT: dark warm candlelit corners ─────────────────────────────
      if (period === 'NIGHT') {
        // Single candle point glow — upper-left
        const ng = ctx.createRadialGradient(W*0.15, H*0.28, 0, W*0.15, H*0.28, W*0.42);
        ng.addColorStop(0,    `rgba(255,175,55,${0.38 * fireFlicker})`);
        ng.addColorStop(0.22, `rgba(235,120,22,${0.18 * fireFlicker})`);
        ng.addColorStop(1,    'rgba(95,28,4,0)');
        ctx.fillStyle = ng; ctx.fillRect(0, 0, W*0.52, H*0.75);
      }

      // ── 8. Floating warm dust motes ──────────────────────────────────────
      const dustVis = { MORNING:0.55, AFTERNOON:0.42, EVENING:0.62, NIGHT:0.78 }[period] || 0.5;
      for (let di = 0; di < 32; di++) {
        const dx = W * ((di * 0.0809 + Math.sin(t*0.22+di*0.62)*0.018 + 1.0) % 1.0);
        const dy = H * ((di * 0.1618 + Math.cos(t*0.16+di*0.44)*0.014 + 1.0) % 1.0);
        const dr = 0.5 + 1.8 * ((di * 0.382) % 1.0);
        const da = (0.04 + 0.18 * ((di*0.618) % 1.0)) * dustVis * (0.35 + 0.65 * Math.abs(Math.sin(t*1.2+di*1.85)));
        if (da < 0.012) continue;
        const dg = ctx.createRadialGradient(dx, dy, 0, dx, dy, dr * 2.8);
        dg.addColorStop(0,   `rgba(255,208,115,${da * 3.2})`);
        dg.addColorStop(0.45, `rgba(242,172,65,${da * 1.4})`);
        dg.addColorStop(1,   'rgba(215,128,28,0)');
        ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(dx, dy, dr * 2.8, 0, Math.PI*2); ctx.fill();
      }

      // ── 9. Cinematic warm-edge vignette ──────────────────────────────────
      const vigAmt = period === 'NIGHT' ? 0.88 : period === 'EVENING' ? 0.78 : 0.68;
      const vigRad = ctx.createRadialGradient(W*0.5, H*0.5, W*0.20, W*0.5, H*0.5, W*0.88);
      vigRad.addColorStop(0,    'rgba(0,0,0,0)');
      vigRad.addColorStop(0.58, 'rgba(0,0,0,0)');
      vigRad.addColorStop(1,    `rgba(4,1,0,${vigAmt})`);
      ctx.fillStyle = vigRad; ctx.fillRect(0, 0, W, H);

      // Animate fireplace particles (if they exist from old init)
      const fpX = W * 0.5, fpW2 = W * 0.22, fpY = H * 0.98, fpH2 = H * 0.22;
      if (this._fireParticles) {
        this._fireParticles.forEach((fp, i) => {
          fp.life++;
          if (fp.life > fp.maxLife) {
            fp.life = 0; fp.maxLife = 35 + Math.random() * 25|0;
            fp.x = fpX + (Math.random() - 0.5) * fpW2 * 0.55;
            fp.y = fpY - H * 0.05;
            fp.vx = (Math.random() - 0.5) * 0.65;
            fp.vy = -(0.55 + Math.random() * 1.0);
            fp.r = 5 + Math.random() * 18;
            fp.hue = 10 + Math.random() * 35|0;
          }
          fp.x += fp.vx + Math.sin(t * 2.2 + i) * 0.45;
          fp.y += fp.vy; fp.vy -= 0.012;
          const prog = fp.life / fp.maxLife;
          fp.alpha = Math.sin(prog * Math.PI) * 0.75;
          const fG = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, fp.r);
          fG.addColorStop(0,   `hsla(${fp.hue+18},100%,88%,${fp.alpha})`);
          fG.addColorStop(0.5, `hsla(${fp.hue},92%,62%,${fp.alpha*0.6})`);
          fG.addColorStop(1,   `hsla(${fp.hue-8},85%,38%,0)`);
          ctx.fillStyle = fG; ctx.beginPath(); ctx.arc(fp.x, fp.y, fp.r, 0, Math.PI*2); ctx.fill();
        });
      }
    },


    create(W, H) {
      const r = Math.random();
      if (r < 0.55) {
        // Floating dust mote in warm light
        return {
          type: 'dust',
          x: Math.random() * W, y: H * 0.12 + Math.random() * H * 0.72,
          vx: (Math.random() - 0.5) * 0.30, vy: -(0.04 + Math.random() * 0.15),
          r: 0.7 + Math.random() * 2.0,
          hue: 32 + Math.random() * 22|0,
          alpha: 0, maxAlpha: 0.28 + Math.random() * 0.28,
          life: 0, fadeIn: 25, maxLife: 200 + Math.floor(Math.random() * 120),
          sw: Math.random() * Math.PI * 2, swAmp: 0.4 + Math.random() * 0.9, swSpd: 0.007 + Math.random() * 0.012,
        };
      } else if (r < 0.80) {
        // Ember spark from fireplace
        return {
          type: 'ember',
          x: W * 0.5 + (Math.random() - 0.5) * W * 0.12,
          y: H * 0.88,
          vx: (Math.random() - 0.5) * 1.8, vy: -(1.2 + Math.random() * 2.2),
          r: 0.8 + Math.random() * 2.5,
          hue: 15 + Math.random() * 28|0,
          alpha: 0, maxAlpha: 0.75 + Math.random() * 0.22,
          life: 0, fadeIn: 5, maxLife: 30 + Math.floor(Math.random() * 28),
          gravity: 0.045 + Math.random() * 0.030,
        };
      } else {
        // Rain droplet impact on window ledge
        return {
          type: 'drop',
          x: W * (0.04 + Math.random() * 0.24),
          y: H * (0.55 + Math.random() * 0.01),
          r: 0, maxR: 3 + Math.random() * 5,
          alpha: 0.20 + Math.random() * 0.22,
          life: 0, maxLife: 20 + Math.floor(Math.random() * 18),
        };
      }
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.type === 'dust') {
        const dG = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2);
        dG.addColorStop(0, `hsla(${p.hue},78%,82%,1)`);
        dG.addColorStop(1, `hsla(${p.hue},60%,60%,0)`);
        ctx.fillStyle = dG; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'ember') {
        const eG = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.5);
        eG.addColorStop(0,   `hsla(${p.hue + 20},100%,92%,1)`);
        eG.addColorStop(0.4,  `hsla(${p.hue},95%,68%,0.75)`);
        eG.addColorStop(1,   `hsla(${p.hue - 8},85%,42%,0)`);
        ctx.fillStyle = eG; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'drop') {
        ctx.strokeStyle = 'rgba(165,195,230,1)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    },

    update(p, W, H) {
      p.life++;
      if (p.type === 'dust') {
        p.sw += p.swSpd; p.x += p.vx + Math.sin(p.sw) * p.swAmp; p.y += p.vy;
        const fi = Math.min(1, p.life / p.fadeIn);
        const fo = p.life > p.maxLife - 25 ? Math.max(0, (p.maxLife - p.life) / 25) : 1;
        p.alpha = p.maxAlpha * fi * fo;
        return p.life < p.maxLife && p.y > 0;
      } else if (p.type === 'ember') {
        p.vy += p.gravity; // gravity pulls it back down
        p.vx *= 0.990;
        p.x += p.vx; p.y += p.vy;
        const fi = Math.min(1, p.life / p.fadeIn);
        const fo = p.life > p.maxLife - 10 ? Math.max(0, (p.maxLife - p.life) / 10) : 1;
        p.alpha = p.maxAlpha * fi * fo;
        return p.life < p.maxLife && p.y < H;
      } else if (p.type === 'drop') {
        p.r = (p.life / p.maxLife) * p.maxR;
        p.alpha = (1 - p.life / p.maxLife) * (0.20 + Math.random() * 0.22);
        return p.life < p.maxLife;
      }
      return false;
    },
  },

  // ── Matrix — premium digital rain per matrix.md ──────────────────────────
  // Full-width katakana + 0/1 columns, shadow glow on head char,
  // scanline overlay, radial vignette, ResizeObserver-aware sizing.
  matrix: {
    max: 0, rate: 0,
    _cols: null,
    _fontSize: 16,

    // Charset: katakana half-width + digits, matching matrix.md DEFAULT_CHARSET
    _charset: 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789',

    _mc() {
      const cs = this._charset;
      return cs[Math.floor(Math.random() * cs.length)];
    },

    init(W, H) {
      _stars = [];
      const fs  = this._fontSize;
      const n   = Math.ceil(W / fs);
      this._cols = Array.from({ length: n }, (_, i) => ({
        x:     i * fs,
        y:     Math.random() * -H,
        speed: (0.5 + Math.random() * 0.5) * 1.0, // speed multiplier ×1
        chars: Array.from({ length: 25 }, () => ({
          c:      this._mc(),
          age:    0,
          maxAge: 6 + Math.floor(Math.random() * 12),
        })),
        length: 15 + Math.floor(Math.random() * 15),
        bright: Math.random() > 0.85,
      }));
    },

    drawBackground(ctx, W, H) {
      const fs = this._fontSize;

      // Fade trail — pure black with low opacity (creates the glowing tail effect)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, W, H);

      ctx.font = `${fs}px monospace`;

      if (!this._cols) return;
      this._cols.forEach(col => {
        // Advance column
        col.y += col.speed * fs * 0.5;

        for (let i = 0; i < col.length; i++) {
          const charY = col.y - i * fs;
          if (charY < -fs || charY > H + fs) continue;

          // Mutate char occasionally
          const ch = col.chars[i % col.chars.length];
          ch.age++;
          if (ch.age >= ch.maxAge) {
            ch.c      = this._mc();
            ch.age    = 0;
            ch.maxAge = 6 + Math.floor(Math.random() * 12);
          }

          const isHead = i === 0;
          const opacity = isHead ? 1 : Math.max(0, 1 - i / col.length);

          ctx.save();
          if (isHead) {
            // Bright white-green head with glow shadow
            const r = col.bright ? Math.min(255, 0   + 150) : 0;
            const g = col.bright ? Math.min(255, 255 + 150) : 255;
            const b = col.bright ? Math.min(255, 0   + 150) : 0;
            ctx.fillStyle   = `rgba(${r},${g},${b},${opacity})`;
            ctx.shadowColor = '#00ff00';
            ctx.shadowBlur  = 10;
          } else {
            // Trail: pure green, fading
            ctx.fillStyle  = `rgba(0, 255, 0, ${opacity * 0.8})`;
            ctx.shadowBlur = 0;
          }

          ctx.fillText(ch.c, col.x, charY);
          ctx.restore();
        }

        ctx.shadowBlur = 0;

        // Reset column when scrolled off bottom
        if (col.y - col.length * fs > H) {
          col.y      = Math.random() * -H * 0.5;
          col.speed  = (0.5 + Math.random() * 0.5) * 1.0;
          col.length = 15 + Math.floor(Math.random() * 15);
          col.bright = Math.random() > 0.85;
        }
      });

      // ── Scanline overlay (matching matrix.md) ──────────────────────────
      ctx.save(); ctx.globalAlpha = 0.03;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let sy = 0; sy < H; sy += 2) {
        ctx.fillRect(0, sy + 1, W, 1);
      }
      ctx.restore();

      // ── Radial vignette (matching matrix.md) ───────────────────────────
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.22, W * 0.5, H * 0.5, W * 0.82);
      vg.addColorStop(0,    'rgba(0,0,0,0)');
      vg.addColorStop(0.50, 'rgba(0,0,0,0)');
      vg.addColorStop(1,    'rgba(0,0,0,0.70)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    },

    create() { return null; },
    draw()   {},
    update() { return false; },
  },

  // ── RAIN — Premium Atmospheric Rain Scene ──────────────────────────────────
  // Cinematic overcast: layered rain streaks, fog, reflective puddle shimmer,
  // cool silver palette, time-of-day sky toning.
  // ── RAIN — Cinematic atmospheric rainfall ─────────────────────────────────
  // Reference palette: MORNING=pale silver-blue + white center glow + sparkles,
  // AFTERNOON=deep navy + piercing cyan star-glow + dense sparkle field,
  // EVENING=deep violet + dramatic warm orange corner fire glow.
  rain: {
    max: 115, rate: 0.38,
    _fog: null, _sparkles: null, _ripples: [],

    init(W, H) {
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);
      // Layered cinematic fog bands — elliptical, softly drifting
      this._fog = Array.from({ length: 8 }, () => ({
        y: H * rng(0.04, 0.84),
        w: W * rng(1.4, 2.6),
        h: H * rng(0.032, 0.095),
        alpha: rng(0.015, 0.054),
        x: -W * rng(0.08, 0.48),
        speed: rng(0.04, 0.20),
        phase: rng(0, Math.PI * 2),
        spd: rng(0.003, 0.008),
      }));
      // Sparkle/shimmer particle field — visible in MORNING + AFTERNOON of reference
      this._sparkles = Array.from({ length: 130 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H * 0.86,
        r: 0.28 + Math.random() * 1.85,
        baseAlpha: 0.07 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
        spd: 0.018 + Math.random() * 0.040,
      }));
      this._ripples = [];
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend  = _getSmoothBlend();
      const t = _frame * 0.010;

      // ── 1. Base sky gradient — matched precisely to reference ────────────
      // MORNING: pale silver-blue (overcast brightened by hidden sun)
      // AFTERNOON: deep cold navy (cinematic stormy deep blue)
      // EVENING: deep purple-violet (dramatic moody dusk)
      // NIGHT: near-black slate-blue
      const SKY = {
        MORNING:   { t:[62, 90,132],  m:[88,122,170],  b:[110,152,200] },
        AFTERNOON: { t:[ 5, 14, 46],  m:[ 10, 26, 68],  b:[ 18, 42, 92] },
        EVENING:   { t:[ 7,  4, 22],  m:[ 16,  7, 48],  b:[ 28, 10, 72] },
        NIGHT:     { t:[ 3,  5, 16],  m:[  7,  9, 26],  b:[ 11, 15, 40] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,    _rgb(sk.t));
      skyG.addColorStop(0.46, _rgb(sk.m));
      skyG.addColorStop(1,    _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Signature period glow (the identity of each time of day) ──────
      // MORNING: soft white sun-behind-clouds bloom at center
      if (period === 'MORNING') {
        const mg = ctx.createRadialGradient(W*0.50, H*0.42, 0, W*0.50, H*0.42, W*0.42);
        mg.addColorStop(0,    'rgba(255,252,242,0.55)');
        mg.addColorStop(0.16, 'rgba(228,242,255,0.30)');
        mg.addColorStop(0.42, 'rgba(182,220,255,0.13)');
        mg.addColorStop(1,    'rgba(140,195,250,0)');
        ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H);
        // Top sky diffusion (overcast brightness)
        const mg2 = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.62);
        mg2.addColorStop(0,    'rgba(208,232,255,0.22)');
        mg2.addColorStop(0.55, 'rgba(172,212,255,0.07)');
        mg2.addColorStop(1,    'rgba(150,198,252,0)');
        ctx.fillStyle = mg2; ctx.fillRect(0, 0, W, H);
      }
      // AFTERNOON: piercing cyan star-glow — the single bright light source through rain
      if (period === 'AFTERNOON') {
        const pulse = 0.86 + 0.14 * Math.sin(t * 1.75);
        const ag = ctx.createRadialGradient(W*0.48, H*0.44, 0, W*0.48, H*0.44, W*0.44);
        ag.addColorStop(0,    `rgba(218,250,255,${0.76 * pulse})`);
        ag.addColorStop(0.06, `rgba(152,235,255,${0.58 * pulse})`);
        ag.addColorStop(0.18, `rgba(68,192,255,${0.32 * pulse})`);
        ag.addColorStop(0.40, `rgba(22,132,222,${0.14 * pulse})`);
        ag.addColorStop(1,    'rgba(6,52,132,0)');
        ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H);
        // Tight bright star core — the small brilliant point visible in reference
        const ac = ctx.createRadialGradient(W*0.48, H*0.44, 0, W*0.48, H*0.44, W*0.038);
        ac.addColorStop(0,    `rgba(255,255,255,${0.94 * pulse})`);
        ac.addColorStop(0.45, `rgba(228,252,255,${0.56 * pulse})`);
        ac.addColorStop(1,    'rgba(180,240,255,0)');
        ctx.fillStyle = ac; ctx.fillRect(0, 0, W, H);
      }
      // EVENING: dramatic warm orange fire glow from upper-right (city lights through rain)
      if (period === 'EVENING') {
        const eg = ctx.createRadialGradient(W*0.86, H*0.06, 0, W*0.86, H*0.06, W*0.56);
        eg.addColorStop(0,    'rgba(255,158,38,0.78)');
        eg.addColorStop(0.10, 'rgba(248,95,18,0.54)');
        eg.addColorStop(0.28, 'rgba(188,40,10,0.28)');
        eg.addColorStop(0.52, 'rgba(108,12,35,0.13)');
        eg.addColorStop(1,    'rgba(38,4,18,0)');
        ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
        // Counter-side purple atmospheric depth
        const ep = ctx.createRadialGradient(W*0.24, H*0.54, 0, W*0.24, H*0.54, W*0.54);
        ep.addColorStop(0,    'rgba(108,28,178,0.26)');
        ep.addColorStop(0.5,  'rgba(64,10,118,0.11)');
        ep.addColorStop(1,    'rgba(28,3,56,0)');
        ctx.fillStyle = ep; ctx.fillRect(0, 0, W, H);
      }
      // NIGHT: cool moonlit glow — subtle, through heavy cloud
      if (period === 'NIGHT') {
        const ng = ctx.createRadialGradient(W*0.22, H*0.10, 0, W*0.22, H*0.10, W*0.40);
        ng.addColorStop(0,    'rgba(158,200,255,0.32)');
        ng.addColorStop(0.42, 'rgba(98,155,238,0.13)');
        ng.addColorStop(1,    'rgba(48,90,178,0)');
        ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H);
      }

      // ── 3. Atmospheric fog layers — drifting elliptical bands ───────────
      const fogMult = { MORNING:1.55, AFTERNOON:1.0, EVENING:1.22, NIGHT:0.88 }[period] || 1.0;
      const fR = period === 'EVENING' ? 205 : period === 'NIGHT' ? 118 : 172;
      const fGc = period === 'EVENING' ? 152 : period === 'NIGHT' ? 158 : 212;
      const fB = period === 'EVENING' ? 225 : period === 'NIGHT' ? 222 : 252;
      this._fog.forEach(f => {
        f.x += f.speed;
        f.phase += f.spd;
        if (f.x > W * 1.28) f.x = -W * 0.68;
        const pulse = 0.60 + 0.40 * Math.sin(f.phase);
        const fa = f.alpha * pulse * fogMult;
        const fgr = ctx.createLinearGradient(f.x, f.y, f.x + f.w, f.y);
        fgr.addColorStop(0,    `rgba(${fR},${fGc},${fB},0)`);
        fgr.addColorStop(0.22, `rgba(${fR},${fGc},${fB},${fa})`);
        fgr.addColorStop(0.78, `rgba(${fR},${fGc},${fB},${fa * 0.80})`);
        fgr.addColorStop(1,    `rgba(${fR},${fGc},${fB},0)`);
        ctx.save(); ctx.fillStyle = fgr;
        ctx.beginPath();
        ctx.ellipse(f.x + f.w * 0.5, f.y, f.w * 0.5, f.h * 0.5, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.restore();
      });

      // ── 4. Sparkle / shimmer field — matches reference density per period
      const sparkVis = { MORNING:0.55, AFTERNOON:0.95, EVENING:0.24, NIGHT:0.18 }[period] || 0.5;
      const spR = period === 'AFTERNOON' ? 155 : period === 'EVENING' ? 255 : 198;
      const spGc = period === 'AFTERNOON' ? 242 : period === 'EVENING' ? 195 : 228;
      const spB = period === 'AFTERNOON' ? 255 : period === 'EVENING' ? 215 : 255;
      this._sparkles.forEach(s => {
        s.phase += s.spd;
        const sa = s.baseAlpha * sparkVis * (0.28 + 0.72 * Math.abs(Math.sin(s.phase)));
        if (sa < 0.015) return;
        ctx.save(); ctx.globalAlpha = sa;
        if (s.r > 1.12) {
          // Cross-sparkle for brighter particles (visible in reference)
          ctx.strokeStyle = `rgba(${spR},${spGc},${spB},1)`;
          ctx.lineWidth = s.r * 0.38; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s.x - s.r * 2.8, s.y); ctx.lineTo(s.x + s.r * 2.8, s.y);
          ctx.moveTo(s.x, s.y - s.r * 2.8); ctx.lineTo(s.x, s.y + s.r * 2.8);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${spR},${spGc},${spB},1)`;
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.3, s.r * 0.52), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // ── 5. Horizon glow + reflective ground ─────────────────────────────
      const horizY = H * 0.76;
      const hR = period === 'MORNING' ? 178 : period === 'AFTERNOON' ? 78 : period === 'EVENING' ? 255 : 78;
      const hGc = period === 'MORNING' ? 215 : period === 'AFTERNOON' ? 200 : period === 'EVENING' ? 138 : 128;
      const hB = period === 'MORNING' ? 255 : period === 'AFTERNOON' ? 255 : period === 'EVENING' ? 55 : 222;

      // Horizon luminance band
      const hGlow = ctx.createLinearGradient(0, horizY - 8, 0, horizY + 8);
      hGlow.addColorStop(0,   `rgba(${hR},${hGc},${hB},0)`);
      hGlow.addColorStop(0.5, `rgba(${hR},${hGc},${hB},0.42)`);
      hGlow.addColorStop(1,   `rgba(${hR},${hGc},${hB},0)`);
      ctx.fillStyle = hGlow; ctx.fillRect(0, horizY - 12, W, 24);

      // Reflective wet ground
      const gR = period === 'MORNING' ? 52 : period === 'AFTERNOON' ? 12 : period === 'EVENING' ? 32 : 6;
      const gGc = period === 'MORNING' ? 82 : period === 'AFTERNOON' ? 30 : period === 'EVENING' ? 8 : 10;
      const gB = period === 'MORNING' ? 128 : period === 'AFTERNOON' ? 80 : period === 'EVENING' ? 52 : 30;
      const gndG = ctx.createLinearGradient(0, horizY, 0, H);
      gndG.addColorStop(0,    `rgba(${gR},${gGc},${gB},0.86)`);
      gndG.addColorStop(0.40, `rgba(${gR},${gGc},${gB},0.93)`);
      gndG.addColorStop(1,    `rgba(${Math.max(0,gR-8)},${Math.max(0,gGc-5)},${Math.max(0,gB-6)},0.98)`);
      ctx.fillStyle = gndG; ctx.fillRect(0, horizY, W, H - horizY);

      // Center reflection glow (source mirrored on ground)
      const refG = ctx.createRadialGradient(W*0.50, horizY + 8, 0, W*0.50, horizY + 8, W*0.60);
      refG.addColorStop(0,    `rgba(${hR},${hGc},${hB},0.36)`);
      refG.addColorStop(0.22, `rgba(${hR},${hGc},${hB},0.14)`);
      refG.addColorStop(1,    `rgba(${hR},${hGc},${hB},0)`);
      ctx.fillStyle = refG; ctx.fillRect(0, horizY, W, H - horizY);

      // Puddle shimmer strips
      ctx.save();
      for (let pi = 0; pi < 7; pi++) {
        const py = horizY + (H - horizY) * (0.05 + pi * 0.14);
        const pw = W * (0.10 + 0.06 * Math.sin(t * 0.22 + pi * 1.42));
        const px = W * (0.25 + pi * 0.075) + Math.cos(t * 0.15 + pi) * W * 0.055;
        const shimA = (0.14 + 0.05 * Math.sin(t * 0.75 + pi)) * (period === 'NIGHT' ? 1.75 : 1.0);
        ctx.globalAlpha = shimA;
        const pG = ctx.createLinearGradient(px - pw, py, px + pw, py);
        pG.addColorStop(0,   `rgba(${hR},${hGc},${hB},0)`);
        pG.addColorStop(0.5, `rgba(${hR},${hGc},${hB},1)`);
        pG.addColorStop(1,   `rgba(${hR},${hGc},${hB},0)`);
        ctx.fillStyle = pG; ctx.fillRect(px - pw, py - 1.2, pw * 2, 2.6);
      }
      ctx.restore();

      // ── 6. Puddle ripples ────────────────────────────────────────────────
      if (Math.random() < 0.10) {
        this._ripples.push({
          x: W * (0.04 + Math.random() * 0.92),
          y: horizY + (H - horizY) * (0.06 + Math.random() * 0.90),
          r: 0, maxR: 14 + Math.random() * 26,
          alpha: 0.48 + Math.random() * 0.32,
          life: 0, maxLife: 30 + Math.floor(Math.random() * 22),
        });
      }
      this._ripples = this._ripples.filter(rp => {
        rp.life++;
        rp.r += rp.maxR / rp.maxLife;
        const a = rp.alpha * (1 - rp.life / rp.maxLife);
        ctx.save(); ctx.globalAlpha = a;
        ctx.strokeStyle = `rgba(${hR},${hGc},${hB},1)`; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
        if (rp.r > 5) {
          ctx.strokeStyle = `rgba(${hR},${hGc},${hB},0.38)`; ctx.lineWidth = 0.45;
          ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.r * 0.55, rp.r * 0.20, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
        return rp.life < rp.maxLife;
      });

      // ── 7. Cinematic radial edge vignette ────────────────────────────────
      const vR = period === 'EVENING' ? 8 : period === 'NIGHT' ? 2 : 3;
      const vGc = period === 'EVENING' ? 2 : period === 'NIGHT' ? 3 : 7;
      const vB = period === 'EVENING' ? 18 : period === 'NIGHT' ? 12 : 18;
      const vigA = period === 'NIGHT' ? 0.80 : period === 'EVENING' ? 0.70 : 0.54;
      const vigRad = ctx.createRadialGradient(W*0.5, H*0.5, W*0.25, W*0.5, H*0.5, W*0.90);
      vigRad.addColorStop(0,    `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(0.60, `rgba(${vR},${vGc},${vB},0)`);
      vigRad.addColorStop(1,    `rgba(${vR},${vGc},${vB},${vigA})`);
      ctx.fillStyle = vigRad; ctx.fillRect(0, 0, W, H);
    },

    create(W, H) {
      const period = _getCanvasPeriod();
      const r = Math.random();
      if (r < 0.70) {
        // Rain streak — layered depth with wind sway
        const windBias = Math.sin(_frame * 0.006) * 0.38;
        const heavy = period === 'NIGHT' || period === 'AFTERNOON';
        return {
          type: 'rain',
          x: Math.random() * W * 1.32 - W * 0.16,
          y: -28 - Math.random() * H * 0.48,
          vx: -0.65 + windBias + (Math.random() - 0.5) * 0.28,
          vy: (heavy ? 7.2 : 5.0) + Math.random() * 4.2,
          len: (heavy ? 14 : 9) + Math.random() * 22,
          alpha: 0.05 + Math.random() * 0.17,
          layer: Math.floor(Math.random() * 3),
        };
      } else if (r < 0.88) {
        // Atmospheric mist orb
        return {
          type: 'mist',
          x: Math.random() * W, y: Math.random() * H * 0.80,
          vx: (Math.random() - 0.5) * 0.20, vy: (Math.random() - 0.5) * 0.09,
          r: 8 + Math.random() * 30,
          alpha: 0, maxAlpha: 0.022 + Math.random() * 0.028,
          life: 0, fadeIn: 42, maxLife: 185 + Math.floor(Math.random() * 130),
          sw: Math.random() * Math.PI * 2, swAmp: 0.28 + Math.random() * 0.82, swSpd: 0.005 + Math.random() * 0.008,
        };
      } else {
        // Near-vertical falling droplet (foreground)
        return {
          type: 'drop',
          x: Math.random() * W,
          y: -10 - Math.random() * 52,
          vy: 4.8 + Math.random() * 3.8,
          alpha: 0.16 + Math.random() * 0.26,
        };
      }
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.type === 'rain') {
        const layerA  = [1.0, 0.62, 0.36][p.layer] || 0.5;
        const layerBl = [188, 175, 162][p.layer] || 175;
        ctx.strokeStyle = `rgba(${layerBl},215,255,${layerA})`;
        ctx.lineWidth = [0.85, 0.52, 0.30][p.layer] || 0.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 2.6, p.y + p.len);
        ctx.stroke();
      } else if (p.type === 'mist') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0,   'rgba(178,216,255,1)');
        g.addColorStop(0.5, 'rgba(162,206,250,0.38)');
        g.addColorStop(1,   'rgba(145,195,244,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(182,222,255,0.88)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    },

    update(p, W, H) {
      if (p.type === 'rain') {
        p.x += p.vx; p.y += p.vy;
        return p.y < H + 32 && p.x > -55 && p.x < W + 55;
      } else if (p.type === 'mist') {
        p.life++; p.sw += p.swSpd;
        p.x += p.vx + Math.sin(p.sw) * p.swAmp; p.y += p.vy;
        const fi = Math.min(1, p.life / p.fadeIn);
        const fo = p.life > p.maxLife - 38 ? Math.max(0, (p.maxLife - p.life) / 38) : 1;
        p.alpha = p.maxAlpha * fi * fo;
        return p.life < p.maxLife;
      } else {
        p.y += p.vy;
        return p.y < H + 16;
      }
    },
  },

  // ── DREAMSCAPE — Surreal Lucid Dream ───────────────────────────────────────
  // Weightless, ethereal: floating light orbs, aurora-like waves,
  // dreamy depth blur particles, soft cosmic atmosphere.
  dreamscape: {
    max: 45, rate: 0.095,
    _orbs: null, _waveLines: null, _stars: null, _dust: null,

    init(W, H) {
      _stars = [];
      _initStars(W, H, 80);
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);

      // Floating luminous orbs — dreamy blobs
      this._orbs = Array.from({ length: 12 }, (_, i) => ({
        x: W * rng(0.05, 0.95),
        y: H * rng(0.10, 0.90),
        r: W * rng(0.025, 0.12),
        hue: [260, 195, 285, 220, 300, 180, 240, 320, 200, 280, 160, 310][i % 12],
        alpha: 0.04 + rng(0, 0.06),
        phase: rng(0, Math.PI * 2),
        spd: rng(0.004, 0.010),
        driftX: (rng(-1, 1)) * 0.18,
        driftY: -(0.05 + rng(0, 0.12)),
      }));

      // Aurora-like wave lines across top half
      this._waveLines = Array.from({ length: 8 }, (_, i) => ({
        yBase: H * rng(0.05, 0.55),
        amplitude: H * rng(0.02, 0.08),
        hue: [255, 185, 290, 210, 320, 170, 270, 205][i % 8],
        alpha: 0.04 + rng(0, 0.05),
        phase: i * 0.62 + rng(0, 1),
        spd: rng(0.004, 0.009),
        wavelength: W * rng(0.35, 0.80),
        thickness: 1.5 + rng(0, 2.5),
      }));

      // Fine dust particles
      this._dust = Array.from({ length: 38 }, () => ({
        x: rng(0, W), y: rng(0, H),
        r: 0.6 + rng(0, 1.8),
        hue: rng(220, 310)|0,
        phase: rng(0, Math.PI * 2), spd: rng(0.012, 0.025),
        vx: (rng(-1,1)) * 0.18, vy: -(0.05 + rng(0, 0.22)),
        alpha: 0.15 + rng(0, 0.25),
      }));
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend  = _getSmoothBlend();
      const t = _frame * 0.011;

      // ── 1. Dream sky gradient — matched to reference ─────────────────────
      // MORNING: medium purple-lavender with lighter upper tone
      // AFTERNOON: deep violet + vivid pink cloud masses (reference: very saturated)
      // EVENING: dark rich indigo-blue (reference shows cool blue dominance)
      // NIGHT: near-black deep indigo
      const SKY = {
        MORNING:   { t:[ 55, 28,108],  m:[105, 55,175],  b:[168, 95,235] },
        AFTERNOON: { t:[ 22, 10, 60],  m:[ 52, 22,125],  b:[108, 45,195] },
        EVENING:   { t:[  8,  5, 35],  m:[ 18, 10, 70],  b:[ 35, 18,118] },
        NIGHT:     { t:[  3,  1, 15],  m:[  8,  3, 35],  b:[ 18,  8, 68] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,    _rgb(sk.t));
      skyG.addColorStop(0.48, _rgb(sk.m));
      skyG.addColorStop(1,    _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Signature period glow ─────────────────────────────────────────
      if (period === 'MORNING') {
        // Soft lavender upper bloom
        const mg = ctx.createRadialGradient(W*0.50, H*0.22, 0, W*0.50, H*0.22, W*0.65);
        mg.addColorStop(0,    'rgba(210,145,255,0.52)');
        mg.addColorStop(0.22, 'rgba(168,88,245,0.28)');
        mg.addColorStop(0.55, 'rgba(118,42,215,0.11)');
        mg.addColorStop(1,    'rgba(62,12,155,0)');
        ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H*0.75);
        // Pink bottom warmth
        const mb = ctx.createRadialGradient(W*0.50, H, 0, W*0.50, H, W*0.72);
        mb.addColorStop(0,    'rgba(255,122,215,0.32)');
        mb.addColorStop(0.42, 'rgba(215,68,185,0.14)');
        mb.addColorStop(1,    'rgba(125,22,125,0)');
        ctx.fillStyle = mb; ctx.fillRect(0, H*0.45, W, H*0.55);
      }
      if (period === 'AFTERNOON') {
        const pulse = 0.88 + 0.12 * Math.sin(t * 1.4);
        // Vivid pink cloud mass at bottom-centre (reference signature)
        const ag = ctx.createRadialGradient(W*0.50, H*0.92, 0, W*0.50, H*0.92, W*0.72);
        ag.addColorStop(0,    `rgba(255,78,220,${0.72 * pulse})`);
        ag.addColorStop(0.12, `rgba(235,42,195,${0.50 * pulse})`);
        ag.addColorStop(0.32, `rgba(188,18,162,${0.24 * pulse})`);
        ag.addColorStop(0.60, `rgba(128,4,115,${0.10 * pulse})`);
        ag.addColorStop(1,    'rgba(55,0,55,0)');
        ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H);
        // Upper deep violet bloom
        const av = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.68);
        av.addColorStop(0,    `rgba(88,22,215,${0.42 * pulse})`);
        av.addColorStop(0.45, 'rgba(52,10,165,0.18)');
        av.addColorStop(1,    'rgba(22,3,80,0)');
        ctx.fillStyle = av; ctx.fillRect(0, 0, W, H*0.68);
        // Side ethereal columns
        const asL = ctx.createRadialGradient(0, H*0.55, 0, 0, H*0.55, W*0.52);
        asL.addColorStop(0,    `rgba(145,42,255,${0.30 * pulse})`);
        asL.addColorStop(0.50, 'rgba(88,18,210,0.11)');
        asL.addColorStop(1,    'rgba(38,4,95,0)');
        ctx.fillStyle = asL; ctx.fillRect(0, 0, W*0.58, H);
        const asR = ctx.createRadialGradient(W, H*0.52, 0, W, H*0.52, W*0.52);
        asR.addColorStop(0,    `rgba(38,175,255,${0.28 * pulse})`);
        asR.addColorStop(0.50, 'rgba(18,115,215,0.10)');
        asR.addColorStop(1,    'rgba(4,42,95,0)');
        ctx.fillStyle = asR; ctx.fillRect(W*0.42, 0, W*0.58, H);
      }
      if (period === 'EVENING') {
        // Deep blue atmospheric (reference is cool blue-dominant for evening)
        const eg = ctx.createRadialGradient(W*0.50, 0, 0, W*0.50, 0, W*0.75);
        eg.addColorStop(0,    'rgba(28,48,195,0.45)');
        eg.addColorStop(0.42, 'rgba(14,22,145,0.18)');
        eg.addColorStop(1,    'rgba(4,6,65,0)');
        ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H*0.75);
        // Faint pink remnant at bottom
        const ep = ctx.createRadialGradient(W*0.50, H, 0, W*0.50, H, W*0.62);
        ep.addColorStop(0,    'rgba(145,28,185,0.32)');
        ep.addColorStop(0.45, 'rgba(88,12,135,0.12)');
        ep.addColorStop(1,    'rgba(32,3,55,0)');
        ctx.fillStyle = ep; ctx.fillRect(0, H*0.40, W, H*0.60);
      }
      if (period === 'NIGHT') {
        const ng = ctx.createRadialGradient(W*0.38, H*0.12, 0, W*0.38, H*0.12, W*0.52);
        ng.addColorStop(0,    'rgba(105,65,215,0.28)');
        ng.addColorStop(0.45, 'rgba(62,28,168,0.11)');
        ng.addColorStop(1,    'rgba(22,6,75,0)');
        ctx.fillStyle = ng; ctx.fillRect(0, 0, W, H*0.55);
      }

      // ── 3. Ethereal cloud formations (the signature of dreamscape) ────────
      // These mimic the volumetric pink cloud masses seen in reference
      const cloudVis = { MORNING:0.65, AFTERNOON:1.0, EVENING:0.45, NIGHT:0.22 }[period] || 0.6;
      const [cR,cGc,cB] = period === 'EVENING' ? [88,65,215] : period === 'NIGHT' ? [55,28,145] : period === 'MORNING' ? [215,125,255] : [255,68,218];
      const cloudCfg = [
        {cx:0.18, cy:0.55, rx:0.28, ry:0.16},
        {cx:0.50, cy:0.50, rx:0.32, ry:0.18},
        {cx:0.80, cy:0.57, rx:0.26, ry:0.14},
        {cx:0.12, cy:0.72, rx:0.22, ry:0.12},
        {cx:0.68, cy:0.68, rx:0.25, ry:0.13},
        {cx:0.38, cy:0.78, rx:0.30, ry:0.15},
      ];
      cloudCfg.forEach((c, ci) => {
        const pulse = 0.55 + 0.45 * Math.sin(t * 0.55 + ci * 1.18);
        const ca = 0.08 * pulse * cloudVis;
        if (ca < 0.01) return;
        // Multi-layer cloud mass
        for (let li = 0; li < 3; li++) {
          const lx = W * (c.cx + (li - 1) * c.rx * 0.22);
          const ly = H * (c.cy - li * c.ry * 0.18);
          const lrx = W * c.rx * (0.7 + li * 0.15);
          const lry = H * c.ry * (0.7 + li * 0.10);
          const cg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lrx);
          cg.addColorStop(0,    `rgba(${cR},${cGc},${cB},${ca * (1.4 - li*0.28)})`);
          cg.addColorStop(0.50, `rgba(${cR},${cGc},${cB},${ca * (0.60 - li*0.12)})`);
          cg.addColorStop(1,    `rgba(${cR},${cGc},${cB},0)`);
          ctx.save(); ctx.scale(1, lry / lrx);
          ctx.fillStyle = cg;
          ctx.beginPath(); ctx.arc(lx, ly * lrx / lry, lrx, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        }
      });

      // ── 4. Aurora waves ──────────────────────────────────────────────────
      const auroraVis = period === 'NIGHT' ? 1.0 : period === 'EVENING' ? 0.5 : 0.18;
      this._waveLines.forEach(wl => {
        wl.phase += wl.spd;
        ctx.save(); ctx.globalAlpha = wl.alpha * auroraVis;
        ctx.strokeStyle = `hsla(${wl.hue},85%,72%,1)`;
        ctx.lineWidth = wl.thickness; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let xi = 0; xi <= W; xi += 4) {
          const y = wl.yBase + Math.sin((xi / wl.wavelength) * Math.PI * 2 + wl.phase) * wl.amplitude;
          xi === 0 ? ctx.moveTo(xi, y) : ctx.lineTo(xi, y);
        }
        ctx.stroke();
        ctx.restore();
      });

      // ── 5. Floating luminous orbs ────────────────────────────────────────
      this._orbs.forEach(orb => {
        orb.phase += orb.spd;
        orb.x += orb.driftX + Math.sin(orb.phase * 0.7) * 0.3;
        orb.y += orb.driftY + Math.cos(orb.phase * 0.5) * 0.2;
        if (orb.y < -orb.r * 2) { orb.y = H + orb.r; orb.x = Math.random() * W; }
        if (orb.x < -orb.r) orb.x = W + orb.r;
        if (orb.x > W + orb.r) orb.x = -orb.r;
        const pulse = 0.65 + 0.35 * Math.sin(orb.phase);
        const a = orb.alpha * pulse;
        const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
        g.addColorStop(0,    `hsla(${orb.hue},90%,82%,${a * 2.5})`);
        g.addColorStop(0.42, `hsla(${orb.hue},80%,62%,${a * 1.2})`);
        g.addColorStop(1,    `hsla(${orb.hue},70%,48%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2); ctx.fill();
      });

      // ── 6. Fine dust motes ───────────────────────────────────────────────
      this._dust.forEach(d => {
        d.phase += d.spd; d.x += d.vx; d.y += d.vy;
        if (d.y < -10) d.y = H + 10;
        if (d.x < -10) d.x = W + 10; if (d.x > W + 10) d.x = -10;
        const da = d.alpha * (0.4 + 0.6 * Math.sin(d.phase));
        const dg = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 3);
        dg.addColorStop(0, `hsla(${d.hue},88%,80%,${da * 2.2})`);
        dg.addColorStop(1, `hsla(${d.hue},72%,58%,0)`);
        ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 3, 0, Math.PI * 2); ctx.fill();
      });

      // ── 7. Edge vignette ─────────────────────────────────────────────────
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.2, W * 0.5, H * 0.5, W * 0.85);
      vg.addColorStop(0,    'rgba(0,0,0,0)');
      vg.addColorStop(0.68, 'rgba(0,0,0,0)');
      vg.addColorStop(1,    'rgba(2,0,12,0.72)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    },

    create(W, H) {
      const period = _getCanvasPeriod();
      const r = Math.random();
      if (r < 0.52) {
        // Ethereal floating particle — drifts upward weightlessly
        return {
          type: 'ether',
          x: Math.random() * W * 1.2 - W * 0.10,
          y: H + 15 + Math.random() * 60,
          vx: (Math.random() - 0.5) * 0.55,
          vy: -(0.20 + Math.random() * 0.65),
          r: 2 + Math.random() * 8,
          hue: [255, 190, 285, 215, 305, 175][Math.floor(Math.random() * 6)],
          alpha: 0, maxAlpha: 0.45 + Math.random() * 0.40,
          life: 0, fadeIn: 22, maxLife: 120 + Math.floor(Math.random() * 90),
          sw: Math.random() * Math.PI * 2, swAmp: 0.8 + Math.random() * 2.2, swSpd: 0.008 + Math.random() * 0.015,
        };
      } else if (r < 0.80) {
        // Dream sparkle — twinkles in place
        return {
          type: 'sparkle',
          x: Math.random() * W, y: Math.random() * H * 0.92,
          r: 0.6 + Math.random() * 2.8,
          hue: [260, 200, 300, 220, 315, 185][Math.floor(Math.random() * 6)],
          alpha: 0, maxAlpha: 0.55 + Math.random() * 0.38,
          life: 0, fadeIn: 8, maxLife: 45 + Math.floor(Math.random() * 40),
          vx: (Math.random() - 0.5) * 0.20, vy: -(0.04 + Math.random() * 0.18),
        };
      } else {
        // Slow-drifting dream mote
        return {
          type: 'mote',
          x: Math.random() * W, y: Math.random() * H * 0.88,
          vx: (Math.random() - 0.5) * 0.28, vy: -(0.06 + Math.random() * 0.20),
          r: 1.2 + Math.random() * 3.5,
          hue: [270, 210, 295, 180][Math.floor(Math.random() * 4)],
          alpha: 0, maxAlpha: 0.32 + Math.random() * 0.30,
          life: 0, fadeIn: 18, maxLife: 160 + Math.floor(Math.random() * 110),
          sw: Math.random() * Math.PI * 2, swAmp: 0.5 + Math.random() * 1.5, swSpd: 0.006 + Math.random() * 0.010,
        };
      }
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.type === 'ether') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.5);
        g.addColorStop(0,   `hsla(${p.hue},92%,88%,1)`);
        g.addColorStop(0.38,`hsla(${p.hue},82%,68%,0.55)`);
        g.addColorStop(1,   `hsla(${p.hue},72%,50%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.5, 0, Math.PI * 2); ctx.fill();
        // Core dot
        ctx.fillStyle = `hsla(${p.hue},95%,92%,0.85)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'sparkle') {
        const s = p.r;
        ctx.strokeStyle = `hsla(${p.hue},90%,82%,1)`;
        ctx.lineWidth = s * 0.50; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - s * 3.0, p.y); ctx.lineTo(p.x + s * 3.0, p.y);
        ctx.moveTo(p.x, p.y - s * 3.0); ctx.lineTo(p.x, p.y + s * 3.0);
        ctx.moveTo(p.x - s * 1.9, p.y - s * 1.9); ctx.lineTo(p.x + s * 1.9, p.y + s * 1.9);
        ctx.moveTo(p.x + s * 1.9, p.y - s * 1.9); ctx.lineTo(p.x - s * 1.9, p.y + s * 1.9);
        ctx.stroke();
        ctx.fillStyle = `hsla(${p.hue},95%,90%,0.90)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.35, 0, Math.PI * 2); ctx.fill();
      } else {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.8);
        g.addColorStop(0,   `hsla(${p.hue},88%,82%,1)`);
        g.addColorStop(0.5, `hsla(${p.hue},78%,62%,0.4)`);
        g.addColorStop(1,   `hsla(${p.hue},68%,46%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    },

    update(p, W, H) {
      p.life++;
      if (p.sw !== undefined) { p.sw += p.swSpd; p.x += p.vx + Math.sin(p.sw) * p.swAmp; } else { p.x += p.vx; }
      p.y += p.vy;
      const fi = Math.min(1, p.life / p.fadeIn);
      const fo = (p.maxLife && p.life > p.maxLife - 22) ? Math.max(0, (p.maxLife - p.life) / 22) : 1;
      p.alpha = p.maxAlpha * fi * fo;
      if (p.type === 'ether') return p.y > -p.r * 4 && p.life < p.maxLife;
      return p.life < p.maxLife;
    },
  },

  };

  function _resize() {
    if (!_canvas) return;
    _canvas.width = window.innerWidth; _canvas.height = window.innerHeight;
    // Re-initialise per-theme static data (branches, kelp, stars) on resize
    const cfg = CFG[_theme];
    if (cfg && cfg.init) cfg.init(_canvas.width, _canvas.height);
  }

  function _tick(timestamp) {
    if (!_canvas || !_ctx || !_active) return;
    // 30fps throttle — skip frame if not enough time has passed
    if (timestamp - _lastTickTime < TICK_INTERVAL_MS) {
      _animId = requestAnimationFrame(_tick);
      return;
    }
    _lastTickTime = timestamp;
    const W = _canvas.width, H = _canvas.height;
    _ctx.clearRect(0, 0, W, H);
    const cfg = CFG[_theme];
    if (!cfg || _paused) { _animId = requestAnimationFrame(_tick); return; }
    _frame++;
    // Draw the static/animated background layer first (branches, kelp, stars, nebula…)
    if (cfg.drawBackground) cfg.drawBackground(_ctx, W, H);
    // Spawn and update particles
    if (_particles.length < cfg.max && Math.random() < cfg.rate)
      _particles.push(cfg.create(W, H));
    _particles = _particles.filter(p => {
      const alive = cfg.update(p, W, H);
      if (alive) cfg.draw(_ctx, p);
      return alive;
    });
    _animId = requestAnimationFrame(_tick);
  }

  function init() {
    _canvas = document.createElement('canvas');
    _canvas.id = 'theme-canvas';
    document.body.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);
  }

  function setTheme(t) {
    _theme = t || 'galaxy'; _particles = []; _frame = 0;
    // Initialise per-theme static data now that canvas has real dimensions
    const cfg = CFG[_theme];
    if (cfg && cfg.init && _canvas) cfg.init(_canvas.width, _canvas.height);
    if (!_active) { _active = true; _animId = requestAnimationFrame(_tick); }
  }

  function setPaused(p) { _paused = !!p; }

  function setEnabled(on) {
    if (!on) {
      _active = false;
      if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
      if (_canvas && _ctx) _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    } else if (!_active) {
      _active = true; _animId = requestAnimationFrame(_tick);
    }
  }

  // Expose ocean CFG so bubble-click handler in main() can reach it
  function _afterInit() {
    window._ThemeOceanCFG = CFG.ocean;
  }

  return { init: () => { init(); _afterInit(); }, setTheme, setPaused, setEnabled };
})();


(function main() {
  const world     = document.getElementById('world');
  const statusBar = document.getElementById('status-bar');

  // 0. Settings — load persisted preferences (synchronous from localStorage)
  Settings.init();

  // 1. Audio context — register gesture listeners so AudioContext can resume
  Sounds.init();
  // Soundscape drone — passes saved enabled state so drone respects user preference from startup
  Soundscape.init(Settings.get('droneEnabled'));

  // Apply saved mute preset before any sounds play
  Sounds.setMutePreset(Settings.get('mutePreset'));
  // Apply saved master volume
  Sounds.setVolume(Settings.get('volume'));

  // 2. Session — load localStorage history
  Session.init();

  // 3. Timer — set up default 25-min session (not started yet)
  Timer.init(25);

  // 4. Companion DOM
  Companion.create(world);

  // 5. Sprite animation engine
  SpriteAnimator.init(Companion.getElement());

  // 6. Particle effects
  Particles.init(world);

  // 7. Status UI
  Status.init(statusBar);

  // 8. Face tracking (async, non-blocking — app works without camera)
  Camera.init()
    .then(() => Perception.init())
    .catch((err) => {
      console.warn('[Renderer] Camera init failed:', err);
      Perception.init();
    });

  // 9. Brain loop
  Brain.start();

  // Apply saved sensitivity and phone-detection from Settings
  Brain.setSensitivity(Settings.get('sensitivity'));
  if (Brain.setPhoneDetectionEnabled) Brain.setPhoneDetectionEnabled(Settings.get('phoneDetection'));
  if (Brain.setIdleSpeed)      Brain.setIdleSpeed(Settings.get('idleSpeed') || 5);
  if (Brain.setExpressiveness) Brain.setExpressiveness(Settings.get('expressiveness') || 5);
  if (Brain.setPettingMode)    Brain.setPettingMode(Settings.get('pettingMode') || 5);
  // New personality dimensions
  if (Brain.setTalkative)       Brain.setTalkative(Settings.get('talkative')       || 5);
  if (Brain.setAffectionLevel)  Brain.setAffectionLevel(Settings.get('affectionLevel') || 5);
  if (Brain.setJealousyLevel)   Brain.setJealousyLevel(Settings.get('jealousyLevel')   || 3);

  // 9b. Personality Studio — init after Brain is running
  if (typeof PersonalityEditor !== 'undefined') PersonalityEditor.init();

  // Wire new personality settings → Brain live updates
  Settings.onChange('talkative',      v => Brain.setTalkative      && Brain.setTalkative(v));
  Settings.onChange('affectionLevel', v => Brain.setAffectionLevel && Brain.setAffectionLevel(v));
  Settings.onChange('jealousyLevel',  v => Brain.setJealousyLevel  && Brain.setJealousyLevel(v));
  Settings.onChange('phoneScolding',  v => Brain.setPhoneDetectionEnabled && Brain.setPhoneDetectionEnabled(v));
  Settings.onChange('sensitivity',    v => Brain.setSensitivity(v));
  Settings.onChange('voicePitch',     v => { if (typeof Sounds !== 'undefined' && Sounds.setPitchMult) Sounds.setPitchMult(0.5 + (v-1)/9*1.5); });

  // Apply saved blink rate
  if (Companion.setBlinkRate) Companion.setBlinkRate(Settings.get('blinkRate') || 'normal');

  // 10. Break reminder — init with saved interval (0 = disabled)
  BreakReminder.init(Settings.get('breakInterval'));

  // 11. DND module — init click-to-cancel on the indicator
  DND.init();

    // ── Wave reaction toggle ────────────────────────────────────────────────
    const waveToggle = document.getElementById('wave-reaction-toggle');
    if (waveToggle) {
      waveToggle.checked = Settings.get('waveReaction') !== false;
      waveToggle.addEventListener('change', () => {
        Settings.set('waveReaction', waveToggle.checked);
      });
      Settings.onChange('waveReaction', v => { if (waveToggle) waveToggle.checked = !!v; });
    }

  // The companion starts in full-screen mode on launch.
  // The user can switch to compact PiP overlay via the collapse button.
  document.body.classList.add('full-mode');

  // Apply saved companion size and brightness before wiring UI
  {
    // FIX: companionSize is a numeric value (50-200) after migration from old S/M/L.
    // Set --companion-scale on :root so it's universally accessible in the CSS cascade.
    const csz0 = Settings.get('companionSize') ?? 100;
    const scale0 = (Number(csz0) || 100) / 100;
    document.documentElement.style.setProperty('--companion-scale', String(scale0));
    // Legacy class cleanup — only add if value is exactly a string preset
    const sizeLegacy = (typeof csz0 === 'string' && /^[SML]$/.test(csz0)) ? csz0 : null;
    if (sizeLegacy) document.body.classList.add(`companion-size-${sizeLegacy}`);

    // Brightness: apply to <html> so the body background (full-mode themes) is
    // also dimmed — not just #world content.
    const brightness = Settings.get('brightness') || 1.0;
    document.documentElement.style.filter = brightness < 1.0 ? `brightness(${brightness})` : '';

    // Apply saved appearance classes at boot (before first paint)
    const theme = Settings.get('fullTheme') || 'galaxy';
    document.body.classList.add(`theme-${theme}`);

    const eyeColor = Settings.get('eyeColor') || 'periwinkle';
    if (eyeColor !== 'periwinkle') document.body.classList.add(`eye-${eyeColor}`);

    // Eye glow colour — independent from iris
    const eyeGlowColor = Settings.get('eyeGlowColor') || 'default';
    document.body.classList.add(`eye-glow-${eyeGlowColor}`);

    const noseStyle = Settings.get('noseStyle') || 'triangle';
    if (noseStyle !== 'triangle') document.body.classList.add(`nose-${noseStyle}`);

    const mouthStyle = Settings.get('mouthStyle') || 'arc';
    if (mouthStyle !== 'arc') document.body.classList.add(`mouth-${mouthStyle}`);

    const mouthThickness = Settings.get('mouthThickness') || 'normal';
    if (mouthThickness !== 'normal') document.body.classList.add(`mouth-${mouthThickness}`);

    // companionPos removed — horizontal eye placement feature removed

    const eyeRoundness = Settings.get('eyeRoundness') || 'round';
    if (eyeRoundness !== 'round') document.body.classList.add(`eye-roundness-${eyeRoundness}`);

    // Legacy pupilSize class (migration keeps working until settings panel re-saves)
    const legacyPupilSize = Settings.get('pupilSize');
    if (legacyPupilSize && legacyPupilSize !== 'normal')
      document.body.classList.add(`pupil-${legacyPupilSize}`);

    const glowIntensity = Settings.get('glowIntensity') || 'normal';
    if (glowIntensity !== 'normal') document.body.classList.add(`glow-${glowIntensity}`);

    if (!Settings.get('showEyebrows')) document.body.classList.add('hide-eyebrows');
    if (Settings.get('showWhiskers') === false) document.body.classList.add('hide-whiskers');

    // ── Apply numeric CSS vars at boot ───────────────────────────────────
    // NOTE: --companion-scale is already set on :root above; also set on #world
    // as belt-and-suspenders in case an Electron version doesn't cascade it.
    const _worldEl = document.getElementById('world');
    if (_worldEl) {
      const csz = Settings.get('companionSize') ?? 100;
      const cszScale = String((Number(csz) || 100) / 100);
      document.documentElement.style.setProperty('--companion-scale', cszScale);
      _worldEl.style.setProperty('--companion-scale', cszScale);
    }
    const _esz = Settings.get('eyeSize') ?? 100;
    document.body.style.setProperty('--eye-wrap-scale', String(_esz / 100));
    const _eyesEl = document.querySelector('.eyes');
    if (_eyesEl) {
      const _gap = Settings.get('eyeGap') ?? 6;
      _eyesEl.style.setProperty('--eyes-gap', `${_gap}vmin`);
    }
    document.body.style.setProperty('--iris-scale',  String((Settings.get('irisSize')  ?? 100) / 100));
    document.body.style.setProperty('--iris-border-enabled', Settings.get('irisBorderEnabled') === false ? '0' : '1');
    document.body.style.setProperty('--iris-border-thickness-scale', String((Settings.get('irisBorderThickness') ?? 100) / 100));
    document.body.style.setProperty('--mouth-scale', String((Settings.get('mouthSize') ?? 100) / 100));
    document.body.style.setProperty('--nose-scale',  String((Settings.get('noseSize')  ?? 100) / 100));

    // Apply saved custom iris/glow colours and emotion sync state at boot
    if (typeof IrisColor !== 'undefined') {
      const savedIrisProfile = {
        baseHex: Settings.get('customIrisHex') || '',
        centerHex: Settings.get('customIrisCenterHex') || '',
        midHex: Settings.get('customIrisMidHex') || '',
        edgeHex: Settings.get('customIrisEdgeHex') || '',
        ringHex: Settings.get('customIrisRingHex') || '',
        highlightHex: Settings.get('customIrisHighlightHex') || '',
        pupilCoreHex: Settings.get('customIrisPupilCoreHex') || '',
      };
      if (Object.values(savedIrisProfile).some(Boolean)) {
        IrisColor.applyIrisProfile(savedIrisProfile);
      }
      const savedGlowHex = Settings.get('customGlowHex') || '';
      if (savedGlowHex) IrisColor.applyGlow(savedGlowHex);
      IrisColor.setEmotionSync(Settings.get('glowEmotionSync') !== false);
    }

    const pipOpacity = Settings.get('pipOpacity') != null ? Settings.get('pipOpacity') : 78;
    const worldEl = document.getElementById('world');
    if (worldEl) worldEl.style.setProperty('--pip-bg-opacity', (pipOpacity / 100).toFixed(2));

    // Initialise canvas-based theme particle system
    ThemeCanvas.init();
    ThemeCanvas.setTheme(theme);
    ThemeCanvas.setEnabled(Settings.get('themeParticles') !== false);

    // Pre-fill HH:MM:SS fields with saved default (sessionLength is in minutes)
    _setDurationSeconds((Settings.get('sessionLength') || 25) * 60);
    // Pre-fill session panel break interval from saved settings
    const breakSel = document.getElementById('session-break-select');
    if (breakSel) {
      const saved = Settings.get('breakInterval');
      breakSel.value = String(saved !== undefined ? saved : 25);
    }
  }

  // 12. Wire cross-module communication
  _wireUI();
  _wireTimerToSounds();
  _wireTimerToCompanion();
  _wireBrainToSounds();
  _wireSessionToUI();
  _wireWindowControls();
  _wireKeybinds();
  _wireSettings();
  _wireBreakReminder();
  _wireDND();
  _wireSidebar();
  _wireHistorySidebar();

  // 13. Enhancements — new features (quick presets, quotes, streak, ambient, mood, pulse)
  if (typeof Enhancements !== 'undefined') Enhancements.init();

  // 14. Weekly report check — shows modal once per week if there are sessions
  setTimeout(() => {
    _checkWeeklyReport();
  }, 2000);

  // 12. Sync main-process window state with the initial full-mode.
  // Without this, createWindow()'s alwaysOnTop=false is fine but the
  // main process doesn't know we're in full-mode until the user first
  // manually toggles.  Sending enterFullMode() now ensures alwaysOnTop
  // stays false in full mode and the initial skipTaskbar=false is set.
  if (window.electronAPI) window.electronAPI.enterFullMode();

  // ── Duration HH:MM:SS helpers ─────────────────────────────────────────────
  // Read/write the three HH:MM:SS number fields as a single total-seconds value.

  function _getDurationSeconds() {
    const h = parseInt(document.getElementById('duration-h')?.value, 10) || 0;
    const m = parseInt(document.getElementById('duration-m')?.value, 10) || 0;
    const s = parseInt(document.getElementById('duration-s')?.value, 10) || 0;
    return h * 3600 + m * 60 + s;
  }

  function _setDurationSeconds(totalSecs) {
    totalSecs = Math.max(0, Math.min(86399, Math.round(totalSecs)));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const hEl = document.getElementById('duration-h');
    const mEl = document.getElementById('duration-m');
    const sEl = document.getElementById('duration-s');
    if (hEl) hEl.value = String(h);
    if (mEl) mEl.value = String(m);
    if (sEl) sEl.value = String(s);
  }

  // ── _wireUI ───────────────────────────────────────────────────────────────
  // Button handlers, sensitivity selector, goal overlay.
  // All handlers guard against acting in wrong session state.

  function _wireUI() {
    // Start session button
    const startBtn = document.getElementById('start-session');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const stats = Session.getCurrentStats();
        if (stats && stats.state !== 'IDLE') return;
        const goalEl = document.getElementById('goal-input');
        const goal   = goalEl?.value?.trim() || null;
        const mins   = _getDurationMinutes();

        // Sync break interval from session panel
        BreakReminder.setInterval(_getBreakMinutes());

        Timer.init(mins);
        // Read currently selected category pill
        const activeCatPill = document.querySelector('.sp-cat-pill.active');
        const category = activeCatPill ? activeCatPill.dataset.cat : (Settings.get('sessionCategory') || 'study');
        Settings.set('sessionCategory', category);
        Session.startNew(mins, goal, category);
        Timer.start();
        const overlay = document.getElementById('goal-overlay');
        if (overlay) overlay.style.display = 'none';
      });
    }

    _wireSteppers();

    // Pause / break button
    const pauseBtn = document.getElementById('pause-session');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        if (Session.getCurrentStats()?.state !== 'ACTIVE') return;
        Session.pause();
        Timer.pause();
      });
    }

    // Resume button
    const resumeBtn = document.getElementById('resume-session');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        if (Session.getCurrentStats()?.state !== 'PAUSED') return;
        Session.resume();
        Timer.resume();
      });
    }

    // Abandon button (active state)
    const abandonBtn = document.getElementById('abandon-session');
    if (abandonBtn) {
      abandonBtn.addEventListener('click', () => {
        const s = Session.getCurrentStats()?.state;
        if (s !== 'ACTIVE' && s !== 'PAUSED') return;
        Session.abandon();
        Timer.reset();
      });
    }

    // Abandon button (break/paused state — separate DOM button)
    const abandonBreakBtn = document.getElementById('abandon-session-break');
    if (abandonBreakBtn) {
      abandonBreakBtn.addEventListener('click', () => {
        if (Session.getCurrentStats()?.state !== 'PAUSED') return;
        Session.abandon();
        Timer.reset();
      });
    }

    // "New session" button on the outcome screen (FAILED / ABANDONED) → reset back to IDLE
    const newSessionBtn = document.getElementById('new-session-btn');
    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', () => {
        Session.reset();
        Timer.reset();
        // Clear goal input for fresh start
        const goalEl = document.getElementById('goal-input');
        if (goalEl) goalEl.value = '';
      });
    }

    // Goal achieved buttons (outcome screen)
    const goalYes = document.getElementById('goal-achieved-yes');
    const goalNo  = document.getElementById('goal-achieved-no');
    if (goalYes) goalYes.addEventListener('click', () => Session.setGoalAchieved(true));
    if (goalNo)  goalNo.addEventListener('click',  () => Session.setGoalAchieved(false));

    // Sensitivity selector (legacy — kept for any external HTML using it)
    const sensitivitySel = document.getElementById('sensitivity-select');
    if (sensitivitySel) {
      sensitivitySel.value = localStorage.getItem('deskbuddy_sensitivity') || 'NORMAL';
      sensitivitySel.addEventListener('change', (e) => Brain.setSensitivity(e.target.value));
    }

    // ── Category pills ─────────────────────────────────────────────────────
    // Wire activity category buttons, pre-select saved category, and update daily goal arc.
    const catPillsContainer = document.getElementById('sp-category-pills');
    if (catPillsContainer) {
      const savedCat = Settings.get('sessionCategory') || 'study';
      catPillsContainer.querySelectorAll('.sp-cat-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.cat === savedCat);
        pill.addEventListener('click', () => {
          catPillsContainer.querySelectorAll('.sp-cat-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          Settings.set('sessionCategory', pill.dataset.cat);
        });
      });
    }

    // ── Daily goal arc — initial render ───────────────────────────────────
    _updateDailyGoalArc();

    // ── Quick-preset duration pills (mouseenter on session icon triggers panel open)
    // Re-render the daily goal whenever the panel becomes visible (via mouseover)
    const spIcon = document.getElementById('sp-icon');
    if (spIcon) spIcon.addEventListener('mouseenter', () => _updateDailyGoalArc());
  }

  // ── Stepper helpers ───────────────────────────────────────────────────────
  // Convert the stepper number + unit-select into fractional minutes consumed
  // by Timer.init() and BreakReminder.setInterval().

  function _getDurationMinutes() {
    const totalSecs = _getDurationSeconds();
    return Math.max(1 / 60, totalSecs / 60);
  }

  function _getBreakMinutes() {
    const h = parseInt(document.getElementById('break-h')?.value, 10) || 0;
    const m = parseInt(document.getElementById('break-m')?.value, 10) || 0;
    const s = parseInt(document.getElementById('break-s')?.value, 10) || 0;
    const totalSecs = h * 3600 + m * 60 + s;
    if (totalSecs <= 0) return 0;
    return totalSecs / 60;
  }

  function _setBreakSeconds(totalSecs) {
    totalSecs = Math.max(0, Math.min(86399, Math.round(totalSecs)));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const hEl = document.getElementById('break-h');
    const mEl = document.getElementById('break-m');
    const sEl = document.getElementById('break-s');
    if (hEl) hEl.value = String(h);
    if (mEl) mEl.value = String(m);
    if (sEl) sEl.value = String(s);
  }

  function _getBreakSeconds() {
    const h = parseInt(document.getElementById('break-h')?.value, 10) || 0;
    const m = parseInt(document.getElementById('break-m')?.value, 10) || 0;
    const s = parseInt(document.getElementById('break-s')?.value, 10) || 0;
    return h * 3600 + m * 60 + s;
  }

  // ── _wireSteppers ─────────────────────────────────────────────────────────
  // Wire +/− buttons and unit-select changes for all sp-stepper inputs.
  // Unit change converts the current value to the new unit (rounded to step).

  function _wireSteppers() {
    // ── HH:MM:SS duration +/− buttons ────────────────────────────────────
    function _clampHmsFields(hId, mId, sId) {
      const hEl = document.getElementById(hId);
      const mEl = document.getElementById(mId);
      const sEl = document.getElementById(sId);
      if (hEl) hEl.value = String(Math.max(0, Math.min(23, parseInt(hEl.value, 10) || 0)));
      if (mEl) mEl.value = String(Math.max(0, Math.min(59, parseInt(mEl.value, 10) || 0)));
      if (sEl) sEl.value = String(Math.max(0, Math.min(59, parseInt(sEl.value, 10) || 0)));
    }

    // Clamp individual fields on manual edit
    ['duration-h', 'duration-m', 'duration-s'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => _clampHmsFields('duration-h', 'duration-m', 'duration-s'));
    });
    ['break-h', 'break-m', 'break-s'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => _clampHmsFields('break-h', 'break-m', 'break-s'));
    });

    const decBtn = document.getElementById('duration-dec');
    const incBtn = document.getElementById('duration-inc');

    if (decBtn) {
      decBtn.addEventListener('click', () => {
        const stepSecs = (Settings.get('timerStep') || 5) * 60;
        const cur  = _getDurationSeconds();
        const next = Math.max(0, cur - stepSecs);
        _setDurationSeconds(next);
      });
    }

    if (incBtn) {
      incBtn.addEventListener('click', () => {
        const stepSecs = (Settings.get('timerStep') || 5) * 60;
        const cur  = _getDurationSeconds();
        const next = Math.min(86399, cur + stepSecs);
        _setDurationSeconds(next);
      });
    }

    const breakDecBtn = document.getElementById('break-dec');
    const breakIncBtn = document.getElementById('break-inc');
    const BREAK_STEP_SECS = 5 * 60; // 5 min default step for break

    if (breakDecBtn) {
      breakDecBtn.addEventListener('click', () => {
        const cur  = _getBreakSeconds();
        const next = Math.max(0, cur - BREAK_STEP_SECS);
        _setBreakSeconds(next);
      });
    }

    if (breakIncBtn) {
      breakIncBtn.addEventListener('click', () => {
        const cur  = _getBreakSeconds();
        const next = Math.min(86399, cur + BREAK_STEP_SECS);
        _setBreakSeconds(next);
      });
    }
  }

  // ── _wireTimerToSounds ────────────────────────────────────────────────────
  // Tick sounds (one per logical timer-second) + notable state transitions.

  function _wireTimerToSounds() {
    Timer.onTick(() => {
      const state = Timer.getState();
      // CRITICAL ticks much less often (0.08× speed) — same sound but rare is intentional
      const tickMap = {
        FOCUSED:    'focused_tick',
        DRIFTING:   'drifting_tick',
        DISTRACTED: 'distracted_tick',
        CRITICAL:   'distracted_tick',
        FAILED:     null,
      };
      const sound = tickMap[state];
      if (sound) Sounds.play(sound);
    });

    Timer.onStateChange((newState, oldState) => {
      // session_start / session_complete / session_fail / break_start / break_end
      // are fired by session.js internally so we don't duplicate them here.
      // Only timer-level transition sounds belong here.
      if (newState === 'FOCUSED' && oldState !== 'FOCUSED') {
        // refocus is also fired by session.js for DISTRACTED/CRITICAL→FOCUSED;
        // session.js guards against playing it twice via its state machine.
        // No-op here to avoid double-play.
      }
    });
  }

  // ── _wireTimerToCompanion ─────────────────────────────────────────────────
  // Expose timer state on <body> so CSS and brain.js can react to it.
  // Emotion selection for DRIFTING/DISTRACTED/CRITICAL is handled inside
  // brain.js applyFocusEmotion() — setting it here too causes a race where
  // the rAF emotion loop immediately overrides whatever we set.
  // FAILED emotion is handled in _wireSessionToUI via the session outcome.

  function _wireTimerToCompanion() {
    Timer.onStateChange((newState) => {
      document.body.dataset.timerState = newState;
    });
  }

  // ── _wireBrainToSounds ────────────────────────────────────────────────────
  // Brain callbacks → audio responses.

  function _wireBrainToSounds() {
    Brain.onPhoneDetected(() => {
      // suspicious_squint is already played inside brain.js; this hook is for
      // any additional renderer-level side-effects (UI flash, logging, etc.).
      // Playing here would double-play — intentionally a no-op.
    });

    Brain.onMilestone((mins) => {
      // overjoyed_chirp is played inside brain.js _fireMilestone.
      // Renderer hook available for UI milestone badges etc.
      const badge = document.getElementById('milestone-badge');
      if (badge) {
        badge.textContent = `${mins} min ✦`;
        badge.classList.add('visible');
        setTimeout(() => badge.classList.remove('visible'), 3000);
      }
    });
  }

  // ── _wireSessionToUI ──────────────────────────────────────────────────────
  // Session state changes → DOM visibility / content updates.

  /** Format seconds as H:MM:SS (hours omitted when 0). */
  function _fmtSecs(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  let _breakCountdownInterval = null;
  let _sessionTotalSeconds    = 0;   // set on ACTIVE; used for progress ring
  let _dailyGoalLastTick      = 0;   // throttle daily goal arc updates during sessions
  let _budgetWarnedAt         = -1;  // distraction count at which we last warned

  // ── Live focus heatmap — 90 per-second coloured blocks ────────────────────
  const HEATMAP_MAX_BLOCKS = 90;
  const _heatmapData       = [];
  let   _heatmapInterval   = null;
  let   _heatmapNodes      = [];   // pre-allocated block divs — no DOM churn each tick

  function _heatmapBuild(strip) {
    strip.innerHTML = '';
    _heatmapNodes = [];
    for (let i = 0; i < HEATMAP_MAX_BLOCKS; i++) {
      const b = document.createElement('div');
      b.className = 'fh-block fh-empty';
      strip.appendChild(b);
      _heatmapNodes.push(b);
    }
  }

  function _heatmapPush() {
    const state = (typeof Timer !== 'undefined' && Timer.getState?.()) || 'FOCUSED';
    _heatmapData.push(state.toLowerCase());
    if (_heatmapData.length > HEATMAP_MAX_BLOCKS) _heatmapData.shift();
    _heatmapRender();
  }

  function _heatmapRender() {
    const strip = document.getElementById('focus-heatmap-strip');
    if (!strip) return;
    // Lazily build nodes if not yet done (e.g. panel just opened)
    if (_heatmapNodes.length !== HEATMAP_MAX_BLOCKS || !strip.contains(_heatmapNodes[0])) {
      _heatmapBuild(strip);
    }
    const empties = HEATMAP_MAX_BLOCKS - _heatmapData.length;
    for (let i = 0; i < HEATMAP_MAX_BLOCKS; i++) {
      const node = _heatmapNodes[i];
      if (i < empties) {
        node.className = 'fh-block fh-empty';
      } else {
        node.className = 'fh-block fh-' + _heatmapData[i - empties];
      }
    }
  }

  function _heatmapStart() {
    _heatmapData.length = 0;
    _heatmapNodes = [];   // force rebuild of pre-allocated nodes on next render
    if (_heatmapInterval) clearInterval(_heatmapInterval);
    _heatmapInterval = setInterval(_heatmapPush, 1000);
    _heatmapRender();
  }

  function _heatmapStop() {
    if (_heatmapInterval) { clearInterval(_heatmapInterval); _heatmapInterval = null; }
  }
  // ─────────────────────────────────────────────────────────────────────────

  function _wireSessionToUI() {
    Session.onSessionStateChange((newState, oldState) => {
      const stats = Session.getCurrentStats();

      // Panel visibility (sidebar panels)
      _setVisible('session-idle',    newState === 'IDLE');
      _setVisible('session-active',  newState === 'ACTIVE');
      _setVisible('session-paused',  newState === 'PAUSED');

      // Outcome popup — shown only for FAILED / ABANDONED.
      // COMPLETED uses the share-card modal instead (see below).
      const outcomeEl = document.getElementById('outcome-screen');
      if (outcomeEl) {
        const isOutcome = newState === 'FAILED' || newState === 'ABANDONED';
        outcomeEl.classList.toggle('outcome-visible', isOutcome);
        outcomeEl.setAttribute('aria-hidden', String(!isOutcome));
      }

      // Session countdown timer — show during active/paused, hide otherwise
      const sessionTimerEl = document.getElementById('session-timer');
      if (sessionTimerEl) {
        sessionTimerEl.style.display =
          (newState === 'ACTIVE' || newState === 'PAUSED') ? '' : 'none';
      }

      // ── On session start: snapshot total duration for progress ring ──
      if (newState === 'ACTIVE') {
        _sessionTotalSeconds = _getDurationMinutes() * 60;
        // Reset ring to full
        const ring = document.getElementById('sp-ring-progress');
        if (ring) ring.style.strokeDashoffset = '0';
        const inlineTimer = document.getElementById('sp-inline-timer');
        if (inlineTimer) {
          inlineTimer.textContent = _fmtSecs(_sessionTotalSeconds);
        }
        // Reset focus stat bar on fresh start
        if (oldState === 'IDLE') {
          const fill  = document.getElementById('sp-focus-stat-fill');
          const pctEl = document.getElementById('sp-focus-stat-pct');
          if (fill)  fill.style.width = '0%';
          if (pctEl) pctEl.textContent = '–';
        }

        // Start live focus heatmap on fresh session start
        if (oldState === 'IDLE') _heatmapStart();

        // Immediate companion reaction — only on a fresh start (not resume from pause)
        if (oldState === 'IDLE') _fireSessionStartAnim();

        // Reset phone escalation counter so first detection this session is always "first"
        if (oldState === 'IDLE') {
          if (typeof Brain !== 'undefined' && Brain.resetPhoneCount) Brain.resetPhoneCount();
        }

        // Initialize distraction budget display
        if (oldState === 'IDLE') {
          const budget = Settings.get('distractionBudget') || 0;
          _renderBudgetDots(0, budget);
        }
      }

      // Break countdown — start/stop the live update interval
      if (newState === 'PAUSED') {
        _startBreakCountdown();
        if (Settings.get('breakAnimEnabled')) {
          // Teal glow sweeps up from the bottom
          const glow = document.getElementById('break-glow');
          if (glow) {
            glow.classList.add('active');
            setTimeout(() => glow.classList.remove('active'), 3500);
          }
          // Context-aware break card overlay + companion emotion
          _fireBreakCard(stats);
        }
        // Auto-open panel so user sees the break countdown (skip if DND active)
        if (typeof DND === 'undefined' || !DND.isActive()) _panelOpen();
      } else if (newState === 'ACTIVE' && oldState === 'PAUSED') {
        _stopBreakCountdown();
        _fireBreakEndAnim();
      } else {
        _stopBreakCountdown();
      }

      // Goal display in active panel
      const goalDisplay = document.getElementById('goal-display');
      if (goalDisplay) {
        const txt = stats?.goalText || '';
        goalDisplay.textContent = txt;
        goalDisplay.style.display = (newState === 'ACTIVE' && txt) ? '' : 'none';
      }

      // Goal achievement prompt on outcome screen (FAILED and ABANDONED — goal still relevant)
      const goalPrompt = document.getElementById('goal-prompt');
      if (goalPrompt) {
        const hasGoal = !!(stats?.goalText || Session.getHistory()[0]?.goalText);
        const isEnd   = newState === 'FAILED' || newState === 'ABANDONED';
        goalPrompt.style.display = (isEnd && hasGoal) ? '' : 'none';
      }

      // Outcome label + effects
      const outcomeLabel = document.getElementById('outcome-label');
      if (outcomeLabel) {
        if      (newState === 'COMPLETED')  outcomeLabel.textContent = '✦ session complete!';
        // Both FAILED and ABANDONED share the same user-facing message intentionally —
        // the distinction (distraction vs. manual exit) is captured in session history.
        else if (newState === 'FAILED')     outcomeLabel.textContent = 'session ended early.';
        else if (newState === 'ABANDONED')  outcomeLabel.textContent = 'session ended early.';
        else                                outcomeLabel.textContent = '';
      }

      if (newState === 'COMPLETED') {
        // Capture session data + emotion snapshot before reset
        const lastSession = Session.getHistory()[0];
        const emotion     = (typeof Emotion !== 'undefined' && Emotion.getState?.()) || 'happy';

        // Confetti celebration
        setTimeout(() => _fireCelebration('complete'), 400);

        // Auto-reset to IDLE so the session panel is immediately ready for a new session
        setTimeout(() => {
          Session.reset();
          Timer.reset();
        }, 50);

        // Show share card modal after the companion's celebration animation has room to play.
        // If in PiP mode, defer until the user returns to full-screen so the modal
        // doesn't cover the PiP window and block the expand button.
        setTimeout(() => {
          if (typeof ShareCard !== 'undefined' && lastSession) {
            if (_isFullMode) {
              ShareCard.show(lastSession, emotion);
            } else {
              _pendingShareCard = { sessionData: lastSession, emotion };
            }
          }
        }, 1800);
      }

      if (newState === 'FAILED' || newState === 'ABANDONED') {
        // Companion shows sad/crying for both failed and abandoned sessions
        Emotion.setState('crying');
        // session.js plays no sound for ABANDONED — renderer fills the gap here.
        if (newState === 'ABANDONED' && typeof Sounds !== 'undefined') Sounds.play('session_fail');
      }

      // After any session end, refresh the daily goal arc and hide budget display
      if (newState === 'COMPLETED' || newState === 'FAILED' || newState === 'ABANDONED') {
        setTimeout(() => _updateDailyGoalArc(), 200);
        const budgetRow = document.getElementById('sp-budget-row');
        if (budgetRow) budgetRow.style.display = 'none';
        _heatmapStop();
      }

      // Reset timer state body attribute when session ends
      if (newState === 'IDLE' || newState === 'FAILED' || newState === 'ABANDONED') {
        delete document.body.dataset.timerState;
      }
    });

    // ── Inline panel timer + progress ring (updated each logical timer-second) ──
    Timer.onTick(() => {
      const remaining = Timer.getRemainingSeconds();
      const inlineTimer = document.getElementById('sp-inline-timer');
      if (inlineTimer) inlineTimer.textContent = _fmtSecs(remaining);

      const ring = document.getElementById('sp-ring-progress');
      if (ring && _sessionTotalSeconds > 0) {
        const CIRC    = 138.23; // 2π × r=22
        const elapsed = _sessionTotalSeconds - remaining;
        ring.style.strokeDashoffset = String(CIRC * (elapsed / _sessionTotalSeconds));
      }

      // Live focus stat bar
      const stats = Session.getCurrentStats ? Session.getCurrentStats() : null;
      if (stats && stats.elapsed > 0) {
        const pct = Math.round((stats.focusedSeconds / stats.elapsed) * 100);
        const fill = document.getElementById('sp-focus-stat-fill');
        const pctEl = document.getElementById('sp-focus-stat-pct');
        if (fill) fill.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
      }

      // Distraction budget live update
      const budget = Settings.get('distractionBudget') || 0;
      if (budget > 0 && stats) {
        _renderBudgetDots(stats.distractionCount || 0, budget);
      }

      // Daily goal arc live update (only every 30s to avoid redraws on every tick)
      if (!_dailyGoalLastTick || Date.now() - _dailyGoalLastTick > 30000) {
        _dailyGoalLastTick = Date.now();
        _updateDailyGoalArc();
      }
    });

    // ── Distraction budget: warn when new distraction crosses the budget threshold ──
    Timer.onStateChange((newState, oldState) => {
      const budget = Settings.get('distractionBudget') || 0;
      if (budget <= 0) return;
      const isDistraction = (newState === 'DISTRACTED' || newState === 'CRITICAL') &&
                            (oldState === 'FOCUSED'    || oldState === 'DRIFTING');
      if (!isDistraction) return;

      // Give session.js a tick to increment the count first, then check
      setTimeout(() => {
        const s = Session.getCurrentStats ? Session.getCurrentStats() : null;
        if (!s) return;
        const used = s.distractionCount || 0;
        _renderBudgetDots(used, budget);
        if (used >= budget && used !== _budgetWarnedAt) {
          _budgetWarnedAt = used;
          _fireBudgetExceeded();
        }
      }, 50);
    });
  }

  // ── Helper: open the panel programmatically (auto-reveal on completion/break) ──
  function _panelOpen() {
    const panel = document.getElementById('session-panel');
    const icon  = document.getElementById('sp-icon');
    if (panel) panel.classList.add('sidebar-open');
    if (icon)  icon.classList.add('sp-icon-hidden');
  }

  // ── Session-start animation — fires immediately when a new session begins ──
  // Gives the companion an instant, rewarding reaction with zero lag.

  function _fireSessionStartAnim() {
    // Companion goes excited immediately — no setTimeout, no lag
    if (typeof Emotion !== 'undefined') Emotion.preview('excited', 2800);

    // Particle burst — spawn multiple excited particles in a rapid staggered burst
    if (typeof Particles !== 'undefined') {
      for (let i = 0; i < 8; i++) {
        setTimeout(() => Particles.spawn('excited'), i * 55);
      }
    }

    // Companion bounce — force-retrigger even if class is already set
    const buddy = typeof Companion !== 'undefined' ? Companion.getElement() : null;
    if (buddy) {
      buddy.classList.remove('session-start-bounce');
      void buddy.offsetWidth; // reflow so animation re-triggers cleanly
      buddy.classList.add('session-start-bounce');
      setTimeout(() => buddy.classList.remove('session-start-bounce'), 900);
    }

    // Gold radial flash across the screen
    const flash = document.getElementById('session-start-flash');
    if (flash) {
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 1200);
    }

    // Time-of-day aware banner text
    const msgEl = document.getElementById('session-start-msg');
    if (msgEl) {
      const period = (typeof Brain !== 'undefined' && Brain.getTimePeriod)
        ? Brain.getTimePeriod() : 'AFTERNOON';
      const MSGS = {
        MORNING:   'good morning ✦ let\'s focus!',
        AFTERNOON: 'let\'s focus! ✦',
        EVENING:   'time to focus ✦',
        NIGHT:     'late-night grind ✦',
      };
      msgEl.textContent = MSGS[period] || 'let\'s go! ✦';
      msgEl.classList.remove('active');
      void msgEl.offsetWidth;
      msgEl.classList.add('active');
      setTimeout(() => msgEl.classList.remove('active'), 2400);
    }
  }


  function _fireCelebration(type) {
    if (!Settings.get('celebrationEnabled')) return;
    const overlay = document.getElementById('celebration-overlay');
    const msg     = document.getElementById('celebration-message');
    const world   = document.getElementById('world');
    if (!overlay) return;

    // Screen flash
    if (world) {
      world.classList.add('session-complete-flash');
      setTimeout(() => world.classList.remove('session-complete-flash'), 1500);
    }

    // ── Confetti falls from above the screen ──────────────────────────────
    // Symbols — mix of glyphs and emoji for a festive feel
    const symbols = ['🎉', '🎊', '✦', '✦', '✧', '★', '·', '◆', '♡', '⬡', '▲', '●'];
    const colors  = [
      'rgba(175, 155, 255, 0.95)',
      'rgba(100, 220, 180, 0.95)',
      'rgba(255, 205, 80,  0.95)',
      'rgba(245, 185, 255, 0.95)',
      'rgba(140, 215, 255, 0.95)',
      'rgba(255, 145, 165, 0.95)',
      'rgba(255, 220, 100, 0.95)',
      'rgba(160, 255, 200, 0.95)',
    ];

    const count = type === 'complete' ? 72 : 36;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-particle';

      // Use rectangles for ~30% of pieces (paper confetti effect)
      const useRect = Math.random() < 0.30;
      if (useRect) {
        const w = 6 + Math.random() * 6;
        const h = 4 + Math.random() * 4;
        const col = colors[Math.floor(Math.random() * colors.length)];
        p.style.width  = `${w}px`;
        p.style.height = `${h}px`;
        p.style.borderRadius = '2px';
        p.style.background   = col;
        p.textContent = '';
      } else {
        p.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        p.style.color    = colors[Math.floor(Math.random() * colors.length)];
        p.style.fontSize = `${11 + Math.random() * 14}px`;
      }

      // Start ABOVE the viewport — top: -5% to -18%
      const x0  = Math.random() * 100;          // spread across full width
      const y0  = -(5 + Math.random() * 13);    // -5% to -18% (above screen)
      // Fall DOWN through the screen (700–1100 px)
      const dy  = 700 + Math.random() * 400;
      // Slight horizontal drift
      const dx  = (Math.random() - 0.5) * 140;
      const rot = (Math.random() - 0.5) * 1080;
      const dur = 2.4 + Math.random() * 2.0;
      const del = Math.random() * 1.4;

      p.style.left = `${x0}%`;
      p.style.top  = `${y0}%`;
      p.style.setProperty('--dx',  `${dx}px`);
      p.style.setProperty('--dy',  `${dy}px`);
      p.style.setProperty('--rot', `${rot}deg`);
      p.style.setProperty('--dur', `${dur}s`);
      p.style.setProperty('--del', `${del}s`);

      overlay.appendChild(p);
      setTimeout(() => p.remove(), (dur + del + 0.6) * 1000);
    }

    // Banner
    if (msg) {
      const titleEl = msg.querySelector('.cel-title');
      const subEl   = msg.querySelector('.cel-sub');
      if (titleEl) titleEl.textContent = '🎉 session complete 🎉';
      if (subEl)   subEl.textContent   = 'great work — you absolutely did it ✦';
      msg.classList.add('active');
    }

    // Companion overjoyed
    Emotion.preview('overjoyed', 5000);
    Sounds.play('overjoyed_chirp');

    // Clean up banner
    setTimeout(() => {
      if (msg) msg.classList.remove('active');
      setTimeout(() => { overlay.innerHTML = ''; }, 700);
    }, 4000);
  }

  // ── Break card — context-aware modal with emoji + message ────────────────

  function _fireBreakCard(stats) {
    const card     = document.getElementById('break-card');
    const emojiEl  = document.getElementById('break-card-emoji');
    const titleEl  = document.getElementById('break-card-title');
    const bodyEl   = document.getElementById('break-card-body');
    const budgetEl = document.getElementById('break-card-budget');
    if (!card) return;

    // ── Context resolution ──────────────────────────────────────────────────
    const period  = (typeof Brain !== 'undefined' && Brain.getTimePeriod) ? Brain.getTimePeriod() : 'AFTERNOON';
    const elapsed = stats ? (stats.elapsed || 0) : 0;           // wall-clock seconds
    const focused = stats ? (stats.focusedSeconds || 0) : 0;    // seconds in focused state
    const focusPct = elapsed > 0 ? (focused / elapsed) : 0;

    // ── Emoji + message selection ────────────────────────────────────────────
    let emoji, title, body;

    // Night — always hydrate + rest
    if (period === 'NIGHT') {
      emoji = '🌙';
      title = 'late-night session ✦';
      body  = 'drink some water and rest your eyes\na little — you deserve it';

    // Morning — energise
    } else if (period === 'MORNING') {
      if (elapsed >= 3600) {
        // More than an hour — push toward breakfast
        emoji = '🥐';
        title = 'time for a real break';
        body  = "you've been at it for a while — go\nget breakfast, seriously";
      } else {
        emoji = '☕';
        title = 'coffee time ✦';
        body  = "grab a coffee and stretch —\nyou're crushing the morning";
      }

    // Evening — wind down
    } else if (period === 'EVENING') {
      emoji = '🍵';
      title = 'herbal tea time ✦';
      body  = 'wind down a little — maybe some\nchamomile or green tea?';

    // Afternoon — main working hours
    } else {
      if (focusPct >= 0.82) {
        // Highly focused session — warm reward
        emoji = '🌊';
        title = "you've been in the zone \u2726";
        body  = 'seriously impressive focus — go\nget your favourite drink';
      } else if (elapsed >= 5400) {
        // 90+ minutes — longer break needed
        emoji = '🧘';
        title = 'proper break time';
        body  = 'step away from the screen — stretch,\nwalk, breathe for a bit';
      } else if (elapsed >= 2700) {
        // 45+ minutes
        emoji = '☕';
        title = 'tea or coffee? ✦';
        body  = 'well earned — grab something warm\nand give your eyes a rest';
      } else {
        emoji = '✨';
        title = 'quick breather ✦';
        body  = 'take a moment — look away from\nthe screen and breathe';
      }
    }

    if (emojiEl) emojiEl.textContent = emoji;
    if (titleEl) titleEl.textContent = title;
    if (bodyEl)  bodyEl.textContent  = body;

    // Break elapsed time
    if (budgetEl) {
      const elapsedMs   = Session.getBreakElapsedMs ? Session.getBreakElapsedMs() : 0;
      const elapsedSecs = Math.floor(elapsedMs / 1000);
      const bm = Math.floor(elapsedSecs / 60);
      const bs = String(elapsedSecs % 60).padStart(2, '0');
      budgetEl.textContent = `on break · ${bm}:${bs}`;
    }

    // Companion — enthusiastic, celebratory start to the break
    Emotion.preview('overjoyed', 3000);

    // Show card
    card.setAttribute('aria-hidden', 'false');
    card.classList.add('active');

    // Auto-dismiss after 6 s
    let _bkTimer = setTimeout(() => _dismissBreakCard(), 6000);

    // Dismiss button
    const dismissBtn = document.getElementById('break-card-dismiss');
    function _dismissBreakCard() {
      clearTimeout(_bkTimer);
      card.classList.remove('active');
      card.setAttribute('aria-hidden', 'true');
      // Remove listener to avoid stacking
      if (dismissBtn) dismissBtn.removeEventListener('click', _dismissBreakCard);
    }
    if (dismissBtn) {
      dismissBtn.removeEventListener('click', _dismissBreakCard); // guard
      dismissBtn.addEventListener('click', _dismissBreakCard, { once: true });
    }
  }

  // ── Break-end animation — fired when the user resumes from a break ─────────

  function _fireBreakEndAnim() {
    // Teal flash across the screen
    const flash = document.getElementById('break-end-flash');
    if (flash) {
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 1200);
    }

    // "welcome back ✦" text overlay
    const msg = document.getElementById('break-end-msg');
    if (msg) {
      msg.classList.add('active');
      setTimeout(() => msg.classList.remove('active'), 2600);
    }

    // Companion perks up
    if (typeof Emotion !== 'undefined') Emotion.preview('excited', 2500);
  }

  // ── Break countdown helpers ───────────────────────────────────────────────

  function _startBreakCountdown() {
    _stopBreakCountdown();
    _updateBreakCountdown();
    _breakCountdownInterval = setInterval(_updateBreakCountdown, 1000);
  }

  function _stopBreakCountdown() {
    if (_breakCountdownInterval !== null) {
      clearInterval(_breakCountdownInterval);
      _breakCountdownInterval = null;
    }
  }

  function _updateBreakCountdown() {
    const el = document.getElementById('break-countdown');
    if (!el) return;
    const ms = Session.getBreakElapsedMs();
    const totalSecs = Math.floor(ms / 1000);
    const m = String(Math.floor(totalSecs / 60));
    const s = String(totalSecs % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  function _setVisible(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  }


  // ── Compact window — mode toggle ────────────────────────────────────────
  // The companion starts as a small floating overlay (PiP mode).
  // A toggle button (or Ctrl/Cmd+Shift+P) switches between compact and full.
  // The window is always interactive in PiP mode — no click-through.

  let _isFullMode = true;  // starts in full-screen
  let _autoPipActive   = false; // true when auto-PiP triggered the collapse
  let _autoPipTimer    = null;  // pending delay timer for deferred collapse
  let _autoPipCooldown = false; // true briefly after collapsing — ignore focus events
  let _autoPipCooldownTimer = null;
  let _pendingShareCard = null; // queued when session ends while in PiP mode

  // ── Mode toggle ───────────────────────────────────────────────────────────

  function _enterFullMode() {
    if (_isFullMode) return;
    // Cancel any pending deferred auto-collapse (e.g. user expands before timer fires).
    if (_autoPipTimer) { clearTimeout(_autoPipTimer); _autoPipTimer = null; }
    _autoPipActive = false;
    _isFullMode = true;
    document.body.classList.remove('pip-mode');
    document.body.classList.add('full-mode');
    if (window.electronAPI) window.electronAPI.enterFullMode();
    // Resume canvas particles now that we're in full-screen mode
    if (typeof ThemeCanvas !== 'undefined' && Settings.get('themeParticles') !== false)
      ThemeCanvas.setPaused(false);
    // Show share card that was deferred because the session ended while in PiP mode
    if (_pendingShareCard) {
      const { sessionData, emotion } = _pendingShareCard;
      _pendingShareCard = null;
      setTimeout(() => {
        if (typeof ShareCard !== 'undefined') ShareCard.show(sessionData, emotion);
      }, 400);
    }
  }

  function _exitFullMode() {
    if (!_isFullMode) return;
    _isFullMode = false;

    // ── CRITICAL BUG FIX: close all full-mode overlays before PiP transition ──
    // PersonalityEditor overlay is position:fixed z-index:9200 — it would cover
    // the entire PiP window and make the buddy invisible if left open.
    if (typeof PersonalityEditor !== 'undefined' && PersonalityEditor.close) {
      PersonalityEditor.close();
    }
    // Close settings panel if open
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) settingsPanel.classList.remove('settings-open');
    // Close session sidebar if open
    const sessionPanel = document.getElementById('session-panel');
    if (sessionPanel) sessionPanel.classList.remove('sidebar-open');
    // Close history panel if open
    const historyPanel = document.getElementById('history-panel');
    if (historyPanel) historyPanel.classList.remove('hp-panel-open');
    // Hide break card
    const breakCard = document.getElementById('break-card');
    if (breakCard) { breakCard.classList.remove('active'); breakCard.setAttribute('aria-hidden','true'); }
    // Hide weekly report modal
    const wrModal = document.getElementById('weekly-report-modal');
    if (wrModal) wrModal.setAttribute('aria-hidden', 'true');

    document.body.classList.remove('full-mode');
    document.body.classList.add('pip-mode');
    // Apply the one-shot entrance animation class; remove it after the animation duration.
    document.body.classList.add('pip-entering');
    setTimeout(() => document.body.classList.remove('pip-entering'), 400);
    if (window.electronAPI) window.electronAPI.exitFullMode();
    // Pause canvas particles in PiP (canvas hidden via CSS; pause saves CPU)
    if (typeof ThemeCanvas !== 'undefined') ThemeCanvas.setPaused(true);
  }

  function _exitFullModeManual() {
    // Cancel any pending deferred auto-collapse timer.
    if (_autoPipTimer) { clearTimeout(_autoPipTimer); _autoPipTimer = null; }
    // Clear auto-pip flag so a subsequent focus event doesn't auto-restore.
    _autoPipActive = false;
    _exitFullMode();
  }

  function _wireWindowControls() {
    // Keyboard shortcut registered via Keybinds in _wireKeybinds() below

    // Toggle buttons
    const expandBtn   = document.getElementById('compact-expand-btn');
    const collapseBtn = document.getElementById('full-collapse-btn');
    if (expandBtn)   expandBtn.addEventListener('click', () => _enterFullMode());
    if (collapseBtn) collapseBtn.addEventListener('click', () => _exitFullModeManual());

    // WhatsApp-style PiP hover overlay: click the expand button to restore
    const pipExpandBtn = document.getElementById('pip-expand-btn');
    if (pipExpandBtn) pipExpandBtn.addEventListener('click', () => _enterFullMode());

    // Clicking anywhere on the circular bubble (that isn't an eye / interactive
    // child) also expands back to full mode — same as tapping a WhatsApp call bubble.
    const worldEl = document.getElementById('world');
    if (worldEl) {
      worldEl.addEventListener('click', (e) => {
        if (!document.body.classList.contains('pip-mode')) return;
        // Don't expand if the click hit an interactive child (eye, button, etc.)
        if (e.target !== worldEl) return;
        _enterFullMode();
      });
    }

    // Sync mode state when main reports transitions (covers IPC-initiated toggles).
    if (window.electronAPI) {
      window.electronAPI.onFullModeEntered(() => {
        _isFullMode = true;
        document.body.classList.remove('pip-mode');
        document.body.classList.add('full-mode');
        if (_pendingShareCard) {
          const { sessionData, emotion } = _pendingShareCard;
          _pendingShareCard = null;
          setTimeout(() => {
            if (typeof ShareCard !== 'undefined') ShareCard.show(sessionData, emotion);
          }, 400);
        }
      });
      window.electronAPI.onFullModeExited(() => {
        _isFullMode = false;
        document.body.classList.remove('full-mode');
        document.body.classList.add('pip-mode');
      });

      // Auto-PiP: collapse to compact overlay when the user switches away
      window.electronAPI.onAppBlur(() => {
        if (!_isFullMode || !Settings.get('autoPipOnBlur')) return;

        // Skip collapse when a focus session is active and the user has opted in
        if (Settings.get('autoPipSkipSession') && typeof Session !== 'undefined' &&
            Session.getState && Session.getState() === 'ACTIVE') return;

        function _doCollapse() {
          _autoPipActive = true;
          // Cooldown: ignore focus events for 900 ms after collapsing so the
          // window resize / alwaysOnTop transition can't immediately restore us.
          _autoPipCooldown = true;
          clearTimeout(_autoPipCooldownTimer);
          _autoPipCooldownTimer = setTimeout(() => { _autoPipCooldown = false; }, 900);
          _exitFullMode();
        }

        const delaySec = Settings.get('autoPipDelay') || 0;
        if (delaySec > 0) {
          clearTimeout(_autoPipTimer);
          _autoPipTimer = setTimeout(() => {
            _autoPipTimer = null;
            if (_isFullMode && Settings.get('autoPipOnBlur')) _doCollapse();
          }, delaySec * 1000);
        } else {
          _doCollapse();
        }
      });

      // Auto-PiP: restore full mode when the user comes back (only if we auto-collapsed)
      window.electronAPI.onAppFocus(() => {
        // Cancel a pending delayed collapse if the user returned quickly
        if (_autoPipTimer) {
          clearTimeout(_autoPipTimer);
          _autoPipTimer = null;
        }
        // Ignore focus events during the post-collapse cooldown (prevents the
        // window resize / alwaysOnTop call from immediately restoring full mode).
        if (_autoPipCooldown) return;

        if (_autoPipActive && !_isFullMode && Settings.get('autoPipRestore')) {
          _autoPipActive = false;
          _enterFullMode();
          // Welcome-back reaction: give Brain a nudge so the companion reacts
          setTimeout(() => {
            if (typeof Brain !== 'undefined' && Brain.triggerWelcomeBack) {
              Brain.triggerWelcomeBack();
            }
          }, 350);
        }
      });
    }

    // ── Visibility-change fallback for auto-PiP ──────────────────────────
    // In some Electron builds the IPC 'app-blur' is unreliable; also handles
    // document.hidden changes (e.g. the window being minimised).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && _isFullMode && Settings.get('autoPipOnBlur')) {
        if (Settings.get('autoPipSkipSession') && typeof Session !== 'undefined' &&
            Session.getState && Session.getState() === 'ACTIVE') return;
        _autoPipActive = true;
        _autoPipCooldown = true;
        clearTimeout(_autoPipCooldownTimer);
        _autoPipCooldownTimer = setTimeout(() => { _autoPipCooldown = false; }, 900);
        _exitFullMode();
      } else if (!document.hidden && _autoPipActive && !_isFullMode &&
                 !_autoPipCooldown && Settings.get('autoPipRestore')) {
        _autoPipActive = false;
        _enterFullMode();
        setTimeout(() => {
          if (typeof Brain !== 'undefined' && Brain.triggerWelcomeBack)
            Brain.triggerWelcomeBack();
        }, 350);
      }
    });

    // Additional fallback using the renderer's own window blur/focus events
    // (fires reliably in Electron when the native window gains/loses focus).
    window.addEventListener('blur', () => {
      if (!_isFullMode || !Settings.get('autoPipOnBlur')) return;
      if (Settings.get('autoPipSkipSession') && typeof Session !== 'undefined' &&
          Session.getState && Session.getState() === 'ACTIVE') return;
      // Only act if neither the IPC handler nor the visibility handler already did
      if (_autoPipActive) return;
      _autoPipActive = true;
      _autoPipCooldown = true;
      clearTimeout(_autoPipCooldownTimer);
      _autoPipCooldownTimer = setTimeout(() => { _autoPipCooldown = false; }, 900);
      _exitFullMode();
    });

    window.addEventListener('focus', () => {
      if (_autoPipCooldown) return;
      if (_autoPipTimer) { clearTimeout(_autoPipTimer); _autoPipTimer = null; }
      if (_autoPipActive && !_isFullMode && Settings.get('autoPipRestore')) {
        _autoPipActive = false;
        _enterFullMode();
        setTimeout(() => {
          if (typeof Brain !== 'undefined' && Brain.triggerWelcomeBack)
            Brain.triggerWelcomeBack();
        }, 350);
      }
    });

    // ── Emotion glow ring for PiP bubble ─────────────────────────────────
    // Poll Brain's current emotion every 500 ms and mirror it onto
    // #world[data-pip-emotion] so the CSS glow keyframes can react.
    {
      const worldEl = document.getElementById('world');
      if (worldEl) {
        setInterval(() => {
          const em = (window._lastEmotion || 'idle').toLowerCase();
          if (worldEl.dataset.pipEmotion !== em) {
            worldEl.dataset.pipEmotion = em;
          }
        }, 500);
      }
    }
  }

  // ── _wireKeybinds ─────────────────────────────────────────────────────────
  // Register all keyboard shortcuts in the central registry, then install the
  // single keydown listener.  Raw keydown handlers for these combos are removed
  // from _wireWindowControls / _wireSettings so there is exactly one listener.

  function _wireKeybinds() {
    Keybinds.register({
      id: 'toggle-pip',
      label: 'Toggle compact overlay',
      defaultKey: 'Ctrl+Shift+P',
      fn: () => _isFullMode ? _exitFullModeManual() : _enterFullMode(),
    });

    Keybinds.register({
      id: 'toggle-settings',
      label: 'Open / close settings',
      defaultKey: 'Ctrl+Shift+Comma',
      fn: () => document.getElementById('settings-gear-btn')?.click(),
    });

    Keybinds.register({
      id: 'cycle-mute-preset',
      label: 'Cycle mute preset',
      defaultKey: 'Ctrl+Shift+M',
      fn: () => {
        const order = ['ALL_ON', 'ESSENTIAL', 'REMINDERS_ONLY', 'ALL_OFF'];
        const cur   = Settings.get('mutePreset');
        Settings.set('mutePreset', order[(order.indexOf(cur) + 1) % order.length]);
      },
    });

    Keybinds.register({
      id: 'dismiss-break-reminder',
      label: 'Dismiss break reminder',
      defaultKey: 'Ctrl+Shift+B',
      fn: () => { if (BreakReminder.isActive()) BreakReminder.dismiss(); },
    });

    Keybinds.register({
      id: 'toggle-history',
      label: 'Open session / history panel',
      defaultKey: 'Ctrl+Shift+H',
      fn: () => {
        const hpIcon = document.getElementById('hp-icon');
        if (hpIcon) hpIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      },
    });

    Keybinds.register({
      id: 'toggle-dnd',
      label: 'Toggle Do Not Disturb',
      defaultKey: 'Ctrl+Shift+D',
      fn: () => DND.toggle(Settings.get('dndDuration') || 25),
    });

    Keybinds.init();
  }

  // ── _wireSettings ─────────────────────────────────────────────────────────
  // Settings panel open/close/focus-trap + live change listeners.

  function _wireSettings() {
    const panel     = document.getElementById('settings-panel');
    const gearBtn   = document.getElementById('settings-gear-btn');
    const closeBtn  = document.getElementById('settings-close-btn');
    if (!panel || !gearBtn) return;

    // ── Open / close ────────────────────────────────────────────────────
    function openPanel() {
      panel.classList.add('settings-open');
      gearBtn.setAttribute('aria-expanded', 'true');
      // Focus first focusable inside the panel
      const first = _focusable(panel)[0];
      if (first) first.focus();
    }

    function closePanel() {
      panel.classList.remove('settings-open');
      gearBtn.setAttribute('aria-expanded', 'false');
      // Collapse all accordion tiers (groups, subsections, legacy sections)
      panel.querySelectorAll(
        '.settings-group-title[aria-expanded="true"],' +
        '.settings-subsection-title[aria-expanded="true"],' +
        '.settings-section-title[aria-expanded="true"]'
      ).forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
        const body = btn.nextElementSibling;
        if (body) body.classList.remove('expanded');
      });
      gearBtn.focus();
    }

    gearBtn.addEventListener('click', () => {
      panel.classList.contains('settings-open') ? closePanel() : openPanel();
    });

    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    // ── Accordion section toggles ────────────────────────────────────────
    // Wire ALL toggleable titles: group-title, subsection-title, section-title
    function _wireAccordion(selector, bodyClass) {
      panel.querySelectorAll(selector).forEach((btn) => {
        btn.addEventListener('click', () => {
          const isOpen = btn.getAttribute('aria-expanded') === 'true';
          const body   = btn.nextElementSibling;
          btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
          if (body) body.classList.toggle(bodyClass, !isOpen);
        });
      });
    }
    _wireAccordion('.settings-group-title',      'expanded');
    _wireAccordion('.settings-subsection-title', 'expanded');
    _wireAccordion('.settings-section-title',    'expanded'); // legacy compat

    // Escape closes the panel
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closePanel(); }
    });

    // Focus trap — Tab cycles within the panel
    panel.addEventListener('keydown', _trapFocusHandler);

    // ── Populate + wire settings controls ───────────────────────────────

    // Mute preset
    const muteSelect = document.getElementById('mute-preset-select');
    const muteDesc   = document.getElementById('mute-preset-desc');
    const PRESET_DESCS = {
      ALL_ON:         'All sounds enabled',
      ESSENTIAL:      'Session & break sounds only',
      REMINDERS_ONLY: 'Break sounds only',
      ALL_OFF:        'Completely silent',
    };
    if (muteSelect) {
      muteSelect.value = Settings.get('mutePreset');
      if (muteDesc) muteDesc.textContent = PRESET_DESCS[muteSelect.value] || '';
      muteSelect.addEventListener('change', (e) => {
        Settings.set('mutePreset', e.target.value);
        if (muteDesc) muteDesc.textContent = PRESET_DESCS[e.target.value] || '';
      });
    }

    // Break reminder toggle + interval
    const breakToggle   = document.getElementById('break-reminder-toggle');
    const breakInterval = document.getElementById('break-interval-select');
    const breakRow      = document.getElementById('break-interval-row');
    let _lastNonZeroInterval = Settings.get('breakInterval') || 25;

    function _syncBreakUI(interval) {
      const on = interval > 0;
      if (breakToggle) breakToggle.checked = on;
      if (breakInterval) {
        breakInterval.value = on ? String(interval) : String(_lastNonZeroInterval);
        breakInterval.disabled = !on;
      }
      if (breakRow) breakRow.style.opacity = on ? '1' : '0.4';
    }

    _syncBreakUI(Settings.get('breakInterval'));

    if (breakToggle) {
      breakToggle.addEventListener('change', () => {
        if (breakToggle.checked) {
          Settings.set('breakInterval', _lastNonZeroInterval);
        } else {
          const cur = parseInt(breakInterval?.value || '25', 10);
          if (cur > 0) _lastNonZeroInterval = cur;
          Settings.set('breakInterval', 0);
        }
      });
    }

    if (breakInterval) {
      breakInterval.addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        _lastNonZeroInterval = v;
        if (breakToggle?.checked) Settings.set('breakInterval', v);
      });
    }

    // Ticks enabled toggle
    const ticksToggle = document.getElementById('ticks-enabled-toggle');
    if (ticksToggle) {
      ticksToggle.checked = Settings.get('ticksEnabled');
      ticksToggle.addEventListener('change', () => Settings.set('ticksEnabled', ticksToggle.checked));
    }

    // Break over alarm toggle — removed (breaks have no time limit)
    // Drone toggle
    const droneToggle = document.getElementById('drone-toggle');
    if (droneToggle) {
      droneToggle.checked = Settings.get('droneEnabled');
      droneToggle.addEventListener('change', () => Settings.set('droneEnabled', droneToggle.checked));
    }

    // Night volume toggle
    const nightToggle = document.getElementById('night-volume-toggle');
    if (nightToggle) {
      nightToggle.checked = Settings.get('nightAutoVolume');
      nightToggle.addEventListener('change', () => Settings.set('nightAutoVolume', nightToggle.checked));
    }

    // Auto-PiP on app switch toggle + sub-options
    const autoPipToggle = document.getElementById('auto-pip-toggle');
    const autoPipDelayRow       = document.getElementById('auto-pip-delay-row');
    const autoPipRestoreRow     = document.getElementById('auto-pip-restore-row');
    const autoPipSkipSessionRow = document.getElementById('auto-pip-skip-session-row');

    function _syncAutoPipSubrows(enabled) {
      const display = enabled ? '' : 'none';
      if (autoPipDelayRow)       autoPipDelayRow.style.display       = display;
      if (autoPipRestoreRow)     autoPipRestoreRow.style.display     = display;
      if (autoPipSkipSessionRow) autoPipSkipSessionRow.style.display = display;
    }

    if (autoPipToggle) {
      autoPipToggle.checked = Settings.get('autoPipOnBlur');
      _syncAutoPipSubrows(autoPipToggle.checked);
      autoPipToggle.addEventListener('change', () => {
        Settings.set('autoPipOnBlur', autoPipToggle.checked);
        _syncAutoPipSubrows(autoPipToggle.checked);
      });
    }
    Settings.onChange('autoPipOnBlur', (v) => {
      if (autoPipToggle) autoPipToggle.checked = v;
      _syncAutoPipSubrows(v);
    });

    // Collapse delay select
    const autoPipDelaySel = document.getElementById('auto-pip-delay-select');
    if (autoPipDelaySel) {
      autoPipDelaySel.value = String(Settings.get('autoPipDelay'));
      autoPipDelaySel.addEventListener('change', () =>
        Settings.set('autoPipDelay', parseInt(autoPipDelaySel.value, 10)));
    }
    Settings.onChange('autoPipDelay', (v) => {
      if (autoPipDelaySel) autoPipDelaySel.value = String(v);
    });

    // Restore on return toggle
    const autoPipRestoreToggle = document.getElementById('auto-pip-restore-toggle');
    if (autoPipRestoreToggle) {
      autoPipRestoreToggle.checked = Settings.get('autoPipRestore');
      autoPipRestoreToggle.addEventListener('change', () =>
        Settings.set('autoPipRestore', autoPipRestoreToggle.checked));
    }
    Settings.onChange('autoPipRestore', (v) => {
      if (autoPipRestoreToggle) autoPipRestoreToggle.checked = v;
    });

    // Stay full during sessions toggle
    const autoPipSkipSessionToggle = document.getElementById('auto-pip-skip-session-toggle');
    if (autoPipSkipSessionToggle) {
      autoPipSkipSessionToggle.checked = Settings.get('autoPipSkipSession');
      autoPipSkipSessionToggle.addEventListener('change', () =>
        Settings.set('autoPipSkipSession', autoPipSkipSessionToggle.checked));
    }
    Settings.onChange('autoPipSkipSession', (v) => {
      if (autoPipSkipSessionToggle) autoPipSkipSessionToggle.checked = v;
    });

    // PiP overlay shape chip picker
    const VALID_SHAPES = ['square', 'rounded', 'circle'];
    function _applyPipShape(shape) {
      VALID_SHAPES.forEach(s =>
        document.body.classList.toggle('pip-shape-' + s, s === shape));
    }
    function _syncShapeChips(shape) {
      document.querySelectorAll('#pip-shape-picker .pip-shape-chip').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.shape === shape);
      });
    }
    _applyPipShape(Settings.get('pipShape'));
    _syncShapeChips(Settings.get('pipShape'));
    document.querySelectorAll('#pip-shape-picker .pip-shape-chip').forEach(btn => {
      btn.addEventListener('click', () => Settings.set('pipShape', btn.dataset.shape));
    });
    Settings.onChange('pipShape', (v) => {
      _applyPipShape(v);
      _syncShapeChips(v);
    });

    // PiP snap toggle — auto-snap to nearest of 5 corners on drag release
    const pipSnapToggle = document.getElementById('pip-snap-toggle');
    if (pipSnapToggle) {
      pipSnapToggle.checked = Settings.get('pipSnapEnabled') !== false;
      pipSnapToggle.addEventListener('change', () => {
        Settings.set('pipSnapEnabled', pipSnapToggle.checked);
        if (window.electronAPI && window.electronAPI.setPipSnapEnabled)
          window.electronAPI.setPipSnapEnabled(pipSnapToggle.checked);
      });
    }


    // ══════════════════════════════════════════════════════════════════════
    // PiP BORDER + LOCK SYSTEM  (shape-preserving, drag-fixed)
    // ══════════════════════════════════════════════════════════════════════
    (function _wirePipBorder() {
      const world = document.getElementById('world');

      // ── CSS var helpers ─────────────────────────────────────────────────
      function _hexToRgbTriplet(hex) {
        if (!hex || typeof hex !== 'string') return null;
        const raw = hex.replace('#','');
        const full = raw.length===3 ? raw.split('').map(c=>c+c).join('') : raw;
        if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
        return `${parseInt(full.slice(0,2),16)},${parseInt(full.slice(2,4),16)},${parseInt(full.slice(4,6),16)}`;
      }

      function _applyBorderVars() {
        const root = document.documentElement.style;
        const c1  = Settings.get('pipBorderColor')  || '#8a93ff';
        const c2  = Settings.get('pipBorderColor2') || '#ff79b0';
        const thk = Settings.get('pipBorderThickness') ?? 2;
        const opa = Settings.get('pipBorderOpacity')   ?? 85;
        const gsz = Settings.get('pipGlowSize')        ?? 55;
        const gbl = Settings.get('pipGlowSoftness')    ?? 50;
        const spd = Settings.get('pipAnimSpeed')        ?? 50;

        const rgb1 = _hexToRgbTriplet(c1);
        const rgb2 = _hexToRgbTriplet(c2);
        if (rgb1) root.setProperty('--pip-bc1', rgb1);
        if (rgb2) root.setProperty('--pip-bc2', rgb2);
        root.setProperty('--pip-bthk', `${thk}px`);
        root.setProperty('--pip-bopa', (opa/100).toFixed(2));
        // glow 0-100% → 0-60px spread
        root.setProperty('--pip-glow', `${Math.round(gsz*0.6)}px`);
        // softness 0-100% → 6-50px blur
        root.setProperty('--pip-blur', `${Math.round(6 + gbl*0.44)}px`);
        // speed 10-200 → duration 8s-0.4s (inverted)
        const dur = (8 - ((spd-10)/190*7.6)).toFixed(2);
        root.setProperty('--pip-adur', `${dur}s`);
      }

      // ── Border style classes ─────────────────────────────────────────────
      const BSTYLES = ['none','glow','neon','solid','dotted','dashed','pulse','cozy',
        'pastel','retro','cyber','vaporwave','holographic','pixel','bubble','cat','faded','minimal'];

      function _applyBorderStyle(style) {
        BSTYLES.forEach(s => document.body.classList.toggle(`pip-bstyle-${s}`, s===style));
      }
      function _syncBorderChips(style) {
        document.querySelectorAll('#pip-border-style-grid .pip-border-style-chip').forEach(b => {
          b.classList.toggle('active', b.dataset.bstyle === style);
        });
      }

      // ── Anim pause ──────────────────────────────────────────────────────
      function _applyAnimEnabled(on) {
        if (world) world.style.animationPlayState = on ? 'running' : 'paused';
        const before = document.querySelector('#world::before');
        // CSS animation-play-state via class
        document.body.classList.toggle('pip-anim-paused', !on);
      }

      // ── Hover glow toggle ───────────────────────────────────────────────
      function _applyHoverGlow(on) {
        document.body.classList.toggle('pip-hover-glow', on);
      }

      // ── PiP window lock ─────────────────────────────────────────────────
      function _applyLock(locked) {
        document.body.classList.toggle('pip-locked', locked);
        if (window.electronAPI && window.electronAPI.setPipLocked)
          window.electronAPI.setPipLocked(locked);
      }

      // ── Hover spring animation on pip world ──────────────────────────────
      if (world) {
        world.addEventListener('mouseenter', () => {
          if (!document.body.classList.contains('pip-mode')) return;
          world.classList.add('pip-hovered');
        });
        world.addEventListener('mouseleave', () => {
          world.classList.remove('pip-hovered');
        });
      }

      // ── Visual presets ──────────────────────────────────────────────────
      const PIP_PRESETS = {
        default:     { style:'glow',        c1:'#8a93ff', c2:'#b0b8ff', thk:2, opa:85, gsz:55, gbl:50, spd:50 },
        cozy:        { style:'cozy',        c1:'#ffb347', c2:'#ff7f7f', thk:2, opa:82, gsz:50, gbl:65, spd:28 },
        neon:        { style:'neon',        c1:'#00f5ff', c2:'#ff00aa', thk:2, opa:95, gsz:80, gbl:22, spd:55 },
        cyber:       { style:'cyber',       c1:'#00ffaa', c2:'#00aaff', thk:2, opa:90, gsz:65, gbl:18, spd:85 },
        pastel:      { style:'pastel',      c1:'#f0abfc', c2:'#c7e9fb', thk:2, opa:72, gsz:45, gbl:75, spd:25 },
        retro:       { style:'retro',       c1:'#ff6b35', c2:'#ffdd57', thk:3, opa:95, gsz:40, gbl:18, spd:65 },
        vaporwave:   { style:'vaporwave',   c1:'#ff71ce', c2:'#01cdfe', thk:2, opa:88, gsz:65, gbl:45, spd:42 },
        cat:         { style:'cat',         c1:'#ff79b0', c2:'#ffb3d1', thk:2, opa:80, gsz:52, gbl:60, spd:35 },
        sleepy:      { style:'faded',       c1:'#9eb5ff', c2:'#c4b5fd', thk:1, opa:48, gsz:38, gbl:88, spd:16 },
        minimal:     { style:'minimal',     c1:'#8a93ff', c2:'#8a93ff', thk:1, opa:44, gsz:18, gbl:55, spd:38 },
        holographic: { style:'holographic', c1:'#ff79b0', c2:'#8a93ff', thk:2, opa:88, gsz:55, gbl:35, spd:60 },
        bubble:      { style:'bubble',      c1:'#a5f3fc', c2:'#c7d2fe', thk:1, opa:68, gsz:62, gbl:70, spd:32 },
      };

      function _applyPreset(name) {
        const p = PIP_PRESETS[name];
        if (!p) return;
        Settings.set('pipVisualPreset',    name);
        Settings.set('pipBorderStyle',     p.style);
        Settings.set('pipBorderColor',     p.c1);
        Settings.set('pipBorderColor2',    p.c2);
        Settings.set('pipBorderThickness', p.thk);
        Settings.set('pipBorderOpacity',   p.opa);
        Settings.set('pipGlowSize',        p.gsz);
        Settings.set('pipGlowSoftness',    p.gbl);
        Settings.set('pipAnimSpeed',       p.spd);
        _syncAllPipUI();
      }

      function _syncPresetChips(name) {
        document.querySelectorAll('#pip-preset-grid .pip-preset-chip').forEach(b => {
          b.classList.toggle('active', b.dataset.preset === name);
        });
      }

      // ── Emotion glow sync ────────────────────────────────────────────────
      const EMOTION_COLORS = {
        love:       { c1:'#ff6eb4', c2:'#ffb3d9' },
        happy:      { c1:'#ffdd57', c2:'#ffa500' },
        excited:    { c1:'#ff8c00', c2:'#ffd700' },
        ecstatic:   { c1:'#ff4500', c2:'#ff8c00' },
        overjoyed:  { c1:'#00e5ff', c2:'#69d2e7' },
        cozy:       { c1:'#ffb347', c2:'#ff7f7f' },
        sleepy:     { c1:'#7b68ee', c2:'#b0a4e3' },
        curious:    { c1:'#00e676', c2:'#69f0ae' },
        shy:        { c1:'#f48fb1', c2:'#fce4ec' },
        embarrassed:{ c1:'#ff6b6b', c2:'#ffb3b3' },
        dazed:      { c1:'#b39ddb', c2:'#d1c4e9' },
      };
      let _lastEmKey = '';
      setInterval(() => {
        if (!document.body.classList.contains('pip-mode')) return;
        if (!Settings.get('pipEmotionSync')) return;
        const em = ((window._lastEmotion||'idle')).toLowerCase().replace(/[^a-z_]/g,'');
        if (em === _lastEmKey) return;
        _lastEmKey = em;
        const colors = EMOTION_COLORS[em];
        const root = document.documentElement.style;
        if (colors) {
          const r1 = _hexToRgbTriplet(colors.c1);
          const r2 = _hexToRgbTriplet(colors.c2);
          if (r1) root.setProperty('--pip-bc1', r1);
          if (r2) root.setProperty('--pip-bc2', r2);
        } else {
          _applyBorderVars(); // reset to user colours
        }
      }, 700);

      // ── Sync all UI controls to current settings ─────────────────────────
      function _sliderSync(id, lblId, val, fmt) {
        const el = document.getElementById(id);
        const lb = document.getElementById(lblId);
        if (el) el.value = val;
        if (lb) lb.textContent = fmt(val);
      }
      function _speedLabel(v) {
        if (v<=20) return 'Very slow'; if (v<=40) return 'Slow';
        if (v<=70) return 'Normal';   if (v<=110) return 'Fast';
        return 'Very fast';
      }

      function _syncAllPipUI() {
        const g = k => Settings.get(k);
        _applyBorderStyle(g('pipBorderStyle')||'glow');
        _syncBorderChips(g('pipBorderStyle')||'glow');
        _applyBorderVars();
        _applyAnimEnabled(g('pipAnimEnabled')!==false);
        _applyHoverGlow(g('pipHoverGlow')!==false);
        _applyLock(g('pipLocked')===true);
        _syncPresetChips(g('pipVisualPreset')||'default');
        _sliderSync('pip-border-thick-slider','pip-border-thick-lbl', g('pipBorderThickness')??2, v=>`${v} px`);
        _sliderSync('pip-border-opa-slider',  'pip-border-opa-lbl',   g('pipBorderOpacity')??85,  v=>`${v}%`);
        _sliderSync('pip-glow-size-slider',   'pip-glow-size-lbl',    g('pipGlowSize')??55,       v=>`${v}%`);
        _sliderSync('pip-glow-soft-slider',   'pip-glow-soft-lbl',    g('pipGlowSoftness')??50,   v=>`${v}%`);
        _sliderSync('pip-anim-speed-slider',  'pip-anim-speed-lbl',   g('pipAnimSpeed')??50,      _speedLabel);
        const c1el = document.getElementById('pip-border-color1');
        const c2el = document.getElementById('pip-border-color2');
        if (c1el) c1el.value = g('pipBorderColor')||'#8a93ff';
        if (c2el) c2el.value = g('pipBorderColor2')||'#ff79b0';
        const animTog = document.getElementById('pip-anim-enabled-toggle');
        if (animTog) animTog.checked = g('pipAnimEnabled')!==false;
        const hoverTog = document.getElementById('pip-hover-glow-toggle');
        if (hoverTog) hoverTog.checked = g('pipHoverGlow')!==false;
        const emTog = document.getElementById('pip-emotion-sync-toggle');
        if (emTog) emTog.checked = g('pipEmotionSync')!==false;
        const lockTog = document.getElementById('pip-locked-toggle');
        if (lockTog) lockTog.checked = g('pipLocked')===true;
        const aotTog = document.getElementById('pip-always-on-top-toggle');
        if (aotTog) aotTog.checked = g('pipAlwaysOnTop')!==false;
      }

      // ── Wire preset chips ────────────────────────────────────────────────
      document.querySelectorAll('#pip-preset-grid .pip-preset-chip').forEach(btn => {
        btn.addEventListener('click', () => _applyPreset(btn.dataset.preset));
      });

      // ── Wire border style chips ──────────────────────────────────────────
      document.querySelectorAll('#pip-border-style-grid .pip-border-style-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          Settings.set('pipBorderStyle', btn.dataset.bstyle);
          Settings.set('pipVisualPreset','custom');
          _syncPresetChips('custom');
        });
      });
      Settings.onChange('pipBorderStyle', v => { _applyBorderStyle(v); _syncBorderChips(v); });

      // ── Wire colour pickers ──────────────────────────────────────────────
      const c1el = document.getElementById('pip-border-color1');
      const c2el = document.getElementById('pip-border-color2');
      if (c1el) c1el.addEventListener('input', () => {
        Settings.set('pipBorderColor', c1el.value);
        Settings.set('pipVisualPreset','custom');
        _applyBorderVars();
      });
      if (c2el) c2el.addEventListener('input', () => {
        Settings.set('pipBorderColor2', c2el.value);
        Settings.set('pipVisualPreset','custom');
        _applyBorderVars();
      });
      Settings.onChange('pipBorderColor',  () => _applyBorderVars());
      Settings.onChange('pipBorderColor2', () => _applyBorderVars());

      // ── Wire swatches ────────────────────────────────────────────────────
      document.querySelectorAll('#pip-swatches .pip-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.c1 && c1el) { c1el.value = btn.dataset.c1; Settings.set('pipBorderColor', btn.dataset.c1); }
          if (btn.dataset.c2 && c2el) { c2el.value = btn.dataset.c2; Settings.set('pipBorderColor2', btn.dataset.c2); }
          Settings.set('pipVisualPreset','custom');
          _applyBorderVars();
          document.querySelectorAll('#pip-swatches .pip-swatch').forEach(b => b.classList.toggle('active', b===btn));
        });
      });

      // ── Wire sliders ─────────────────────────────────────────────────────
      function _wireSlider(sliderId, lblId, settingKey, fmt, cb) {
        const el = document.getElementById(sliderId);
        const lb = document.getElementById(lblId);
        if (!el) return;
        el.value = Settings.get(settingKey) ?? el.defaultValue;
        if (lb) lb.textContent = fmt(parseInt(el.value,10));
        el.addEventListener('input', () => {
          const v = parseInt(el.value,10);
          if (lb) lb.textContent = fmt(v);
          Settings.set(settingKey, v);
          Settings.set('pipVisualPreset','custom');
          if (cb) cb(v);
        });
        Settings.onChange(settingKey, v => { if(el) el.value=v; if(lb) lb.textContent=fmt(v); });
      }
      _wireSlider('pip-border-thick-slider','pip-border-thick-lbl','pipBorderThickness',v=>`${v} px`,()=>_applyBorderVars());
      _wireSlider('pip-border-opa-slider',  'pip-border-opa-lbl',  'pipBorderOpacity',  v=>`${v}%`, ()=>_applyBorderVars());
      _wireSlider('pip-glow-size-slider',   'pip-glow-size-lbl',   'pipGlowSize',       v=>`${v}%`, ()=>_applyBorderVars());
      _wireSlider('pip-glow-soft-slider',   'pip-glow-soft-lbl',   'pipGlowSoftness',   v=>`${v}%`, ()=>_applyBorderVars());
      _wireSlider('pip-anim-speed-slider',  'pip-anim-speed-lbl',  'pipAnimSpeed',      _speedLabel, ()=>_applyBorderVars());

      // ── Wire toggles ─────────────────────────────────────────────────────
      function _wireTog(id, key, cb) {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked = Settings.get(key)!==false && Settings.get(key)!==null;
        el.addEventListener('change', () => { Settings.set(key, el.checked); if(cb) cb(el.checked); });
        Settings.onChange(key, v => { if(el) el.checked=!!v; if(cb) cb(!!v); });
      }
      _wireTog('pip-anim-enabled-toggle', 'pipAnimEnabled',  _applyAnimEnabled);
      _wireTog('pip-hover-glow-toggle',   'pipHoverGlow',    _applyHoverGlow);
      _wireTog('pip-emotion-sync-toggle', 'pipEmotionSync',  null);
      _wireTog('pip-always-on-top-toggle','pipAlwaysOnTop',  v => {
        if (window.electronAPI && window.electronAPI.setPipAlwaysOnTop)
          window.electronAPI.setPipAlwaysOnTop(v);
      });

      // Lock toggle — separate: default is false (not checked)
      const lockTog = document.getElementById('pip-locked-toggle');
      if (lockTog) {
        lockTog.checked = Settings.get('pipLocked')===true;
        lockTog.addEventListener('change', () => {
          Settings.set('pipLocked', lockTog.checked);
          _applyLock(lockTog.checked);
        });
        Settings.onChange('pipLocked', v => {
          if(lockTog) lockTog.checked=!!v;
          _applyLock(!!v);
        });
      }

      // ── Corner snap buttons ──────────────────────────────────────────────
      document.querySelectorAll('#pip-corner-picker .pip-corner-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          if (window.electronAPI && window.electronAPI.setPipCorner)
            window.electronAPI.setPipCorner(btn.dataset.corner);
          document.querySelectorAll('#pip-corner-picker .pip-corner-chip')
            .forEach(b => b.classList.toggle('active', b===btn));
          setTimeout(() => btn.classList.remove('active'), 1200);
        });
      });

      // ── Boot ─────────────────────────────────────────────────────────────
      _syncAllPipUI();

    })(); // end _wirePipBorder

    // Sensitivity select
    const sensitivitySel = document.getElementById('settings-sensitivity-select');
    if (sensitivitySel) {
      sensitivitySel.value = Settings.get('sensitivity');
      sensitivitySel.addEventListener('change', (e) => Settings.set('sensitivity', e.target.value));
    }

    // Phone detection toggle
    const phoneToggle = document.getElementById('phone-detection-toggle');
    if (phoneToggle) {
      phoneToggle.checked = Settings.get('phoneDetection');
      phoneToggle.addEventListener('change', () => Settings.set('phoneDetection', phoneToggle.checked));
    }

    // Celebration toggle
    const celebrationToggle = document.getElementById('celebration-toggle');
    if (celebrationToggle) {
      celebrationToggle.checked = Settings.get('celebrationEnabled');
      celebrationToggle.addEventListener('change', () => Settings.set('celebrationEnabled', celebrationToggle.checked));
    }

    // Break animation toggle
    const breakAnimToggle = document.getElementById('break-anim-toggle');
    if (breakAnimToggle) {
      breakAnimToggle.checked = Settings.get('breakAnimEnabled');
      breakAnimToggle.addEventListener('change', () => Settings.set('breakAnimEnabled', breakAnimToggle.checked));
    }

    // Anti-cheat toggle
    const antiCheatToggle = document.getElementById('anti-cheat-toggle');
    if (antiCheatToggle) {
      antiCheatToggle.checked = Settings.get('antiCheatEnabled');
      antiCheatToggle.addEventListener('change', () => {
        Settings.set('antiCheatEnabled', antiCheatToggle.checked);
        if (typeof HistoryPanel !== 'undefined' && HistoryPanel.refresh) HistoryPanel.refresh();
      });
    }

    // ── Live change listeners ────────────────────────────────────────────
    Settings.onChange('antiCheatEnabled', (v) => {
      if (antiCheatToggle) antiCheatToggle.checked = v;
      if (typeof HistoryPanel !== 'undefined' && HistoryPanel.refresh) HistoryPanel.refresh();
    });
    Settings.onChange('mutePreset', (v) => {
      Sounds.setMutePreset(v);
      if (muteSelect) muteSelect.value = v;
      if (muteDesc)   muteDesc.textContent = PRESET_DESCS[v] || '';
    });

    Settings.onChange('breakInterval', (v) => {
      BreakReminder.setInterval(v);
      _syncBreakUI(v);
    });

    Settings.onChange('sensitivity', (v) => {
      Brain.setSensitivity(v);
      if (sensitivitySel) sensitivitySel.value = v;
    });

    Settings.onChange('phoneDetection', (v) => {
      if (typeof Brain !== 'undefined' && Brain.setPhoneDetectionEnabled) Brain.setPhoneDetectionEnabled(v);
      if (phoneToggle) phoneToggle.checked = v;
    });

    Settings.onChange('nightAutoVolume', (v) => {
      if (!v) Sounds.setNightGainMult(1.0);
      if (nightToggle) nightToggle.checked = v;
    });

    Settings.onChange('droneEnabled', (v) => {
      Soundscape.setEnabled(v);
      if (droneToggle) droneToggle.checked = v;
    });

    Settings.onChange('ticksEnabled', (v) => {
      Sounds.setTicksEnabled(v);
      if (ticksToggle) ticksToggle.checked = v;
    });

    // ── Volume slider ────────────────────────────────────────────────────
    const volumeSlider  = document.getElementById('volume-slider');
    const volumeSubLabel = document.getElementById('volume-sublabel');

    function _applyVolume(v) {
      Sounds.setVolume(v);
      if (volumeSlider)   volumeSlider.value = Math.round(v * 100);
      if (volumeSubLabel) volumeSubLabel.textContent = `${Math.round(v * 100)}%`;
    }

    _applyVolume(Settings.get('volume'));
    Sounds.setTicksEnabled(Settings.get('ticksEnabled'));

    if (volumeSlider) {
      volumeSlider.addEventListener('input', () => {
        const v = parseInt(volumeSlider.value, 10) / 100;
        Settings.set('volume', v);
      });
    }

    Settings.onChange('volume', (v) => _applyVolume(v));

    // ── Brightness slider ────────────────────────────────────────────────
    const brightnessSlider   = document.getElementById('brightness-slider');
    const brightnessSubLabel = document.getElementById('brightness-sublabel');

    function _applyBrightness(v) {
      // Apply to <html> so the body background (full-mode themes) is also dimmed
      document.documentElement.style.filter = v < 1.0 ? `brightness(${v})` : '';
      if (brightnessSlider)   brightnessSlider.value = Math.round(v * 100);
      if (brightnessSubLabel) brightnessSubLabel.textContent = `${Math.round(v * 100)}%`;
    }

    _applyBrightness(Settings.get('brightness'));

    if (brightnessSlider) {
      brightnessSlider.addEventListener('input', () => {
        const v = parseInt(brightnessSlider.value, 10) / 100;
        Settings.set('brightness', v);
      });
    }

    Settings.onChange('brightness', (v) => _applyBrightness(v));

    // ── Companion size (slider 50–200, 100 = default M) ──────────────────
    const companionSizeSlider  = document.getElementById('companion-size-slider');
    const companionSizeSublabel = document.getElementById('companion-size-sublabel');

    function _applyCompanionSize(pct) {
      const scale = (Number(pct) || 100) / 100;
      // Set on :root for full cascade availability, and on #world as direct override
      document.documentElement.style.setProperty('--companion-scale', String(scale));
      const world = document.getElementById('world');
      if (world) world.style.setProperty('--companion-scale', String(scale));
      // Remove legacy body classes so they don't interfere
      document.body.classList.remove('companion-size-S', 'companion-size-M', 'companion-size-L');
      if (companionSizeSlider) companionSizeSlider.value = String(pct);
      if (companionSizeSublabel) companionSizeSublabel.textContent = `${pct}%`;
    }

    _applyCompanionSize(Settings.get('companionSize') ?? 100);

    if (companionSizeSlider) {
      companionSizeSlider.addEventListener('input', () => {
        Settings.set('companionSize', Number(companionSizeSlider.value));
      });
    }

    Settings.onChange('companionSize', (v) => _applyCompanionSize(v));

    // ── Default session length ───────────────────────────────────────────
    const sessionLengthSel = document.getElementById('session-length-select');

    if (sessionLengthSel) {
      sessionLengthSel.value = String(Settings.get('sessionLength'));
      sessionLengthSel.addEventListener('change', (e) => {
        const v = parseInt(e.target.value, 10);
        Settings.set('sessionLength', v);
        // Also update the start-screen HH:MM:SS duration fields if visible
        _setDurationSeconds(v * 60);
      });
    }

    Settings.onChange('sessionLength', (v) => {
      if (sessionLengthSel) sessionLengthSel.value = String(v);
      _setDurationSeconds(v * 60);
    });

    // Pre-fill start-screen HH:MM:SS fields with saved default now
    {
      _setDurationSeconds(Settings.get('sessionLength') * 60);
    }

    // ── Timer step (duration stepper +/− increment) ─────────────────────
    const timerStepSel = document.getElementById('timer-step-select');
    if (timerStepSel) {
      timerStepSel.value = String(Settings.get('timerStep') || 5);
      timerStepSel.addEventListener('change', (e) => {
        Settings.set('timerStep', parseInt(e.target.value, 10));
      });
    }
    Settings.onChange('timerStep', (v) => {
      if (timerStepSel) timerStepSel.value = String(v);
    });

    // ── Daily focus goal ─────────────────────────────────────────────────
    const dailyGoalSel = document.getElementById('daily-goal-select');
    if (dailyGoalSel) {
      dailyGoalSel.value = String(Settings.get('dailyFocusGoalMins') || 0);
      dailyGoalSel.addEventListener('change', (e) => {
        Settings.set('dailyFocusGoalMins', parseInt(e.target.value, 10));
        _updateDailyGoalArc();
      });
    }
    Settings.onChange('dailyFocusGoalMins', (v) => {
      if (dailyGoalSel) dailyGoalSel.value = String(v);
      _updateDailyGoalArc();
    });

    // ── Distraction budget ───────────────────────────────────────────────
    const distractionBudgetSel = document.getElementById('distraction-budget-select');
    if (distractionBudgetSel) {
      distractionBudgetSel.value = String(Settings.get('distractionBudget') || 0);
      distractionBudgetSel.addEventListener('change', (e) => {
        Settings.set('distractionBudget', parseInt(e.target.value, 10));
      });
    }
    Settings.onChange('distractionBudget', (v) => {
      if (distractionBudgetSel) distractionBudgetSel.value = String(v);
    });

    // ── Session stats (today) ────────────────────────────────────────────
    function _refreshSessionStats() {
      const todayLabel  = document.getElementById('sessions-today-label');
      const focusLabel  = document.getElementById('focus-today-label');
      if (!todayLabel && !focusLabel) return;

      const history = Session.getHistory ? Session.getHistory() : [];
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      let sessions = 0;
      let focusSec = 0;
      history.forEach(s => {
        const ts = s.date ? new Date(s.date).getTime() : 0;
        if (ts >= todayMs) {
          sessions++;
          focusSec += s.actualFocusedSeconds || 0;
        }
      });

      const focusMins = Math.round(focusSec / 60);
      if (todayLabel) todayLabel.textContent = `${sessions} session${sessions !== 1 ? 's' : ''} today`;
      if (focusLabel) focusLabel.textContent  = `${focusMins} min focused today`;
    }

    _refreshSessionStats();
    // Refresh stats each time the panel opens
    gearBtn.addEventListener('click', _refreshSessionStats);

    // ── Backup: export / import ──────────────────────────────────────────────
    const exportBtn    = document.getElementById('export-history-btn');
    const importBtn    = document.getElementById('import-history-btn');
    const backupStatus = document.getElementById('backup-status');

    function _updateExportCount() {
      const el = document.getElementById('export-session-count');
      if (el) el.textContent = `${Session.getHistory().length} session${Session.getHistory().length !== 1 ? 's' : ''} saved`;
    }
    _updateExportCount();
    gearBtn.addEventListener('click', _updateExportCount);

    function _showBackupStatus(msg, color) {
      if (!backupStatus) return;
      backupStatus.textContent   = msg;
      backupStatus.style.color   = color;
      backupStatus.style.display = '';
      setTimeout(() => { if (backupStatus) backupStatus.style.display = 'none'; }, 4000);
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        exportBtn.disabled    = true;
        exportBtn.textContent = 'exporting…';
        const json   = Session.exportHistory();
        const result = await window.electronAPI.exportHistory(json);
        exportBtn.disabled    = false;
        exportBtn.textContent = 'export';
        if (result.ok) {
          _showBackupStatus('exported ✓', 'rgba(68,232,176,0.80)');
        } else if (result.reason !== 'cancelled') {
          _showBackupStatus(`export failed: ${result.reason}`, 'rgba(255,100,100,0.80)');
        }
      });
    }

    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        importBtn.disabled    = true;
        importBtn.textContent = 'importing…';
        const fileResult = await window.electronAPI.importHistory();
        importBtn.disabled    = false;
        importBtn.textContent = 'import';
        if (!fileResult.ok) {
          if (fileResult.reason !== 'cancelled') {
            _showBackupStatus(`import failed: ${fileResult.reason}`, 'rgba(255,100,100,0.80)');
          }
          return;
        }
        const mergeResult = Session.importHistory(fileResult.data);
        if (mergeResult.success) {
          _updateExportCount();
          _refreshSessionStats();
          _showBackupStatus(
            `imported ${mergeResult.imported} new session${mergeResult.imported !== 1 ? 's' : ''} ✓`,
            'rgba(68,232,176,0.80)'
          );
        } else {
          _showBackupStatus(mergeResult.reason, 'rgba(255,100,100,0.80)');
        }
      });
    }

    // ── Settings backup: export / import ─────────────────────────────────────
    const exportSettingsBtn    = document.getElementById('export-settings-btn');
    const importSettingsBtn    = document.getElementById('import-settings-btn');
    const resetSettingsBtn     = document.getElementById('reset-settings-btn');
    const settingsBackupStatus = document.getElementById('settings-backup-status');

    function _showSettingsBackupStatus(msg, color) {
      if (!settingsBackupStatus) return;
      settingsBackupStatus.textContent   = msg;
      settingsBackupStatus.style.color   = color;
      settingsBackupStatus.style.display = '';
      setTimeout(() => { if (settingsBackupStatus) settingsBackupStatus.style.display = 'none'; }, 4000);
    }

    if (exportSettingsBtn) {
      exportSettingsBtn.addEventListener('click', async () => {
        exportSettingsBtn.disabled    = true;
        exportSettingsBtn.textContent = 'exporting…';
        const json   = Settings.exportSettings();
        const result = await window.electronAPI.exportSettings(json);
        exportSettingsBtn.disabled    = false;
        exportSettingsBtn.textContent = 'export';
        if (result.ok) {
          _showSettingsBackupStatus('settings exported ✓', 'rgba(68,232,176,0.80)');
        } else if (result.reason !== 'cancelled') {
          _showSettingsBackupStatus(`export failed: ${result.reason}`, 'rgba(255,100,100,0.80)');
        }
      });
    }

    if (importSettingsBtn) {
      importSettingsBtn.addEventListener('click', async () => {
        importSettingsBtn.disabled    = true;
        importSettingsBtn.textContent = 'importing…';
        const fileResult = await window.electronAPI.importSettings();
        importSettingsBtn.disabled    = false;
        importSettingsBtn.textContent = 'import';
        if (!fileResult.ok) {
          if (fileResult.reason !== 'cancelled') {
            _showSettingsBackupStatus(`import failed: ${fileResult.reason}`, 'rgba(255,100,100,0.80)');
          }
          return;
        }
        const mergeResult = Settings.importSettings(fileResult.data);
        if (mergeResult.success) {
          _showSettingsBackupStatus(
            `${mergeResult.applied} settings applied ✓`,
            'rgba(68,232,176,0.80)'
          );
        } else {
          _showSettingsBackupStatus(mergeResult.reason, 'rgba(255,100,100,0.80)');
        }
      });
    }

    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', () => {
        Settings.reset();
        _showSettingsBackupStatus('settings reset to defaults ✓', 'rgba(68,232,176,0.80)');
      });
    }

    // ── Clear history button ─────────────────────────────────────────────
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', () => {
        const count = Session.getHistory().length;
        if (count === 0) {
          _showBackupStatus('no sessions to clear', 'rgba(200,185,255,0.60)');
          return;
        }
        if (!confirm(`Complete reset: permanently delete all ${count} session${count !== 1 ? 's' : ''} and reset lifetime stats to zero?\n\nThis cannot be undone.`)) return;
        Session.hardClearHistory();
        _updateExportCount();
        if (typeof HistoryPanel !== 'undefined') HistoryPanel.refresh();
        _showBackupStatus(`cleared ${count} session${count !== 1 ? 's' : ''} + stats reset ✓`, 'rgba(248,113,113,0.80)');
      });
    }

    // ── Clear all cache button ───────────────────────────────────────────
    const clearCacheBtn = document.getElementById('clear-cache-btn');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', () => {
        if (!confirm('Wipe ALL stored data (sessions + settings)? This cannot be undone.')) return;
        Session.clearAllCache();
        Settings.reset();
        _updateExportCount();
        if (typeof HistoryPanel !== 'undefined') HistoryPanel.refresh();
        _showBackupStatus('all cache wiped ✓ — restart recommended', 'rgba(248,113,113,0.80)');
      });
    }

    // ── Emotion preview duration slider ─────────────────────────────────
    const previewDurSlider   = document.getElementById('preview-dur-slider');
    const previewDurSubLabel = document.getElementById('preview-dur-sublabel');

    function _applyPreviewDur(v) {
      const n = parseInt(v, 10) || 3;
      if (previewDurSlider)   previewDurSlider.value = n;
      if (previewDurSubLabel) previewDurSubLabel.textContent = `${n} s`;
    }
    _applyPreviewDur(Settings.get('emotionPreviewDuration'));

    if (previewDurSlider) {
      previewDurSlider.addEventListener('input', () => {
        const v = parseInt(previewDurSlider.value, 10);
        Settings.set('emotionPreviewDuration', v);
        _applyPreviewDur(v);
      });
    }

    // ── Personality Studio replaces the old triple-btn controls.
    // Keep Settings.onChange wires so Brain stays in sync if settings load from disk.
    Settings.onChange('idleSpeed',      v => { if (Brain.setIdleSpeed)      Brain.setIdleSpeed(v); });
    Settings.onChange('expressiveness', v => { if (Brain.setExpressiveness) Brain.setExpressiveness(v); });
    Settings.onChange('pettingMode',    v => { if (Brain.setPettingMode)    Brain.setPettingMode(v); });


    const emotionGrid = document.getElementById('emotion-grid');
    if (emotionGrid) {
      const GLOW = {
        idle: '155,135,255', curious: '115,125,245', focused: '110,130,225',
        sleepy: '130,140,210', suspicious: '115,120,240', happy: '160,140,245',
        scared: '195,218,255', sad: '100,145,210', crying: '75,120,195',
        pouty: '255,188,118', grumpy: '255,138,128', overjoyed: '255,240,198',
        sulking: '205,138,192', embarrassed: '255,120,155', forgiven: '255,160,190',
        excited: '255,228,120', shy: '255,142,198', love: '255,138,180',
        startled: '200,220,255', cozy: '255,155,130', being_patted: '255,110,145',
        ecstatic: '255,230,60', dazed: '200,165,255',
      };
      const EMOJI = {
        idle: '○', curious: '◉', focused: '◎', sleepy: '◔',
        suspicious: '👁', happy: '◕‿◕', scared: '○!', sad: '◕︵◕',
        crying: '😢', pouty: '◣', grumpy: '◤', overjoyed: '★',
        sulking: '◷', embarrassed: '◕///◕', forgiven: '♡✓', excited: '◕!',
        shy: '///◕', love: '♡', startled: '◕‼', cozy: '◕‿◕♡', being_patted: 'UwU♡',
        ecstatic: '✦★✦', dazed: '◕~◕',
      };
      const SOUND_MAP = {
        happy: 'happy_coo', curious: 'curious_ooh', overjoyed: 'overjoyed_chirp',
        excited: 'excited_chirp', shy: 'shy_squeak', love: 'love_purr',
        suspicious: 'suspicious_squint', pouty: 'pouty_mweh', grumpy: 'grumpy_hmph',
        scared: 'scared_eep', sad: 'sad_whimper', crying: 'crying_sob',
        startled: 'startled_gasp', cozy: 'love_purr', being_patted: 'love_purr',
        ecstatic: 'overjoyed_chirp', dazed: 'love_purr',
      };

      // Rich per-emotion tooltip descriptions
      const DESC = {
        idle:        'Resting calmly',
        curious:     'Something caught its eye',
        focused:     'Deep in concentration',
        sleepy:      'Getting drowsy',
        suspicious:  'Something feels off…',
        happy:       'Warm and joyful',
        scared:      'Startled or anxious',
        sad:         'Feeling a little down',
        crying:      'Really sad',
        pouty:       'Mildly grumpy',
        grumpy:      'Properly grumpy',
        overjoyed:   'Pure unbridled joy',
        sulking:     'Sulking quietly',
        embarrassed: 'Flustered and blushing',
        forgiven:    'All is forgiven ♡',
        excited:     'Buzzing with energy',
        shy:         'Bashful from eye contact',
        love:        'Click-to-pet affection ♡',
        startled:    'Sudden scare!',
        cozy:        'Hold < 1.5 s — half-lidded warmth, heavy droopy eyes',
        being_patted:'Hold ≥ 1.5 s — eyes fully closed, bliss escalates the longer you hold ♡',
        ecstatic:    'Hold ≥ 16 s — golden star eyes, absolute peak joy — the creature has ascended ✦',
        dazed:       'Post-long-hold bliss fog — asymmetric dreamy eyes, floating on air ♡',
      };

      // Emotional categories
      const CATEGORIES = [
        { label: '✦ Positive',  states: ['happy', 'overjoyed', 'excited', 'love', 'cozy', 'being_patted', 'ecstatic', 'dazed', 'shy', 'forgiven'] },
        { label: '◎ Neutral',   states: ['idle', 'focused', 'curious', 'sleepy', 'embarrassed'] },
        { label: '◤ Negative',  states: ['suspicious', 'pouty', 'grumpy', 'sulking', 'scared', 'sad', 'crying', 'startled'] },
      ];

      let _activeBtn = null;

      emotionGrid.style.cssText = 'padding: 0 10px 10px;';

      CATEGORIES.forEach(cat => {
        // Category label
        const catLabel = document.createElement('div');
        catLabel.className = 'emotion-category-label';
        catLabel.textContent = cat.label;
        emotionGrid.appendChild(catLabel);

        // Grid row for this category
        const grid = document.createElement('div');
        grid.className = 'emotion-category-grid';
        emotionGrid.appendChild(grid);

        cat.states.forEach(state => {
          const btn = document.createElement('button');
          btn.className = 'emotion-test-btn';
          btn.dataset.emotion = state;
          btn.style.setProperty('--glow-color', GLOW[state] || '155,135,255');

          const icon = document.createElement('span');
          icon.className = 'emotion-btn-icon';
          icon.textContent = EMOJI[state] || '○';
          icon.setAttribute('aria-hidden', 'true');

          const name = document.createElement('span');
          name.className = 'emotion-btn-name';
          name.textContent = state;

          btn.appendChild(icon);
          btn.appendChild(name);
          btn.title = DESC[state] || `Preview: ${state}`;

          btn.addEventListener('click', () => {
            if (_activeBtn) _activeBtn.classList.remove('active');
            btn.classList.add('active');
            _activeBtn = btn;
            const sound = SOUND_MAP[state];
            if (sound) Sounds.play(sound);
            // Start side-effects that go beyond the CSS class swap
            if (state === 'crying' && typeof Brain !== 'undefined' && Brain.startTearEffect) {
              Brain.startTearEffect();
            }
            const durMs = (Settings.get('emotionPreviewDuration') || 3) * 1000;
            Emotion.preview(state, durMs, () => {
              btn.classList.remove('active');
              if (_activeBtn === btn) _activeBtn = null;
              // Always clean up tears when the preview ends
              if (typeof Brain !== 'undefined' && Brain.stopTearEffect) Brain.stopTearEffect();
            });
          });

          grid.appendChild(btn);
        });
      });
    }

    // ── Shortcuts display ────────────────────────────────────────────────
    const shortcutsList = document.getElementById('shortcuts-list');
    if (shortcutsList) {
      Keybinds.getAll().forEach(({ label, currentKey }) => {
        const row = document.createElement('div');
        row.className = 'settings-row';
        const labelEl = document.createElement('div');
        labelEl.className = 'settings-row-label';
        labelEl.textContent = label;
        const chip = document.createElement('kbd');
        chip.className = 'shortcut-chip';
        chip.textContent = Keybinds.prettyKey(currentKey);
        row.appendChild(labelEl);
        row.appendChild(chip);
        shortcutsList.appendChild(row);
      });
    }

    // ── Full-screen theme picker ─────────────────────────────────────────
    const THEME_CLASSES = ['theme-galaxy','theme-classic','theme-forest','theme-ocean','theme-cherry',
                           'theme-snow','theme-rain','theme-dreamscape','theme-anime','theme-matrix','theme-neon','theme-cozy'];

    function _applyFullTheme(theme) {
      document.body.classList.remove(...THEME_CLASSES);
      document.body.classList.add(`theme-${theme}`);
      const picker = document.getElementById('full-theme-picker');
      if (picker) {
        picker.querySelectorAll('.theme-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.theme === theme));
      }
    }

    _applyFullTheme(Settings.get('fullTheme') || 'galaxy');

    const themePicker = document.getElementById('full-theme-picker');
    if (themePicker) {
      themePicker.querySelectorAll('.theme-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('fullTheme', btn.dataset.theme));
      });
    }
    Settings.onChange('fullTheme', (v) => _applyFullTheme(v));

    // ── Eye colour picker ────────────────────────────────────────────────
    const EYE_COLOR_CLASSES = ['eye-periwinkle','eye-emerald','eye-rose','eye-amber',
                               'eye-lavender','eye-sky','eye-ruby','eye-teal'];

    function _applyEyeColor(color) {
      document.body.classList.remove(...EYE_COLOR_CLASSES);
      if (color && color !== 'periwinkle') document.body.classList.add(`eye-${color}`);
      const picker = document.getElementById('eye-color-picker');
      if (picker) {
        picker.querySelectorAll('.color-swatch').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.color === color));
      }
    }

    _applyEyeColor(Settings.get('eyeColor') || 'periwinkle');

    const eyeColorPicker = document.getElementById('eye-color-picker');
    if (eyeColorPicker) {
      eyeColorPicker.querySelectorAll('.color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          // BUG FIX: clear custom iris override so preset takes effect immediately
          if (Settings.get('customIrisHex')) {
            Settings.set('customIrisHex', '');
            // IrisColor.clearIris() fires via Settings.onChange listener
          }
          ['customIrisCenterHex','customIrisMidHex','customIrisEdgeHex',
           'customIrisRingHex','customIrisHighlightHex','customIrisPupilCoreHex']
            .forEach(k => { if (Settings.get(k)) Settings.set(k, ''); });
          Settings.set('eyeColor', btn.dataset.color);
        });
      });
    }
    Settings.onChange('eyeColor', (v) => _applyEyeColor(v));

    // ── PiP opacity slider ───────────────────────────────────────────────
    const pipOpacitySlider   = document.getElementById('pip-opacity-slider');
    const pipOpacitySubLabel = document.getElementById('pip-opacity-sublabel');

    function _applyPipOpacity(pct) {
      const world = document.getElementById('world');
      if (world) world.style.setProperty('--pip-bg-opacity', (pct / 100).toFixed(2));
      if (pipOpacitySlider)   pipOpacitySlider.value = pct;
      if (pipOpacitySubLabel) pipOpacitySubLabel.textContent = `${pct}%`;
    }

    _applyPipOpacity(Settings.get('pipOpacity') != null ? Settings.get('pipOpacity') : 78);

    if (pipOpacitySlider) {
      pipOpacitySlider.addEventListener('input', () => {
        const v = parseInt(pipOpacitySlider.value, 10);
        Settings.set('pipOpacity', v);
      });
    }
    Settings.onChange('pipOpacity', (v) => _applyPipOpacity(v));

    // companion-pos removed — horizontal eye placement feature removed

    // ── Blink rate ───────────────────────────────────────────────────────
    function _applyBlinkRate(rate) {
      if (Companion.setBlinkRate) Companion.setBlinkRate(rate);
      const btns = document.getElementById('blink-rate-btns');
      if (btns) {
        btns.querySelectorAll('.style-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.blink === rate));
      }
    }

    _applyBlinkRate(Settings.get('blinkRate') || 'normal');

    const blinkRateBtns = document.getElementById('blink-rate-btns');
    if (blinkRateBtns) {
      blinkRateBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('blinkRate', btn.dataset.blink));
      });
    }
    Settings.onChange('blinkRate', (v) => _applyBlinkRate(v));

    // ── Eyebrows toggle ──────────────────────────────────────────────────
    const eyebrowsToggle = document.getElementById('eyebrows-toggle');

    function _applyShowEyebrows(show) {
      document.body.classList.toggle('hide-eyebrows', !show);
      if (eyebrowsToggle) eyebrowsToggle.checked = !!show;
    }

    _applyShowEyebrows(Settings.get('showEyebrows') !== false);

    if (eyebrowsToggle) {
      eyebrowsToggle.addEventListener('change', () =>
        Settings.set('showEyebrows', eyebrowsToggle.checked));
    }
    Settings.onChange('showEyebrows', (v) => _applyShowEyebrows(v));

    // ── Whiskers toggle ──────────────────────────────────────────────────
    const whiskersToggle = document.getElementById('whiskers-toggle');

    function _applyShowWhiskers(show) {
      document.body.classList.toggle('hide-whiskers', !show);
      if (whiskersToggle) whiskersToggle.checked = !!show;
    }

    _applyShowWhiskers(Settings.get('showWhiskers') !== false);

    if (whiskersToggle) {
      whiskersToggle.addEventListener('change', () =>
        Settings.set('showWhiskers', whiskersToggle.checked));
    }
    Settings.onChange('showWhiskers', (v) => _applyShowWhiskers(v));

    // ── Nose style ───────────────────────────────────────────────────────
    const NOSE_CLASSES = ['nose-dot','nose-none'];

    function _applyNoseStyle(style) {
      document.body.classList.remove(...NOSE_CLASSES);
      if (style && style !== 'triangle') document.body.classList.add(`nose-${style}`);
      const btns = document.getElementById('nose-style-btns');
      if (btns) {
        btns.querySelectorAll('.style-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.nose === style));
      }
    }

    _applyNoseStyle(Settings.get('noseStyle') || 'triangle');

    const noseStyleBtns = document.getElementById('nose-style-btns');
    if (noseStyleBtns) {
      noseStyleBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('noseStyle', btn.dataset.nose));
      });
    }
    Settings.onChange('noseStyle', (v) => _applyNoseStyle(v));

    // ── Mouth style ──────────────────────────────────────────────────────
    const MOUTH_CLASSES = ['mouth-arc','mouth-wide','mouth-cat','mouth-flat','mouth-none',
                           'mouth-wave','mouth-perky','mouth-minimal']; // keep old names for migration

    function _applyMouthStyle(style) {
      document.body.classList.remove(...MOUTH_CLASSES);
      if (style && style !== 'arc') document.body.classList.add(`mouth-${style}`);
      const btns = document.getElementById('mouth-style-btns');
      if (btns) {
        btns.querySelectorAll('.style-chip').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.mouth === style));
      }
    }

    _applyMouthStyle(Settings.get('mouthStyle') || 'arc');

    const mouthStyleBtns = document.getElementById('mouth-style-btns');
    if (mouthStyleBtns) {
      mouthStyleBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('mouthStyle', btn.dataset.mouth));
      });
    }
    Settings.onChange('mouthStyle', (v) => _applyMouthStyle(v));

    // ── Mouth thickness ──────────────────────────────────────────────────
    const MOUTH_THICK_CLASSES = ['mouth-thin','mouth-thick'];

    function _applyMouthThickness(t) {
      document.body.classList.remove(...MOUTH_THICK_CLASSES);
      if (t && t !== 'normal') document.body.classList.add(`mouth-${t}`);
      const btns = document.getElementById('mouth-thickness-btns');
      if (btns) btns.querySelectorAll('.style-chip').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.thickness === t));
    }

    _applyMouthThickness(Settings.get('mouthThickness') || 'normal');

    const mouthThickBtns = document.getElementById('mouth-thickness-btns');
    if (mouthThickBtns) {
      mouthThickBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('mouthThickness', btn.dataset.thickness));
      });
    }
    Settings.onChange('mouthThickness', (v) => _applyMouthThickness(v));

    // ── Eye glow colour ──────────────────────────────────────────────────
    const EYE_GLOW_CLASSES = ['eye-glow-default','eye-glow-emerald','eye-glow-rose',
      'eye-glow-amber','eye-glow-sky','eye-glow-ruby','eye-glow-white','eye-glow-gold'];

    function _applyEyeGlow(g) {
      document.body.classList.remove(...EYE_GLOW_CLASSES);
      document.body.classList.add(`eye-glow-${g || 'default'}`);
      const picker = document.getElementById('eye-glow-picker');
      if (picker) picker.querySelectorAll('.glow-swatch').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.glow === (g || 'default')));
    }

    _applyEyeGlow(Settings.get('eyeGlowColor') || 'default');

    const eyeGlowPicker = document.getElementById('eye-glow-picker');
    if (eyeGlowPicker) {
      eyeGlowPicker.querySelectorAll('.glow-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          // BUG FIX: clear custom glow override so preset takes effect immediately
          if (Settings.get('customGlowHex')) {
            Settings.set('customGlowHex', '');
          }
          Settings.set('eyeGlowColor', btn.dataset.glow);
        });
      });
    }
    Settings.onChange('eyeGlowColor', (v) => _applyEyeGlow(v));

    // ── Custom iris hex picker ────────────────────────────────────────────
    const irisCustomInput  = document.getElementById('iris-custom-input');
    const irisCustomClear  = document.getElementById('iris-custom-clear');
    const irisDefaultBtn   = document.getElementById('iris-default-btn');
    const irisLayersReset  = document.getElementById('iris-layers-reset');
    const irisCustomRow    = document.getElementById('iris-custom-row');
    const irisCustomLabel  = document.getElementById('iris-custom-label');
    const IRIS_LAYER_FIELDS = [
      { key: 'customIrisCenterHex', profileKey: 'centerHex', id: 'iris-layer-center-input', rowId: 'iris-layer-center-row', labelId: 'iris-layer-center-label', label: 'Center layer' },
      { key: 'customIrisMidHex', profileKey: 'midHex', id: 'iris-layer-mid-input', rowId: 'iris-layer-mid-row', labelId: 'iris-layer-mid-label', label: 'Middle layer' },
      { key: 'customIrisEdgeHex', profileKey: 'edgeHex', id: 'iris-layer-edge-input', rowId: 'iris-layer-edge-row', labelId: 'iris-layer-edge-label', label: 'Edge layer' },
      { key: 'customIrisRingHex', profileKey: 'ringHex', id: 'iris-layer-ring-input', rowId: 'iris-layer-ring-row', labelId: 'iris-layer-ring-label', label: 'Ring accent' },
      { key: 'customIrisHighlightHex', profileKey: 'highlightHex', id: 'iris-layer-highlight-input', rowId: 'iris-layer-highlight-row', labelId: 'iris-layer-highlight-label', label: 'Highlight sparkle' },
      { key: 'customIrisPupilCoreHex', profileKey: 'pupilCoreHex', id: 'iris-layer-pupil-input', rowId: 'iris-layer-pupil-row', labelId: 'iris-layer-pupil-label', label: 'Pupil core' },
    ];

    function _readIrisProfileFromSettings() {
      const profile = {
        baseHex: Settings.get('customIrisHex') || '',
      };
      IRIS_LAYER_FIELDS.forEach(({ key, profileKey }) => {
        profile[profileKey] = Settings.get(key) || '';
      });
      return profile;
    }

    function _irisLayersActive(profile) {
      return !!(profile.centerHex || profile.midHex || profile.edgeHex
        || profile.ringHex || profile.highlightHex || profile.pupilCoreHex);
    }

    function _clearIrisLayerOverrides() {
      IRIS_LAYER_FIELDS.forEach(({ key }) => {
        if (Settings.get(key)) Settings.set(key, '');
      });
    }

    /** Reflect whether a custom iris is active in the UI row. */
    function _syncIrisCustomRow(profile) {
      if (!irisCustomRow) return;
      const active = !!profile.baseHex;
      irisCustomRow.classList.toggle('custom-active', active);
      if (irisCustomLabel) {
        if (profile.baseHex) irisCustomLabel.textContent = `Custom base: ${profile.baseHex}`;
        else irisCustomLabel.textContent = 'Custom base colour';
      }
      if (irisCustomInput && profile.baseHex) irisCustomInput.value = profile.baseHex;
    }

    function _syncIrisLayerRows(profile) {
      IRIS_LAYER_FIELDS.forEach(({ id, rowId, labelId, label, profileKey }) => {
        const value = profile[profileKey] || '';
        const input = document.getElementById(id);
        const row = document.getElementById(rowId);
        const labelEl = document.getElementById(labelId);
        const active = !!value;
        if (row) row.classList.toggle('custom-active', active);
        if (labelEl) labelEl.textContent = active ? `${label}: ${value}` : label;
        if (input && active) input.value = value;
      });
    }

    function _applyIrisProfileFromSettings() {
      const profile = _readIrisProfileFromSettings();
      if (typeof IrisColor !== 'undefined') {
        if (profile.baseHex || _irisLayersActive(profile)) {
          IrisColor.applyIrisProfile(profile);
        } else {
          IrisColor.clearIris();
        }
      }
      _syncIrisCustomRow(profile);
      _syncIrisLayerRows(profile);
    }

    // Boot state
    _applyIrisProfileFromSettings();

    if (irisCustomInput) {
      // Apply colour immediately when user picks (color input fires 'input' continuously)
      irisCustomInput.addEventListener('input', () => {
        const hex = irisCustomInput.value;
        Settings.set('customIrisHex', hex);
        // Clear preset swatch selection when custom active
        document.getElementById('eye-color-picker')
          ?.querySelectorAll('.color-swatch')
          .forEach(b => b.classList.remove('active'));
      });
    }

    if (irisCustomClear) {
      irisCustomClear.addEventListener('click', () => {
        Settings.set('customIrisHex', '');
        _clearIrisLayerOverrides();
        // Re-activate preset
        _applyEyeColor(Settings.get('eyeColor') || 'periwinkle');
      });
    }

    IRIS_LAYER_FIELDS.forEach(({ key, id }) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', () => {
        const hex = input.value;
        Settings.set(key, hex);
        document.getElementById('eye-color-picker')
          ?.querySelectorAll('.color-swatch')
          .forEach(b => b.classList.remove('active'));
      });
    });

    if (irisLayersReset) {
      irisLayersReset.addEventListener('click', () => _clearIrisLayerOverrides());
    }

    if (irisDefaultBtn) {
      irisDefaultBtn.addEventListener('click', () => {
        if ((Settings.get('eyeColor') || 'periwinkle') !== 'periwinkle') {
          Settings.set('eyeColor', 'periwinkle');
        }
        if (Settings.get('customIrisHex')) {
          Settings.set('customIrisHex', '');
        }
        _clearIrisLayerOverrides();
      });
    }

    Settings.onChange('customIrisHex', () => _applyIrisProfileFromSettings());
    Settings.onChange('customIrisCenterHex', () => _applyIrisProfileFromSettings());
    Settings.onChange('customIrisMidHex', () => _applyIrisProfileFromSettings());
    Settings.onChange('customIrisEdgeHex', () => _applyIrisProfileFromSettings());
    Settings.onChange('customIrisRingHex', () => _applyIrisProfileFromSettings());
    Settings.onChange('customIrisHighlightHex', () => _applyIrisProfileFromSettings());
    Settings.onChange('customIrisPupilCoreHex', () => _applyIrisProfileFromSettings());

    // ── Custom glow hex picker ────────────────────────────────────────────
    const glowCustomInput  = document.getElementById('glow-custom-input');
    const glowCustomClear  = document.getElementById('glow-custom-clear');
    const glowCustomRow    = document.getElementById('glow-custom-row');
    const glowCustomLabel  = document.getElementById('glow-custom-label');

    /** Reflect whether a custom glow is active in the UI row. */
    function _syncGlowCustomRow(hex) {
      if (!glowCustomRow) return;
      const active = !!(hex && hex.startsWith('#'));
      glowCustomRow.classList.toggle('custom-active', active);
      if (glowCustomLabel) glowCustomLabel.textContent = active ? `Custom: ${hex}` : 'Custom glow';
      if (glowCustomInput && active) glowCustomInput.value = hex;
    }

    // Boot state
    {
      const saved = Settings.get('customGlowHex') || '';
      _syncGlowCustomRow(saved);
    }

    if (glowCustomInput) {
      glowCustomInput.addEventListener('input', () => {
        const hex = glowCustomInput.value;
        Settings.set('customGlowHex', hex);
        // Visually deselect preset swatches
        document.getElementById('eye-glow-picker')
          ?.querySelectorAll('.glow-swatch')
          .forEach(b => b.classList.remove('active'));
      });
    }

    if (glowCustomClear) {
      glowCustomClear.addEventListener('click', () => {
        Settings.set('customGlowHex', '');
        // Re-activate preset glow
        _applyEyeGlow(Settings.get('eyeGlowColor') || 'default');
      });
    }

    Settings.onChange('customGlowHex', (v) => {
      if (typeof IrisColor !== 'undefined') {
        v ? IrisColor.applyGlow(v) : IrisColor.clearGlow();
      }
      _syncGlowCustomRow(v || '');
    });

    // ── Glow emotion sync toggle ──────────────────────────────────────────
    const glowSyncToggle = document.getElementById('glow-sync-toggle');

    function _applyGlowSync(enabled) {
      if (typeof IrisColor !== 'undefined') IrisColor.setEmotionSync(enabled);
      if (glowSyncToggle) glowSyncToggle.checked = !!enabled;
    }

    _applyGlowSync(Settings.get('glowEmotionSync') !== false);

    if (glowSyncToggle) {
      glowSyncToggle.addEventListener('change', () => {
        Settings.set('glowEmotionSync', glowSyncToggle.checked);
      });
    }

    Settings.onChange('glowEmotionSync', (v) => _applyGlowSync(v !== false));

    // ── Eye shape ────────────────────────────────────────────────────────
    const EYE_ROUND_CLASSES = ['eye-roundness-squish','eye-roundness-almond',
      'eye-roundness-droopy','eye-roundness-tall',
      'eye-roundness-soft','eye-roundness-oval']; // keep old names for migrated settings

    function _applyEyeRoundness(r) {
      document.body.classList.remove(...EYE_ROUND_CLASSES);
      if (r && r !== 'round') document.body.classList.add(`eye-roundness-${r}`);
      const btns = document.getElementById('eye-roundness-btns');
      if (btns) btns.querySelectorAll('.style-chip').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.roundness === r));
    }

    _applyEyeRoundness(Settings.get('eyeRoundness') || 'round');

    const eyeRoundBtns = document.getElementById('eye-roundness-btns');
    if (eyeRoundBtns) {
      eyeRoundBtns.querySelectorAll('.style-chip').forEach(btn => {
        btn.addEventListener('click', () => Settings.set('eyeRoundness', btn.dataset.roundness));
      });
    }
    Settings.onChange('eyeRoundness', (v) => _applyEyeRoundness(v));

    // ── Eye size slider (50–200%, 100 = default) ─────────────────────────
    const eyeSizeSlider   = document.getElementById('eye-size-slider');
    const eyeSizeSublabel = document.getElementById('eye-size-sublabel');

    const EYE_SIZE_MIN = 50;
    const EYE_SIZE_MAX = 200;

    function _applyEyeSize(pct) {
      const clampedPct = Math.max(EYE_SIZE_MIN, Math.min(EYE_SIZE_MAX, Number(pct) || 100));
      const scale = clampedPct / 100;
      document.body.style.setProperty('--eye-wrap-scale', String(scale));
      if (eyeSizeSlider)   eyeSizeSlider.value = String(clampedPct);
      if (eyeSizeSublabel) eyeSizeSublabel.textContent = `${clampedPct}%`;
    }

    _applyEyeSize(Settings.get('eyeSize') ?? 100);

    if (eyeSizeSlider) {
      eyeSizeSlider.addEventListener('input', () => {
        const clamped = Math.max(EYE_SIZE_MIN, Math.min(EYE_SIZE_MAX, Number(eyeSizeSlider.value)));
        eyeSizeSlider.value = String(clamped);
        Settings.set('eyeSize', clamped);
      });
    }
    Settings.onChange('eyeSize', (v) => _applyEyeSize(v));

    // ── Eye gap slider (2–20 vmin, default 6) ────────────────────────────
    const eyeGapSlider   = document.getElementById('eye-gap-slider');
    const eyeGapSublabel = document.getElementById('eye-gap-sublabel');

    function _applyEyeGap(vmin) {
      const v = Number(vmin) || 6;
      const eyesEl = document.querySelector('.eyes');
      if (eyesEl) eyesEl.style.setProperty('--eyes-gap', `${v}vmin`);
      if (eyeGapSlider)   eyeGapSlider.value = String(v);
      if (eyeGapSublabel) eyeGapSublabel.textContent = `${v} vmin`;
      // Re-clamp eye size after gap changes (collision prevention)
      _applyEyeSize(Settings.get('eyeSize') ?? 100);
    }

    _applyEyeGap(Settings.get('eyeGap') ?? 6);

    if (eyeGapSlider) {
      eyeGapSlider.addEventListener('input', () => {
        Settings.set('eyeGap', Number(eyeGapSlider.value));
      });
    }
    Settings.onChange('eyeGap', (v) => _applyEyeGap(v));

    // ── Iris size slider (50–130%, default 100) ───────────────────────────
    const irisSizeSlider   = document.getElementById('iris-size-slider');
    const irisSizeSublabel = document.getElementById('iris-size-sublabel');

    function _applyIrisSize(pct) {
      const min = Number(irisSizeSlider?.min ?? 50);
      const max = Number(irisSizeSlider?.max ?? 130);
      const clamped = Math.max(min, Math.min(max, Number(pct) || 100));
      const scale = clamped / 100;
      document.body.style.setProperty('--iris-scale', String(scale));
      if (irisSizeSlider)   irisSizeSlider.value = String(clamped);
      if (irisSizeSublabel) irisSizeSublabel.textContent = `${clamped}%`;
    }

    _applyIrisSize(Settings.get('irisSize') ?? 100);

    if (irisSizeSlider) {
      irisSizeSlider.addEventListener('input', () => {
        Settings.set('irisSize', Number(irisSizeSlider.value));
      });
    }
    Settings.onChange('irisSize', (v) => _applyIrisSize(v));

    // ── Iris border toggle + thickness (default ON) ────────────────────────
    const irisBorderToggle = document.getElementById('iris-border-toggle');
    const irisBorderSizeSlider = document.getElementById('iris-border-size-slider');
    const irisBorderSizeSublabel = document.getElementById('iris-border-size-sublabel');
    const IRIS_BORDER_SIZE_MIN = Number(irisBorderSizeSlider?.min ?? 50);
    const IRIS_BORDER_SIZE_MAX = Number(irisBorderSizeSlider?.max ?? 200);

    function _applyIrisBorderEnabled(enabled) {
      const isEnabled = enabled !== false;
      document.body.style.setProperty('--iris-border-enabled', isEnabled ? '1' : '0');
      if (irisBorderToggle) irisBorderToggle.checked = isEnabled;
    }

    function _applyIrisBorderThickness(pct) {
      const clamped = Math.max(IRIS_BORDER_SIZE_MIN, Math.min(IRIS_BORDER_SIZE_MAX, Number(pct) || 100));
      document.body.style.setProperty('--iris-border-thickness-scale', String(clamped / 100));
      if (irisBorderSizeSlider) irisBorderSizeSlider.value = String(clamped);
      if (irisBorderSizeSublabel) irisBorderSizeSublabel.textContent = `${clamped}%`;
    }

    _applyIrisBorderEnabled(Settings.get('irisBorderEnabled') !== false);
    _applyIrisBorderThickness(Settings.get('irisBorderThickness') ?? 100);

    if (irisBorderToggle) {
      irisBorderToggle.addEventListener('change', () => {
        Settings.set('irisBorderEnabled', irisBorderToggle.checked);
      });
    }

    if (irisBorderSizeSlider) {
      irisBorderSizeSlider.addEventListener('input', () => {
        Settings.set('irisBorderThickness', Number(irisBorderSizeSlider.value));
      });
    }

    Settings.onChange('irisBorderEnabled', (v) => _applyIrisBorderEnabled(v !== false));
    Settings.onChange('irisBorderThickness', (v) => _applyIrisBorderThickness(v));

    // ── Mouth size slider (50–150%, default 100) ─────────────────────────
    const mouthSizeSlider   = document.getElementById('mouth-size-slider');
    const mouthSizeSublabel = document.getElementById('mouth-size-sublabel');

    function _applyMouthSize(pct) {
      const scale = (Number(pct) || 100) / 100;
      document.body.style.setProperty('--mouth-scale', String(scale));
      if (mouthSizeSlider)   mouthSizeSlider.value = String(pct);
      if (mouthSizeSublabel) mouthSizeSublabel.textContent = `${pct}%`;
    }

    _applyMouthSize(Settings.get('mouthSize') ?? 100);

    if (mouthSizeSlider) {
      mouthSizeSlider.addEventListener('input', () => {
        Settings.set('mouthSize', Number(mouthSizeSlider.value));
      });
    }
    Settings.onChange('mouthSize', (v) => _applyMouthSize(v));

    // ── Nose size slider (50–150%, default 100) ───────────────────────────
    const noseSizeSlider   = document.getElementById('nose-size-slider');
    const noseSizeSublabel = document.getElementById('nose-size-sublabel');

    function _applyNoseSize(pct) {
      const scale = (Number(pct) || 100) / 100;
      document.body.style.setProperty('--nose-scale', String(scale));
      if (noseSizeSlider)   noseSizeSlider.value = String(pct);
      if (noseSizeSublabel) noseSizeSublabel.textContent = `${pct}%`;
    }

    _applyNoseSize(Settings.get('noseSize') ?? 100);

    if (noseSizeSlider) {
      noseSizeSlider.addEventListener('input', () => {
        Settings.set('noseSize', Number(noseSizeSlider.value));
      });
    }
    Settings.onChange('noseSize', (v) => _applyNoseSize(v));

    // ── Glow intensity slider (0=off 1=subtle 2=normal 3=vivid) ─────────
    const GI_VALUES = ['off', 'subtle', 'normal', 'vivid'];
    const GLOW_INT_CLASSES = ['glow-off', 'glow-subtle', 'glow-vivid'];
    const glowIntSlider = document.getElementById('glow-intensity-slider');

    function _applyGlowIntensity(g) {
      document.body.classList.remove(...GLOW_INT_CLASSES);
      if (g && g !== 'normal') document.body.classList.add(`glow-${g}`);
      // Sync slider position
      const idx = GI_VALUES.indexOf(g);
      if (glowIntSlider) glowIntSlider.value = String(idx >= 0 ? idx : 2);
      // Update mark labels
      document.querySelectorAll('.slider-mark[data-gi]').forEach(el => {
        el.classList.toggle('active', el.dataset.gi === String(idx >= 0 ? idx : 2));
      });
    }

    _applyGlowIntensity(Settings.get('glowIntensity') || 'normal');

    if (glowIntSlider) {
      glowIntSlider.addEventListener('input', () => {
        Settings.set('glowIntensity', GI_VALUES[Number(glowIntSlider.value)] || 'normal');
      });
    }
    Settings.onChange('glowIntensity', (v) => _applyGlowIntensity(v));

    // ── Theme particle effects toggle ────────────────────────────────────
    const particlesToggle = document.getElementById('theme-particles-toggle');
    if (particlesToggle) {
      particlesToggle.checked = Settings.get('themeParticles') !== false;
      particlesToggle.addEventListener('change', () => {
        Settings.set('themeParticles', particlesToggle.checked);
        ThemeCanvas.setEnabled(particlesToggle.checked);
        document.body.classList.toggle('theme-particles-off', !particlesToggle.checked);
      });
    }
    // Sync particles-off class at boot
    document.body.classList.toggle('theme-particles-off', Settings.get('themeParticles') === false);

    Settings.onChange('themeParticles', (v) => {
      if (particlesToggle) particlesToggle.checked = v !== false;
      ThemeCanvas.setEnabled(v !== false);
      document.body.classList.toggle('theme-particles-off', v === false);
    });

    // ── Buddy Theme Adaptation toggle ────────────────────────────────────
    function _applyBuddyAdapt(enabled) {
      document.body.classList.toggle('buddy-adapt', enabled !== false);
    }
    const buddyAdaptToggle = document.getElementById('buddy-adapt-toggle');
    if (buddyAdaptToggle) {
      const savedAdapt = Settings.get('buddyAdapt');
      const isOn = savedAdapt !== false; // default: ON
      buddyAdaptToggle.checked = isOn;
      _applyBuddyAdapt(isOn);
      buddyAdaptToggle.addEventListener('change', () => {
        Settings.set('buddyAdapt', buddyAdaptToggle.checked);
        _applyBuddyAdapt(buddyAdaptToggle.checked);
      });
    } else {
      // Apply default (on) even without toggle element
      _applyBuddyAdapt(Settings.get('buddyAdapt') !== false);
    }
    Settings.onChange('buddyAdapt', (v) => {
      if (buddyAdaptToggle) buddyAdaptToggle.checked = v !== false;
      _applyBuddyAdapt(v !== false);
    });

    // Also update ThemeCanvas when theme changes
    Settings.onChange('fullTheme', (v) => {
      ThemeCanvas.setTheme(v || 'galaxy');
    });

    // ── Time-of-day atmosphere ────────────────────────────────────────────
    // Only galaxy, classic, matrix are fully immune (no time canvas logic).
    // All scene themes (forest, cherry, ocean, snow, rain, dreamscape, anime, neon, cozy)
    // now implement full time-of-day in their drawBackground.
    const TIME_IMMUNE = new Set(['galaxy', 'classic', 'matrix']);

    function _getTimePeriodMain() {
      const h = new Date().getHours();
      if (h >= 5  && h < 11) return 'MORNING';
      if (h >= 11 && h < 17) return 'AFTERNOON';
      if (h >= 17 && h < 21) return 'EVENING';
      return 'NIGHT';
    }

    function _applyThemePeriod() {
      const enabled = Settings.get('themeTimeAware');
      const theme   = Settings.get('fullTheme') || 'galaxy';
      document.body.removeAttribute('data-theme-period');
      if (!enabled || TIME_IMMUNE.has(theme)) return;
      const lock   = Settings.get('themeTimeLock') || 'auto';
      const period = lock !== 'auto' ? lock : _getTimePeriodMain();
      document.body.dataset.themePeriod = period;
    }

    const themeTimeToggle   = document.getElementById('theme-time-toggle');
    const themeTimeLockSel  = document.getElementById('theme-time-lock');
    const themeTimeLockRow  = document.getElementById('theme-time-lock-row');

    if (themeTimeToggle) {
      themeTimeToggle.checked = Settings.get('themeTimeAware') || false;
      if (themeTimeLockRow) themeTimeLockRow.style.display = themeTimeToggle.checked ? '' : 'none';
      themeTimeToggle.addEventListener('change', () => {
        Settings.set('themeTimeAware', themeTimeToggle.checked);
        if (themeTimeLockRow) themeTimeLockRow.style.display = themeTimeToggle.checked ? '' : 'none';
        _applyThemePeriod();
      });
    }
    if (themeTimeLockSel) {
      themeTimeLockSel.value = Settings.get('themeTimeLock') || 'auto';
      themeTimeLockSel.addEventListener('change', () => {
        Settings.set('themeTimeLock', themeTimeLockSel.value);
        _applyThemePeriod();
      });
    }

    Settings.onChange('fullTheme', () => _applyThemePeriod());
    // Poll every 30s so smooth blend transitions stay current without reload
    setInterval(() => {
      if (Settings.get('themeTimeAware') && Settings.get('themeTimeLock') === 'auto')
        _applyThemePeriod();
    }, 30000);
    _applyThemePeriod();

    // ── SensaMode — soft solid-color theme for visual sensitivity ─────────
    // Each theme gets a soft pastel solid that replaces the animated canvas.
    const SENSA_COLORS = {
      // Each color is a distinct solid that perfectly captures the theme's soul
      galaxy:     '#050014',  // deep cosmic indigo-black
      classic:    '#0f0f0f',  // neutral near-black
      forest:     '#01100a',  // deep emerald-void
      cherry:     '#1a020e',  // midnight rose-black
      ocean:      '#000e1a',  // abyss deep-sea navy
      snow:       '#060c1e',  // crisp moonlit winter navy
      rain:       '#040a14',  // overcast slate-navy
      dreamscape: '#0a0218',  // deep surreal indigo
      anime:      '#08021a',  // rich cinematic purple-black
      matrix:     '#000601',  // phosphor green-void
      neon:       '#02000c',  // pure cyber night
      cozy:       '#120400',  // deep hearth ember-black
    };
    const SENSA_LABEL = 'SensaMode';

    function _applySensaMode() {
      const on = Settings.get('sensaMode') || false;
      document.body.classList.toggle('sensa-mode', on);
      const theme = Settings.get('fullTheme') || 'galaxy';
      if (on) {
        document.body.style.setProperty('--sensa-bg', SENSA_COLORS[theme] || '#0d0820');
      } else {
        document.body.style.removeProperty('--sensa-bg');
      }
    }

    const sensaToggle = document.getElementById('sensa-mode-toggle');
    if (sensaToggle) {
      sensaToggle.checked = Settings.get('sensaMode') || false;
      sensaToggle.addEventListener('change', () => {
        Settings.set('sensaMode', sensaToggle.checked);
        _applySensaMode();
      });
    }
    Settings.onChange('fullTheme', () => _applySensaMode());
    _applySensaMode();

    // ── Ocean bubble click ────────────────────────────────────────────────
    // Forward canvas clicks to ocean CFG for bubble-pop interaction
    const _themeCanvas = document.getElementById('theme-canvas');
    if (_themeCanvas) {
      _themeCanvas.style.pointerEvents = 'auto';
      _themeCanvas.addEventListener('click', (e) => {
        const theme = Settings.get('fullTheme') || 'galaxy';
        if (theme === 'ocean') {
          const rect = _themeCanvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          // Access ocean CFG bubble store via ThemeCanvas exposed reference
          if (window._ThemeOceanCFG && window._ThemeOceanCFG.handleClick) {
            window._ThemeOceanCFG.handleClick(x, y);
          }
        }
      });
    }

    // ── PiP always-on-top ────────────────────────────────────────────────
    const pipAotToggle = document.getElementById('pip-always-on-top-toggle');
    if (pipAotToggle) {
      pipAotToggle.checked = Settings.get('pipAlwaysOnTop') !== false;
      pipAotToggle.addEventListener('change', () => {
        Settings.set('pipAlwaysOnTop', pipAotToggle.checked);
        if (window.electronAPI && window.electronAPI.setPipAlwaysOnTop)
          window.electronAPI.setPipAlwaysOnTop(pipAotToggle.checked);
      });
    }

    // ── Appearance preset copy / paste ───────────────────────────────────
    const PRESET_KEYS = ['fullTheme','eyeColor','eyeGlowColor','eyeRoundness',
      'pupilSize','blinkRate','showEyebrows','showWhiskers','noseStyle','mouthStyle','mouthThickness',
      'glowIntensity','themeParticles','buddyAdapt','pipOpacity','pipShape','companionPos'];

    const copyPresetBtn  = document.getElementById('copy-preset-btn');
    const pastePresetBtn = document.getElementById('paste-preset-btn');
    const presetStatus   = document.getElementById('preset-status');

    function _showPresetStatus(msg, ok) {
      if (!presetStatus) return;
      presetStatus.textContent = msg;
      presetStatus.style.display = 'block';
      presetStatus.style.color = ok ? 'rgba(140,220,160,0.90)' : 'rgba(255,140,120,0.90)';
      clearTimeout(presetStatus._t);
      presetStatus._t = setTimeout(() => { presetStatus.style.display = 'none'; }, 3000);
    }

    if (copyPresetBtn) {
      copyPresetBtn.addEventListener('click', async () => {
        const preset = {};
        PRESET_KEYS.forEach(k => { preset[k] = Settings.get(k); });
        preset.__deskbuddyPreset = true;
        try {
          await navigator.clipboard.writeText(JSON.stringify(preset, null, 2));
          _showPresetStatus('✓ Preset copied to clipboard', true);
        } catch (e) {
          _showPresetStatus('Could not write to clipboard', false);
        }
      });
    }

    if (pastePresetBtn) {
      pastePresetBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          const preset = JSON.parse(text);
          if (!preset.__deskbuddyPreset) throw new Error('Not a DeskBuddy preset');
          PRESET_KEYS.forEach(k => {
            if (preset[k] !== undefined) Settings.set(k, preset[k]);
          });
          _showPresetStatus('✓ Preset applied!', true);
        } catch (e) {
          _showPresetStatus('No valid preset found in clipboard', false);
        }
      });
    }
  }

  // ── _wireBreakReminder ────────────────────────────────────────────────────
  // BreakReminder lifecycle tied to session state.

  function _wireBreakReminder() {
    Session.onSessionStateChange((newState) => {
      if (newState === 'ACTIVE') {
        // If reminder was active during a session start, dismiss it first
        if (BreakReminder.isActive()) {
          BreakReminder.dismiss();
        }
        BreakReminder.start();
      } else if (newState === 'PAUSED') {
        BreakReminder.pause();
      } else {
        // IDLE | COMPLETED | FAILED | ABANDONED
        BreakReminder.stop();
      }
    });

    // ── Break toast helpers ────────────────────────────────────────────────
    const breakToast        = document.getElementById('break-toast');
    const breakToastDismiss = document.getElementById('break-toast-dismiss');

    function _showBreakToast() {
      if (!breakToast) return;
      breakToast.classList.remove('break-toast-hiding');
      breakToast.classList.add('break-toast-visible');
    }

    function _hideBreakToast() {
      if (!breakToast) return;
      breakToast.classList.add('break-toast-hiding');
      // Wait for the slide-out animation to finish before fully hiding
      breakToast.addEventListener('animationend', (e) => {
        if (e.animationName !== 'breakToastOut') return;
        breakToast.classList.remove('break-toast-visible', 'break-toast-hiding');
      }, { once: true });
    }

    if (breakToastDismiss) {
      breakToastDismiss.addEventListener('click', () => BreakReminder.dismiss());
    }

    BreakReminder.onTrigger(() => {
      Sounds.play('break_start');
      Emotion.setState('excited');  // companion perks up: "hey, take a break!"
      _showBreakToast();
      setTimeout(() => {
        if (BreakReminder.isActive()) Emotion.setState(null);
      }, 3000);
    });

    BreakReminder.onDismiss(() => {
      Sounds.play('break_end');
      _hideBreakToast();
    });
  }

  // ── Focus trap helpers ────────────────────────────────────────────────────

  function _focusable(container) {
    return Array.from(container.querySelectorAll(
      'button, input, select, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.disabled && el.offsetParent !== null);
  }

  function _trapFocusHandler(e) {
    const panel     = document.getElementById('settings-panel');
    const focusable = _focusable(panel);
    const first     = focusable[0];
    const last      = focusable[focusable.length - 1];
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  // ── _wireDND ──────────────────────────────────────────────────────────────
  // Wire the DND Settings section: toggle button, duration selector,
  // and live UI sync when DND activates / deactivates.

  // ── Screen Time helpers ───────────────────────────────────────────────────

  /**
   * _updateDailyGoalArc()
   * Reads today's total focused time (history + live session) and renders the
   * Screen Time-style progress arc and labels in the session idle panel.
   */
  function _updateDailyGoalArc() {
    const row     = document.getElementById('sp-daily-goal-row');
    const arcFill = document.getElementById('sp-dg-fill');
    const todayEl = document.getElementById('sp-dg-today');
    const goalEl  = document.getElementById('sp-dg-goal');
    if (!row) return;

    const goalMins = Settings.get('dailyFocusGoalMins') || 0;

    if (goalMins <= 0) {
      row.style.display = 'none';
      return;
    }
    row.style.display = '';

    // Today's accumulated focus from completed/active sessions
    const history    = Session.getHistory ? Session.getHistory() : [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs    = todayStart.getTime();

    const historySecs = history.reduce((acc, s) => {
      if (!s.date || new Date(s.date).getTime() < todayMs) return acc;
      return acc + (s.actualFocusedSeconds || 0);
    }, 0);

    // Add the currently active session's live focused seconds
    const live    = Session.getCurrentStats ? Session.getCurrentStats() : null;
    const liveSecs = (live && live.state === 'ACTIVE') ? (live.focusedSeconds || 0) : 0;

    const totalSecs = historySecs + liveSecs;
    const totalMins = Math.floor(totalSecs / 60);

    // Format label: "1h 25m today"
    const th = Math.floor(totalMins / 60);
    const tm = totalMins % 60;
    const timeStr = th > 0 ? (tm > 0 ? `${th}h ${tm}m` : `${th}h`) : `${tm}m`;
    if (todayEl) todayEl.textContent = `${timeStr} today`;

    // Goal label: "/ 2h goal"
    const gh = Math.floor(goalMins / 60);
    const gm = goalMins % 60;
    const goalStr = gh > 0 ? (gm > 0 ? `${gh}h ${gm}m` : `${gh}h`) : `${gm}m`;
    if (goalEl) goalEl.textContent = `/ ${goalStr} goal`;

    // Arc fill: circumference = 2π × 18 ≈ 113.1
    const CIRC     = 113.1;
    const fraction = Math.min(1, totalMins / goalMins);
    if (arcFill) {
      arcFill.style.strokeDasharray  = String(CIRC);
      arcFill.style.strokeDashoffset = String(CIRC * (1 - fraction));
      arcFill.classList.toggle('sp-dg-fill-done', fraction >= 1);
    }
    row.classList.toggle('goal-reached', fraction >= 1);

    // Celebrate the moment the goal is first reached today
    if (fraction >= 1 && !_dailyGoalCelebratedToday) {
      _dailyGoalCelebratedToday = true;
      _fireDailyGoalReached();
    }
  }

  let _dailyGoalCelebratedToday = (() => {
    // Reset on new day
    const key = 'deskbuddy_goal_celebrated';
    const stored = sessionStorage.getItem(key);
    const today = new Date().toDateString();
    if (stored === today) return true;
    // On each init, clear stale date and return false so goal can re-celebrate
    sessionStorage.removeItem(key);
    return false;
  })();

  function _fireDailyGoalReached() {
    sessionStorage.setItem('deskbuddy_goal_celebrated', new Date().toDateString());

    const badge = document.getElementById('milestone-badge');
    if (badge) {
      badge.textContent = '🎯 daily goal reached!';
      badge.classList.add('visible');
      setTimeout(() => badge.classList.remove('visible'), 4500);
    }

    if (typeof Sounds !== 'undefined')    Sounds.play('overjoyed_chirp');
    if (typeof Emotion !== 'undefined')   Emotion.preview('overjoyed', 3500);
    if (typeof Particles !== 'undefined') {
      for (let i = 0; i < 12; i++) {
        setTimeout(() => Particles.spawn('excited'), i * 60);
      }
    }
  }

  /**
   * _renderBudgetDots(used, budget)
   * Renders the distraction budget dot row in the active session panel.
   * Green dots = remaining; red dots = used; nothing shown if budget = 0.
   */
  function _renderBudgetDots(used, budget) {
    const row       = document.getElementById('sp-budget-row');
    const dotsEl    = document.getElementById('sp-budget-dots');
    const countEl   = document.getElementById('sp-budget-count');
    if (!row) return;

    if (!budget || budget <= 0) {
      row.style.display = 'none';
      return;
    }
    row.style.display = '';

    if (dotsEl) {
      dotsEl.innerHTML = '';
      const MAX_DOTS = Math.min(budget, 10); // cap visual dots at 10
      for (let i = 0; i < MAX_DOTS; i++) {
        const dot = document.createElement('div');
        dot.className = 'sp-budget-dot' +
          (i < used && used > budget  ? ' over' :
           i < used                   ? ' used' : '');
        dotsEl.appendChild(dot);
      }
    }

    const remaining = Math.max(0, budget - used);
    if (countEl) {
      countEl.textContent = `${remaining}/${budget}`;
      countEl.style.color = remaining === 0
        ? 'rgba(255, 90, 90, 0.80)'
        : remaining <= Math.ceil(budget * 0.4)
          ? 'rgba(255, 190, 60, 0.80)'
          : 'rgba(200, 220, 255, 0.55)';
    }
  }

  /**
   * _fireBudgetExceeded()
   * Flash a warning when the user has used all distraction budget slots.
   */
  function _fireBudgetExceeded() {
    const row = document.getElementById('sp-budget-row');
    if (row) {
      row.classList.remove('budget-exceeded');
      // Force reflow to restart animation
      void row.offsetWidth;
      row.classList.add('budget-exceeded');
    }

    if (typeof Sounds !== 'undefined')  Sounds.play('pouty_mweh');
    if (typeof Emotion !== 'undefined') Emotion.preview('pouty', 2200);

    const badge = document.getElementById('milestone-badge');
    if (badge) {
      badge.textContent = '⚠ distraction budget spent';
      badge.classList.add('visible');
      setTimeout(() => badge.classList.remove('visible'), 3000);
    }
  }

  /**
   * _getWeekBounds(weeksAgo)
   * Returns { start, end } for a calendar week (Mon–Sun) N weeks in the past.
   */
  function _getWeekBounds(weeksAgo) {
    const now     = new Date();
    const dow     = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
    const monday  = new Date(now);
    monday.setDate(now.getDate() - dow - weeksAgo * 7);
    monday.setHours(0, 0, 0, 0);
    const sunday  = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }

  /**
   * _checkWeeklyReport()
   * Shows the weekly report modal once per calendar week (Mon–Sun).
   * Report covers the previous completed week. Skips if no sessions that week.
   */
  function _checkWeeklyReport() {
    const now     = new Date();
    const dow     = (now.getDay() + 6) % 7;
    const monday  = new Date(now);
    monday.setDate(now.getDate() - dow);
    monday.setHours(0, 0, 0, 0);
    const thisWeekKey = monday.toDateString();

    const lastShown = Settings.get('weeklyReportLastShown') || '';
    if (lastShown === thisWeekKey) return; // already shown this week

    const history = Session.getHistory ? Session.getHistory() : [];
    if (!history.length) return;

    // Get previous week sessions
    const prev = _getWeekBounds(1);
    const prevSessions = history.filter(s => {
      if (!s.date) return false;
      const t = new Date(s.date).getTime();
      return t >= prev.start.getTime() && t <= prev.end.getTime();
    });

    if (!prevSessions.length) return; // nothing to report

    // Mark as shown for this week
    Settings.set('weeklyReportLastShown', thisWeekKey);

    // Populate and show the modal (slight delay so history panel animates in first)
    setTimeout(() => _showWeeklyReport(prevSessions, prev.start, prev.end, history), 500);
  }

  function _showWeeklyReport(sessions, weekStart, weekEnd, allHistory) {
    const modal = document.getElementById('weekly-report-modal');
    if (!modal) return;

    // Date range label: "Apr 7 – Apr 13"
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmtDate = d => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const dateRangeEl = document.getElementById('wr-date-range');
    if (dateRangeEl) dateRangeEl.textContent = `${fmtDate(weekStart)} – ${fmtDate(weekEnd)}`;

    // Total focus time
    const totalSecs = sessions.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0);
    const totalMins = Math.floor(totalSecs / 60);
    const th = Math.floor(totalMins / 60);
    const tm = totalMins % 60;
    const timeStr = th > 0 ? (tm > 0 ? `${th}h ${tm}m` : `${th}h`) : `${tm}m`;
    const totalEl = document.getElementById('wr-total-time');
    if (totalEl) totalEl.textContent = totalMins > 0 ? timeStr : '0m';

    // Comparison: previous-previous week
    const pp = _getWeekBounds(2);
    const ppSessions = allHistory.filter(s => {
      if (!s.date) return false;
      const t = new Date(s.date).getTime();
      return t >= pp.start.getTime() && t <= pp.end.getTime();
    });
    const ppSecs = ppSessions.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0);
    const changeEl = document.getElementById('wr-change');
    if (changeEl) {
      const diffMins = Math.round((totalSecs - ppSecs) / 60);
      const dh = Math.floor(Math.abs(diffMins) / 60);
      const dm = Math.abs(diffMins) % 60;
      const diffStr = dh > 0 ? (dm > 0 ? `${dh}h ${dm}m` : `${dh}h`) : `${dm}m`;
      if (diffMins > 5) {
        changeEl.textContent = `↑ ${diffStr} more than last week`;
        changeEl.className   = 'wr-change up';
      } else if (diffMins < -5) {
        changeEl.textContent = `↓ ${diffStr} less than last week`;
        changeEl.className   = 'wr-change down';
      } else {
        changeEl.textContent = '→ similar to last week';
        changeEl.className   = 'wr-change same';
      }
    }

    // Sessions count
    const sessionsEl = document.getElementById('wr-sessions');
    if (sessionsEl) sessionsEl.textContent = String(sessions.length);

    // Average focus score
    const completed = sessions.filter(s => s.outcome === 'COMPLETED');
    let avgScore = null;
    if (completed.length) {
      const sum = completed.reduce((acc, s) => {
        const total   = (s.durationMinutes || 0) * 60;
        const focused = s.actualFocusedSeconds || 0;
        return acc + (total > 0 ? (focused / total) * 100 : 0);
      }, 0);
      avgScore = Math.round(sum / completed.length);
    }
    const avgEl = document.getElementById('wr-avg-focus');
    if (avgEl) avgEl.textContent = avgScore !== null ? `${avgScore}%` : '—';

    // Best day
    const byDay = {};
    sessions.forEach(s => {
      if (!s.date) return;
      const d   = new Date(s.date);
      const key = d.toDateString();
      byDay[key] = (byDay[key] || 0) + (s.actualFocusedSeconds || 0);
    });
    let bestDay = null, bestDaySecs = 0;
    Object.entries(byDay).forEach(([day, secs]) => {
      if (secs > bestDaySecs) { bestDaySecs = secs; bestDay = new Date(day); }
    });
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const bestDayEl = document.getElementById('wr-best-day');
    if (bestDayEl) bestDayEl.textContent = bestDay ? DAYS[bestDay.getDay()] : '—';

    // Top category
    const CATEGORY_EMOJI = { study: '📚', work: '💼', creative: '🎨', reading: '📖', other: '⚙️' };
    const catCounts = {};
    sessions.forEach(s => {
      const c = s.category || 'other';
      catCounts[c] = (catCounts[c] || 0) + 1;
    });
    let topCat = null, topCatCount = 0;
    Object.entries(catCounts).forEach(([cat, cnt]) => {
      if (cnt > topCatCount) { topCatCount = cnt; topCat = cat; }
    });
    const topCatEl = document.getElementById('wr-top-cat');
    if (topCatEl) {
      topCatEl.textContent = topCat
        ? `${CATEGORY_EMOJI[topCat] || '⚙️'} ${topCat}`
        : '—';
    }

    // Wire close button (once)
    const closeBtn = document.getElementById('wr-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.setAttribute('aria-hidden', 'true');
      };
    }

    // Show
    modal.setAttribute('aria-hidden', 'false');
  }

  function _wireDND() {
    const toggleBtn  = document.getElementById('dnd-toggle-btn');
    const durSelect  = document.getElementById('dnd-duration-select');
    const durRow     = document.getElementById('dnd-duration-row');

    // Populate duration select from saved setting
    const savedDur = Settings.get('dndDuration') || 25;
    if (durSelect) durSelect.value = String(savedDur);

    // Persist chosen duration in Settings whenever it changes
    if (durSelect) {
      durSelect.addEventListener('change', () => {
        Settings.set('dndDuration', parseInt(durSelect.value, 10));
      });
    }

    function _syncDNDBtn() {
      if (!toggleBtn) return;
      const on = DND.isActive();
      toggleBtn.textContent = on ? 'cancel' : 'start';
      toggleBtn.classList.toggle('dnd-btn-active', on);
      if (durRow) durRow.style.opacity = on ? '0.45' : '1';
      if (durSelect) durSelect.disabled = on;
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const dur = parseInt(durSelect?.value || '25', 10);
        DND.toggle(dur);
      });
    }

    DND.onActivate(() => _syncDNDBtn());
    DND.onDeactivate(() => _syncDNDBtn());
    _syncDNDBtn();  // set initial state
  }

  // ── _wireSidebar ──────────────────────────────────────────────────────────
  // Auto-hide session sidebar: hover the brain icon to slide the panel in;
  // leave the panel to slide it away.
  // The brain icon fades out when the panel is open so it doesn't overlap.
  // History is now in a separate #history-panel triggered by #hp-icon.

  function _wireSidebar() {
    const panel = document.getElementById('session-panel');
    const icon  = document.getElementById('sp-icon');
    if (!panel) return;

    let _hideTimer = null;

    function _open() {
      if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
      panel.classList.add('sidebar-open');
      if (icon) icon.classList.add('sp-icon-hidden');
    }

    function _scheduleClose() {
      if (_hideTimer) return;
      _hideTimer = setTimeout(() => {
        _hideTimer = null;
        // Don't close while the user has keyboard focus inside the panel
        // (e.g. typing in the goal input — mouse may have drifted out)
        if (panel.contains(document.activeElement)) return;
        panel.classList.remove('sidebar-open');
        if (icon) icon.classList.remove('sp-icon-hidden');
      }, 380);
    }

    // Only the brain icon opens the panel
    if (icon) icon.addEventListener('mouseenter', _open);

    // Keep open while mouse is inside the panel
    panel.addEventListener('mouseenter', () => {
      if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    });

    // Cancel any pending close the moment focus enters the panel
    panel.addEventListener('focusin', () => {
      if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    });

    // Schedule close when mouse leaves the panel
    panel.addEventListener('mouseleave', _scheduleClose);
  }

  // ── _wireHistorySidebar ───────────────────────────────────────────────────
  // History panel is now a separate #history-panel sidebar triggered by #hp-icon.

  function _wireHistorySidebar() {
    // Init pill clicks, calendar mode buttons, and context menu inside the
    // history card.
    HistoryPanel.init();

    const panel = document.getElementById('history-panel');
    const icon  = document.getElementById('hp-icon');
    if (!panel || !icon) return;

    function _openHistory() {
      panel.classList.add('hp-panel-open');
      icon.classList.add('hp-icon-hidden');
      requestAnimationFrame(() => {
        if (typeof HistoryPanel !== 'undefined') HistoryPanel.refresh();
      });
    }

    function _closeHistory() {
      panel.classList.remove('hp-panel-open');
      icon.classList.remove('hp-icon-hidden');
    }

    function _toggleHistory() {
      if (panel.classList.contains('hp-panel-open')) {
        _closeHistory();
      } else {
        _openHistory();
      }
    }

    // Click-to-toggle: open/close on icon click
    icon.addEventListener('click', _toggleHistory);

    // Close when clicking outside the panel (but not the icon itself)
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('hp-panel-open')) return;
      if (panel.contains(e.target) || e.target === icon || icon.contains(e.target)) return;
      _closeHistory();
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('hp-panel-open')) {
        _closeHistory();
      }
    });
  }

})();
