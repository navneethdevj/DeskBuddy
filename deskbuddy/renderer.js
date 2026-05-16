/**
 * ThemeCanvas — canvas-based particle effects for animated full-screen themes.
 * Themes: galaxy (meteors), forest (leaves), cherry/sakura (petals),
 *         ocean (bubbles), sunset (embers), aurora (glows), midnight (snow).
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
      const t = _frame * 0.012;

      // ── 1. Sky through the forest tunnel ──────────────────────────────────
      const SKY = {
        MORNING:   { t:[255,225,170], b:[195,230,185], cg:[255,248,220,0.55] },
        AFTERNOON: { t:[140,195,245], b:[215,238,200], cg:[220,248,255,0.30] },
        EVENING:   { t:[55, 38, 120], b:[110,80, 165], cg:[80,60,140,0.40] },
        NIGHT:     { t:[12, 10,  38], b:[28, 25,  75], cg:[20,15,55,0.25] },
      };
      const sk = SKY[period] || SKY.AFTERNOON;

      // Sky gradient in center tunnel opening
      const skyG = ctx.createRadialGradient(W*0.5, H*0.38, 0, W*0.5, H*0.38, W*0.55);
      skyG.addColorStop(0,   _rgb(sk.t, 1.0));
      skyG.addColorStop(0.55, _rgb(sk.b, 0.90));
      skyG.addColorStop(1,   _rgb(sk.t, 0));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // Base ground ambient
      const groundAmb = ctx.createLinearGradient(0, H*0.45, 0, H);
      if (period === 'EVENING' || period === 'NIGHT') {
        groundAmb.addColorStop(0, 'rgba(28,18,48,0)');
        groundAmb.addColorStop(1, 'rgba(8,6,22,0.88)');
      } else if (period === 'MORNING') {
        groundAmb.addColorStop(0, 'rgba(60,55,30,0)');
        groundAmb.addColorStop(1, 'rgba(28,22,12,0.78)');
      } else {
        groundAmb.addColorStop(0, 'rgba(32,42,20,0)');
        groundAmb.addColorStop(1, 'rgba(12,18,8,0.82)');
      }
      ctx.fillStyle = groundAmb; ctx.fillRect(0, H*0.45, W, H*0.55);

      // ── 2. Distant hills through gap ─────────────────────────────────────
      if (period !== 'NIGHT') {
        const hillColors = {
          MORNING:   [[148,175,130,0.55],[118,148,108,0.45],[90,120,85,0.40]],
          AFTERNOON: [[118,168,110,0.60],[95,145,90,0.50],[72,118,68,0.45]],
          EVENING:   [[68,72,95,0.55],[52,58,88,0.50],[38,42,72,0.45]],
        };
        const hc = hillColors[period] || hillColors.AFTERNOON;
        [0, 1, 2].forEach(li => {
          const baseY = H*(0.48 + li*0.055);
          ctx.beginPath();
          ctx.moveTo(W*0.18, H);
          for (let xi = 0; xi <= 16; xi++) {
            const fx = W*0.18 + xi*(W*0.64/16);
            const fy = baseY - H*0.08*Math.sin(xi*0.55+li*1.2+1.5) - H*0.04*Math.sin(xi*1.1+li*0.8);
            xi===0 ? ctx.moveTo(fx,fy) : ctx.lineTo(fx,fy);
          }
          ctx.lineTo(W*0.82, H); ctx.lineTo(W*0.18, H); ctx.closePath();
          const [r,g,b,a] = hc[li];
          ctx.fillStyle = `rgba(${r},${g},${b},${a})`; ctx.fill();
        });
      }

      // ── 3. Morning sun glow through center ────────────────────────────────
      if (period === 'MORNING') {
        const sunG = ctx.createRadialGradient(W*0.5, H*0.42, 0, W*0.5, H*0.42, W*0.38);
        sunG.addColorStop(0,   'rgba(255,248,200,0.72)');
        sunG.addColorStop(0.25,'rgba(255,228,150,0.38)');
        sunG.addColorStop(0.55,'rgba(230,200,120,0.12)');
        sunG.addColorStop(1,   'rgba(200,175,100,0)');
        ctx.fillStyle = sunG; ctx.fillRect(0, 0, W, H);

        // Diagonal light shafts
        for (let i = 0; i < 5; i++) {
          const shx = W*(0.32 + i*0.09) + Math.sin(t*0.4+i)*W*0.02;
          const sha = 0.06 + 0.04*Math.sin(t*0.7+i*1.3);
          ctx.save();
          const sg = ctx.createLinearGradient(shx, 0, shx+W*0.018, H*0.8);
          sg.addColorStop(0, `rgba(255,240,180,${sha*1.8})`);
          sg.addColorStop(0.5, `rgba(255,235,165,${sha*0.8})`);
          sg.addColorStop(1, 'rgba(255,228,150,0)');
          ctx.fillStyle = sg;
          ctx.beginPath();
          ctx.moveTo(shx-W*0.01, 0);
          ctx.lineTo(shx+W*0.03, 0);
          ctx.lineTo(shx+W*0.05, H*0.85);
          ctx.lineTo(shx+W*0.02, H*0.85);
          ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }

      // ── 4. Evening / Night bioluminescence ───────────────────────────────
      if (period === 'EVENING' || period === 'NIGHT') {
        this._spores.forEach(sp => {
          sp.phase += sp.spd;
          const pulse = 0.5 + 0.5*Math.sin(sp.phase);
          const a = (period === 'NIGHT' ? 0.55 : 0.35) * pulse;
          const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sp.r*4.5);
          g.addColorStop(0, `hsla(${sp.hue},90%,75%,${a*2.8})`);
          g.addColorStop(0.45, `hsla(${sp.hue},80%,55%,${a*0.9})`);
          g.addColorStop(1, `hsla(${sp.hue},65%,35%,0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r*4.5, 0, Math.PI*2); ctx.fill();
        });
      }

      // ── 5. Ground path (dirt trail) ────────────────────────────────────────
      ctx.save();
      // Path shape: trapezoid narrowing to center
      const pathG = ctx.createLinearGradient(0, H*0.60, 0, H);
      if (period === 'MORNING') {
        pathG.addColorStop(0, 'rgba(125,100,62,0.55)');
        pathG.addColorStop(1, 'rgba(88,68,40,0.80)');
      } else if (period === 'EVENING' || period === 'NIGHT') {
        pathG.addColorStop(0, 'rgba(38,32,48,0.72)');
        pathG.addColorStop(1, 'rgba(18,15,28,0.88)');
      } else {
        pathG.addColorStop(0, 'rgba(105,82,52,0.60)');
        pathG.addColorStop(1, 'rgba(68,52,32,0.82)');
      }
      ctx.fillStyle = pathG;
      ctx.beginPath();
      ctx.moveTo(W*0.35, H*0.62); ctx.lineTo(W*0.65, H*0.62);
      ctx.lineTo(W*0.80, H);       ctx.lineTo(W*0.20, H);
      ctx.closePath(); ctx.fill();

      // Path stones/texture hints
      if (period !== 'NIGHT') {
        ctx.globalAlpha = 0.25;
        for (let si = 0; si < 12; si++) {
          const sx = W*(0.22 + (si%4)*0.14) + Math.sin(si*2.3)*W*0.04;
          const sy = H*(0.68 + Math.floor(si/4)*0.10);
          const sr = W*0.022;
          ctx.fillStyle = si%3===0 ? 'rgba(145,120,85,1)' : 'rgba(115,95,65,1)';
          ctx.beginPath();
          ctx.ellipse(sx, sy, sr, sr*0.55, (si%3-1)*0.3, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // ── 6. Ground flora ───────────────────────────────────────────────────
      this._groundFlora.forEach(fl => {
        fl.phase += fl.spd;
        const sway = Math.sin(fl.phase) * fl.sz * 0.15;
        ctx.save(); ctx.globalAlpha = 0.82;
        if (fl.type === 'flower') {
          const fc = period === 'EVENING' || period === 'NIGHT'
            ? `hsl(${fl.hue+150},85%,65%)` : `hsl(${fl.hue-20},90%,72%)`;
          ctx.fillStyle = fc;
          for (let pi = 0; pi < 5; pi++) {
            const pa = (pi/5)*Math.PI*2 + fl.rot;
            const px = fl.x + Math.cos(pa)*fl.sz*0.55 + sway;
            const py = fl.y + Math.sin(pa)*fl.sz*0.38;
            ctx.beginPath(); ctx.arc(px, py, fl.sz*0.28, 0, Math.PI*2); ctx.fill();
          }
          ctx.fillStyle = period === 'EVENING' ? 'rgba(255,200,80,0.9)' : 'rgba(255,255,200,0.95)';
          ctx.beginPath(); ctx.arc(fl.x+sway, fl.y, fl.sz*0.18, 0, Math.PI*2); ctx.fill();
        } else if (fl.type === 'fern') {
          ctx.strokeStyle = `hsl(${fl.hue},${65}%,${period==='NIGHT'?18:32}%)`;
          ctx.lineWidth = Math.max(1, fl.sz*0.06);
          for (let fi = 0; fi < 7; fi++) {
            const fa = fl.rot + (fi-3)*0.22;
            const len = fl.sz*(0.6+fi*0.05);
            ctx.beginPath();
            ctx.moveTo(fl.x+sway, fl.y);
            ctx.quadraticCurveTo(fl.x+Math.sin(fa)*len*0.5+sway, fl.y-len*0.5,
              fl.x+Math.sin(fa)*len+sway*1.5, fl.y-len);
            ctx.stroke();
          }
        } else {
          // leaf cluster
          ctx.fillStyle = `hsl(${fl.hue},${58+Math.random()*20|0}%,${period==='NIGHT'?16:28}%)`;
          for (let li = 0; li < 3; li++) {
            const la = fl.rot + (li-1)*0.45;
            ctx.save(); ctx.translate(fl.x+sway, fl.y); ctx.rotate(la);
            ctx.beginPath();
            ctx.ellipse(0, -fl.sz*0.45, fl.sz*0.18, fl.sz*0.42, 0, 0, Math.PI*2);
            ctx.fill(); ctx.restore();
          }
        }
        ctx.restore();
      });

      // ── 7. Large ancient tree trunks (L + R) ──────────────────────────────
      ['L','R'].forEach(side => {
        const trunks = this._trunks[side];
        trunks.forEach((tr, ti) => {
          // Trunk fill — bark gradient
          const barkL = side==='L' ? tr.bx - tr.w1*0.5 : tr.bx - tr.w1*0.5;
          const barkR = side==='L' ? tr.bx + tr.w1*0.5 : tr.bx + tr.w1*0.5;
          const barkG = ctx.createLinearGradient(barkL, 0, barkR, 0);
          if (period === 'MORNING') {
            barkG.addColorStop(0, 'rgba(52,35,18,1)');
            barkG.addColorStop(0.35, 'rgba(78,55,28,1)');
            barkG.addColorStop(0.65, 'rgba(88,62,32,1)');
            barkG.addColorStop(1, 'rgba(42,28,12,1)');
          } else if (period === 'EVENING' || period === 'NIGHT') {
            barkG.addColorStop(0, 'rgba(22,16,8,1)');
            barkG.addColorStop(0.4, 'rgba(38,28,14,1)');
            barkG.addColorStop(1, 'rgba(12,8,4,1)');
          } else {
            barkG.addColorStop(0, 'rgba(42,28,14,1)');
            barkG.addColorStop(0.4, 'rgba(68,48,24,1)');
            barkG.addColorStop(0.7, 'rgba(75,52,26,1)');
            barkG.addColorStop(1, 'rgba(32,20,8,1)');
          }
          ctx.save();
          ctx.fillStyle = barkG;
          // Organic trunk silhouette using cubic bezier
          const sign = side==='L' ? 1 : -1;
          const cx = tr.bx;
          ctx.beginPath();
          // Left edge of trunk
          ctx.moveTo(cx - tr.w1*0.5, tr.by);
          ctx.bezierCurveTo(
            cx - tr.w1*0.5 + sign*W*0.01, tr.by - H*0.25,
            cx - tr.w2*0.5 + sign*W*0.005, tr.ty + H*0.3,
            cx - tr.w2*0.5, tr.ty
          );
          // Right edge of trunk
          ctx.lineTo(cx + tr.w2*0.5, tr.ty);
          ctx.bezierCurveTo(
            cx + tr.w2*0.5 - sign*W*0.005, tr.ty + H*0.3,
            cx + tr.w1*0.5 - sign*W*0.01, tr.by - H*0.25,
            cx + tr.w1*0.5, tr.by
          );
          ctx.closePath(); ctx.fill();

          // Bark texture strips
          if (period !== 'NIGHT') {
            ctx.globalAlpha = 0.18;
            ctx.strokeStyle = ti===0 ? 'rgba(200,160,90,1)' : 'rgba(180,140,75,1)';
            ctx.lineWidth = 1.5;
            for (let bk = 0; bk < 5; bk++) {
              const by2 = H*(0.25 + bk*0.14);
              const bw = tr.w1*_lrp(0.95, 0.4, by2/H);
              ctx.beginPath();
              ctx.moveTo(cx - bw*0.45, by2);
              ctx.quadraticCurveTo(cx+sign*bw*0.08, by2 - H*0.02, cx+bw*0.38, by2+H*0.01);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }

          // Root protrusions at base
          ctx.fillStyle = barkG;
          for (let ri = 0; ri < 3; ri++) {
            const rx = cx + (ri-1)*tr.w1*0.32 + side==='L'?-tr.w1*0.08:tr.w1*0.08;
            ctx.beginPath();
            ctx.moveTo(rx, H);
            ctx.bezierCurveTo(rx-tr.w1*0.15, H*0.88, rx-tr.w1*0.05, H*0.80, rx+sign*tr.w1*0.12, H*0.78);
            ctx.lineTo(rx+sign*tr.w1*0.22, H);
            ctx.closePath(); ctx.fill();
          }
          ctx.restore();
        });
      });

      // ── 8. Hanging vines ──────────────────────────────────────────────────
      this._vines.forEach(v => {
        v.sway += v.swSpd;
        const sw = Math.sin(v.sway) * v.swAmp;
        ctx.save();
        ctx.strokeStyle = v.col; ctx.lineWidth = v.w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(v.sx, v.sy);
        const mid = v.sy + v.length * 0.55;
        ctx.bezierCurveTo(v.sx+sw*0.4, v.sy+v.length*0.25,
          v.sx+sw, mid, v.sx+sw*1.2, v.sy+v.length);
        ctx.stroke();
        // Small leaf nodes along vine
        ctx.fillStyle = `hsl(${110+Math.random()*35|0},55%,${period==='NIGHT'?15:28}%)`;
        for (let lni = 1; lni < 4; lni++) {
          const lny = v.sy + v.length*(lni/4);
          const lnx = v.sx + sw*(lni/4);
          ctx.save(); ctx.translate(lnx, lny); ctx.rotate((Math.random()-0.5)*1.2);
          ctx.beginPath(); ctx.ellipse(0,0,v.w*2.5,v.w*1.2,0.4,0,Math.PI*2); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      });

      // ── 9. Leaf canopy arch overhead ──────────────────────────────────────
      const canopyHue = period==='MORNING' ? 95 : period==='EVENING'||period==='NIGHT' ? 128 : 108;
      const canopyLight = period==='MORNING' ? 32 : period==='EVENING' ? 20 : period==='NIGHT' ? 12 : 28;
      for (let pass = 0; pass < 3; pass++) {
        ctx.save();
        ctx.fillStyle = `hsla(${canopyHue-pass*8},${68-pass*8}%,${canopyLight+pass*4}%,${0.88-pass*0.18})`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        // Draw left canopy mass
        ctx.bezierCurveTo(W*0.05, H*(-0.05+pass*0.02), W*0.18, H*(0.08+pass*0.04), W*(0.22+pass*0.02), H*(0.18+pass*0.06));
        ctx.lineTo(W*(0.30+pass*0.03), H*(0.10+pass*0.04));
        ctx.bezierCurveTo(W*(0.35+pass*0.03), H*(0.04+pass*0.02), W*(0.42+pass*0.02), H*(0.0+pass*0.01), W*0.5, H*(-0.02+pass*0.03));
        ctx.bezierCurveTo(W*(0.58-pass*0.02), H*(0.0+pass*0.01), W*(0.65-pass*0.03), H*(0.04+pass*0.02), W*(0.70-pass*0.03), H*(0.10+pass*0.04));
        ctx.lineTo(W*(0.78-pass*0.02), H*(0.18+pass*0.06));
        ctx.bezierCurveTo(W*(0.82-pass*0.02), H*(0.08+pass*0.04), W*0.95, H*(-0.05+pass*0.02), W, 0);
        ctx.lineTo(W, -10); ctx.lineTo(0, -10); ctx.closePath();
        ctx.fill(); ctx.restore();
      }

      // Canopy depth with leaf-dapple
      if (period !== 'NIGHT') {
        ctx.save(); ctx.globalAlpha = 0.22;
        for (let dap = 0; dap < 18; dap++) {
          const dx = W*(0.02 + dap*0.054);
          const dy = H*(0.0 + 0.14*Math.sin(dap*0.8+t*0.5));
          const dr = W*0.025 + Math.sin(dap*1.7)*W*0.01;
          const dayCol = period==='MORNING' ? `rgba(200,235,130,1)` : `rgba(160,218,100,1)`;
          ctx.fillStyle = dayCol;
          ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }

      // ── 10. Evening/Night fireflies ────────────────────────────────────────
      if (period === 'EVENING' || period === 'NIGHT') {
        const ffCount = period === 'NIGHT' ? 30 : 18;
        for (let ff = 0; ff < ffCount; ff++) {
          const ffx = W*((ff*0.137 + Math.sin(t+ff*1.3)*0.06 + 1) % 1);
          const ffy = H*(0.28 + 0.62*((ff*0.211 + Math.cos(t*0.62+ff*0.88)*0.05 + 1) % 1));
          const ffa = Math.max(0, 0.08 + 0.28*Math.sin(t*1.8+ff*2.3));
          const ffG = ctx.createRadialGradient(ffx, ffy, 0, ffx, ffy, 7);
          ffG.addColorStop(0, `rgba(210,255,160,${ffa*3.5})`);
          ffG.addColorStop(0.45, `rgba(120,240,90,${ffa*1.5})`);
          ffG.addColorStop(1, 'rgba(55,200,60,0)');
          ctx.fillStyle = ffG; ctx.beginPath(); ctx.arc(ffx, ffy, 7, 0, Math.PI*2); ctx.fill();
        }
      }

      // ── 11. Side vignette (tree edge darkening) ────────────────────────────
      const vigL = ctx.createLinearGradient(0, 0, W*0.28, 0);
      vigL.addColorStop(0, 'rgba(4,8,2,0.88)'); vigL.addColorStop(1, 'rgba(4,8,2,0)');
      const vigR = ctx.createLinearGradient(W, 0, W*0.72, 0);
      vigR.addColorStop(0, 'rgba(4,8,2,0.88)'); vigR.addColorStop(1, 'rgba(4,8,2,0)');
      ctx.fillStyle = vigL; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = vigR; ctx.fillRect(0, 0, W, H);
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
      const t = _frame * 0.010;

      // ── 1. Sky gradient ────────────────────────────────────────────────────
      const SKYP = {
        MORNING:   { t:[205,170,225], m:[245,195,210], b:[255,220,200] },
        AFTERNOON: { t:[88, 155,240], m:[155,205,255], b:[210,235,255] },
        EVENING:   { t:[45, 32, 110], m:[120,75, 150], b:[210,105,138] },
        NIGHT:     { t:[12, 10,  42], m:[28,  22, 72], b:[55,  38,  95] },
      };
      const sk = SKYP[period] || SKYP.AFTERNOON;
      const skyG = ctx.createLinearGradient(0, 0, 0, H*0.65);
      skyG.addColorStop(0, _rgb(sk.t));
      skyG.addColorStop(0.45, _rgb(sk.m));
      skyG.addColorStop(1, _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Stars (night/late evening) ─────────────────────────────────────
      if (period === 'NIGHT' || period === 'EVENING') {
        const starAlpha = period === 'NIGHT' ? 1.0 : 0.4;
        this._stars.forEach(s => {
          s.phase += s.spd;
          const sa = s.alpha * starAlpha * (0.35 + 0.65*Math.sin(s.phase));
          ctx.save(); ctx.globalAlpha = sa;
          ctx.fillStyle = 'rgba(255,240,255,1)';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        });
      }

      // ── 3. Soft morning/afternoon clouds ──────────────────────────────────
      if (period === 'MORNING' || period === 'AFTERNOON') {
        this._clouds.forEach(c => {
          c.phase += c.spd;
          const pulse = 0.8 + 0.2*Math.sin(c.phase);
          ctx.save(); ctx.globalAlpha = c.alpha * pulse;
          const cg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.w*0.55);
          const cc = period === 'MORNING' ? 'rgba(255,245,252,1)' : 'rgba(255,252,255,1)';
          cg.addColorStop(0, cc); cg.addColorStop(0.55, cc.replace(',1)',',.6)'));
          cg.addColorStop(1, cc.replace(',1)',',.0)'));
          ctx.scale(1, c.h/(c.w*0.55)); ctx.fillStyle = cg;
          ctx.beginPath(); ctx.arc(c.x, c.y*(c.w*0.55/c.h), c.w*0.55, 0, Math.PI*2); ctx.fill();
          ctx.restore();
        });
      }

      // ── 4. Rolling distant hills ───────────────────────────────────────────
      const HILLS = {
        MORNING:   [[148,125,165],[155,135,175],[165,148,188]],
        AFTERNOON: [[88, 138,85], [105,158,98], [120,170,112]],
        EVENING:   [[62, 52, 100],[75,62,118],[88,72,130]],
        NIGHT:     [[22, 18,  50],[28,22,65],  [35,28,78]],
      };
      const hc = HILLS[period] || HILLS.AFTERNOON;
      [2,1,0].forEach(li => {
        const baseY = H*(0.50 + li*0.04);
        ctx.beginPath();
        for (let xi = 0; xi <= 20; xi++) {
          const fx = xi*(W/20);
          const fy = baseY - H*(0.06+li*0.012)*Math.sin(xi*0.42+li*1.5+1.2) - H*0.025*Math.sin(xi*0.95+li*0.7);
          xi===0 ? ctx.moveTo(fx,fy) : ctx.lineTo(fx,fy);
        }
        ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
        ctx.fillStyle = _rgb(hc[li], 0.75+li*0.08); ctx.fill();
      });

      // ── 5. Mid-ground cherry blossom trees (pink cloud masses) ───────────
      const BLOOM_COL = {
        MORNING:   [230,170,200], AFTERNOON: [255,180,205],
        EVENING:   [190,130,165], NIGHT:     [130,90,120],
      };
      const bc = BLOOM_COL[period] || BLOOM_COL.AFTERNOON;
      // Multiple overlapping bloom clusters across mid-ground
      const bloomCenters = [
        {x:W*0.05,y:H*0.46,rx:W*0.12,ry:H*0.09},
        {x:W*0.18,y:H*0.43,rx:W*0.11,ry:H*0.08},
        {x:W*0.32,y:H*0.45,rx:W*0.13,ry:H*0.09},
        {x:W*0.50,y:H*0.46,rx:W*0.10,ry:H*0.07},
        {x:W*0.62,y:H*0.43,rx:W*0.14,ry:H*0.09},
        {x:W*0.76,y:H*0.44,rx:W*0.12,ry:H*0.08},
        {x:W*0.90,y:H*0.47,rx:W*0.11,ry:H*0.09},
      ];
      bloomCenters.forEach(bl => {
        // Each tree mass: multiple overlapping ellipses
        for (let bi=0; bi<4; bi++) {
          const boffx = (bi-1.5)*bl.rx*0.35;
          const boffy = bi*bl.ry*(-0.18);
          const bg = ctx.createRadialGradient(bl.x+boffx, bl.y+boffy, 0, bl.x+boffx, bl.y+boffy, bl.rx*(0.7+bi*0.1));
          const aa = 0.52-bi*0.10;
          bg.addColorStop(0, _rgb(bc, aa*1.3));
          bg.addColorStop(0.55, _rgb(bc, aa*0.65));
          bg.addColorStop(1, _rgb(bc, 0));
          ctx.fillStyle = bg;
          ctx.save(); ctx.scale(1, bl.ry/bl.rx);
          ctx.beginPath(); ctx.arc(bl.x+boffx, (bl.y+boffy)*bl.rx/bl.ry, bl.rx*(0.7+bi*0.1), 0, Math.PI*2); ctx.fill();
          ctx.restore();
        }
      });

      // ── 6. Reflective pond/lake ────────────────────────────────────────────
      // Pond shape centered at ~60% x, 65-78% y
      const px = W*0.58, py = H*0.65, prx = W*0.30, pry = H*0.13;
      const pondG = ctx.createLinearGradient(px, py-pry, px, py+pry);
      if (period === 'MORNING') {
        pondG.addColorStop(0, 'rgba(200,185,215,0.75)');
        pondG.addColorStop(0.5, 'rgba(175,195,220,0.85)');
        pondG.addColorStop(1, 'rgba(148,168,198,0.90)');
      } else if (period === 'AFTERNOON') {
        pondG.addColorStop(0, 'rgba(155,200,240,0.78)');
        pondG.addColorStop(0.5, 'rgba(130,185,228,0.88)');
        pondG.addColorStop(1, 'rgba(105,162,210,0.92)');
      } else if (period === 'EVENING') {
        pondG.addColorStop(0, 'rgba(88,68,135,0.82)');
        pondG.addColorStop(0.5, 'rgba(72,55,118,0.88)');
        pondG.addColorStop(1, 'rgba(52,38,90,0.92)');
      } else {
        pondG.addColorStop(0, 'rgba(22,18,55,0.88)');
        pondG.addColorStop(1, 'rgba(12,10,38,0.95)');
      }
      ctx.save();
      ctx.fillStyle = pondG;
      ctx.beginPath(); ctx.ellipse(px, py, prx, pry, 0, 0, Math.PI*2); ctx.fill();

      // Pond shimmer lines
      if (period !== 'NIGHT') {
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 0.8;
        for (let wi=0; wi<5; wi++) {
          const wy = py - pry*0.3 + wi*pry*0.15 + Math.sin(t+wi*1.2)*pry*0.04;
          const wx = prx*(0.4+wi*0.06);
          ctx.beginPath(); ctx.moveTo(px-wx, wy); ctx.lineTo(px+wx, wy); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Lily pads
      ctx.globalAlpha = 0.65;
      const LILY = period==='NIGHT' ? 'rgba(22,38,18,1)' : 'rgba(58,105,45,1)';
      const LILY2 = period==='NIGHT' ? 'rgba(18,28,14,1)' : 'rgba(42,88,32,1)';
      [[px-prx*0.3,py],[px,py+pry*0.3],[px+prx*0.25,py-pry*0.1],[px-prx*0.5,py+pry*0.2]].forEach(([lx,ly],li) => {
        ctx.fillStyle = li%2===0?LILY:LILY2;
        ctx.beginPath(); ctx.ellipse(lx,ly,W*0.018,W*0.011,li*0.5,0,Math.PI*2); ctx.fill();
        // Notch
        ctx.fillStyle='rgba(0,0,0,0.15)';
        ctx.beginPath(); ctx.moveTo(lx,ly); ctx.arc(lx,ly,W*0.018,(-0.3+li*0.5),(-0.6+li*0.5),true); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── 7. Stone path ─────────────────────────────────────────────────────
      // Winding from bottom-left toward center-right
      ctx.save();
      const pathCol = period==='EVENING'||period==='NIGHT'
        ? 'rgba(58,50,72,0.85)' : 'rgba(125,115,100,0.80)';
      ctx.fillStyle = pathCol;
      ctx.beginPath();
      ctx.moveTo(W*0.05, H);
      ctx.bezierCurveTo(W*0.10, H*0.90, W*0.22, H*0.82, W*0.35, H*0.75);
      ctx.bezierCurveTo(W*0.42, H*0.72, W*0.48, H*0.70, W*0.55, H*0.68);
      ctx.bezierCurveTo(W*0.50, H*0.72, W*0.44, H*0.80, W*0.30, H*0.88);
      ctx.bezierCurveTo(W*0.18, H*0.94, W*0.10, H*0.97, W*0.05, H);
      ctx.closePath(); ctx.fill();

      // Stone blocks on path
      if (period !== 'NIGHT') {
        ctx.globalAlpha = 0.40;
        const stoneRows = [[W*0.10,H*0.92,0.06],[W*0.16,H*0.88,0.055],[W*0.23,H*0.84,0.05],
          [W*0.30,H*0.80,0.045],[W*0.37,H*0.77,0.040],[W*0.44,H*0.74,0.035]];
        stoneRows.forEach(([sx,sy,sw],si) => {
          const stW = W*sw, stH = H*0.025;
          for (let si2=0; si2<3; si2++) {
            ctx.fillStyle = si%2===0?'rgba(168,155,130,1)':'rgba(145,132,108,1)';
            ctx.beginPath();
            ctx.roundRect(sx+si2*stW*0.85-stW*0.5, sy-stH*0.5, stW*0.78, stH*0.88, 2);
            ctx.fill();
          }
        });
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // ── 8. Japanese pagoda (far right) ────────────────────────────────────
      ctx.save();
      const pagX = W*0.73, pagY = H*0.52, pagW = W*0.048, pagH = H*0.20;
      const pagCol = period==='MORNING' ? 'rgba(68,52,78,0.70)' : period==='AFTERNOON' ? 'rgba(55,42,65,0.72)' :
        period==='EVENING' ? 'rgba(45,35,72,0.78)' : 'rgba(18,14,30,0.85)';
      ctx.fillStyle = pagCol;
      // 4-tier pagoda
      for (let tier=0; tier<4; tier++) {
        const tw = pagW*(1.5-tier*0.25);
        const ty = pagY + (3-tier)*pagH*0.26;
        const th = pagH*0.25;
        ctx.beginPath();
        ctx.rect(pagX-tw*0.5, ty, tw, th*0.65);
        ctx.fill();
        // Curved roof
        ctx.beginPath();
        ctx.moveTo(pagX-tw*0.68, ty);
        ctx.quadraticCurveTo(pagX-tw*0.28, ty-th*0.45, pagX, ty-th*0.50);
        ctx.quadraticCurveTo(pagX+tw*0.28, ty-th*0.45, pagX+tw*0.68, ty);
        ctx.fill();
      }
      // Spire
      ctx.beginPath(); ctx.moveTo(pagX, pagY-pagH*0.10);
      ctx.lineTo(pagX-W*0.004, pagY+pagH*0.02); ctx.lineTo(pagX+W*0.004, pagY+pagH*0.02);
      ctx.fill();
      // Evening lantern glow on pagoda
      if (period==='EVENING'||period==='NIGHT') {
        const pglow = ctx.createRadialGradient(pagX,pagY+pagH*0.05,0,pagX,pagY+pagH*0.05,pagW*2.5);
        pglow.addColorStop(0,'rgba(255,180,60,0.28)'); pglow.addColorStop(1,'rgba(255,140,40,0)');
        ctx.fillStyle=pglow; ctx.fillRect(pagX-pagW*3,pagY-pagH*0.1,pagW*6,pagH*0.5);
      }
      ctx.restore();

      // ── 9. Red arched bridge ──────────────────────────────────────────────
      ctx.save();
      const brX = W*0.62, brY = H*0.63, brW = W*0.16;
      const bridgeCol = period==='NIGHT' ? 'rgba(105,28,22,0.82)' : 'rgba(185,42,35,0.88)';
      ctx.strokeStyle = bridgeCol; ctx.lineWidth = H*0.018; ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(brX-brW*0.5, brY);
      ctx.quadraticCurveTo(brX, brY-H*0.04, brX+brW*0.5, brY);
      ctx.stroke();
      ctx.lineWidth = H*0.008;
      // Bridge railings
      ctx.beginPath(); ctx.moveTo(brX-brW*0.5, brY-H*0.02); ctx.lineTo(brX+brW*0.5, brY-H*0.02); ctx.stroke();
      ctx.restore();

      // ── 10. Foreground cherry tree trunks (L + R) ────────────────────────
      [[W*0.03,  W*0.15,  1],    // Left primary trunk
       [W*0.18,  W*0.24,  -0.4], // Left secondary
       [W*0.97,  W*0.85,  -1],   // Right primary
       [W*0.82,  W*0.76,  0.4],  // Right secondary
      ].forEach(([bx, topX, lean], ti) => {
        ctx.save();
        const trW1 = W*(ti<2?0.06:0.06), trW2 = W*(ti<2?0.018:0.018);
        const BARK = period==='EVENING'||period==='NIGHT' ? ['rgba(28,18,12,1)','rgba(45,30,20,1)','rgba(35,22,14,1)']
          : ['rgba(48,30,18,1)','rgba(72,48,28,1)','rgba(58,38,22,1)'];
        const tg = ctx.createLinearGradient(bx-trW1*0.5,0,bx+trW1*0.5,0);
        tg.addColorStop(0, BARK[0]); tg.addColorStop(0.38, BARK[1]); tg.addColorStop(1, BARK[2]);
        ctx.fillStyle = tg;
        // Trunk from bottom to beyond top
        ctx.beginPath();
        ctx.moveTo(bx-trW1*0.5, H+5);
        ctx.bezierCurveTo(bx-trW1*0.4+lean*10, H*0.60, topX-trW2*0.5+lean*5, H*0.20, topX-trW2*0.5, -20);
        ctx.lineTo(topX+trW2*0.5, -20);
        ctx.bezierCurveTo(topX+trW2*0.5+lean*5, H*0.20, bx+trW1*0.4+lean*10, H*0.60, bx+trW1*0.5, H+5);
        ctx.closePath(); ctx.fill();

        // Branch extending inward with blossom cluster
        const brDir = ti<2 ? 1 : -1;
        const brY2 = H*(ti<2?0.25:0.28);
        const brEndX = topX + brDir*W*(0.14+ti*0.02);
        ctx.strokeStyle = tg; ctx.lineWidth = trW2*1.5; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(topX, brY2);
        ctx.bezierCurveTo(topX+brDir*W*0.06, brY2-H*0.04, topX+brDir*W*0.11, brY2-H*0.01, brEndX, brY2+H*0.02);
        ctx.stroke();

        // Blossom cluster on branch
        const clX = brEndX, clY = brY2;
        const bloomA = period==='NIGHT'?0.40:0.75;
        const blCol = period==='MORNING'?[245,185,215]:period==='AFTERNOON'?[255,190,220]:period==='EVENING'?[200,140,175]:[140,100,130];
        for (let bi=0; bi<6; bi++) {
          const boffx = (bi-2.5)*W*0.032+Math.random()*W*0.01;
          const boffy = (Math.random()-0.5)*H*0.04;
          const br = W*0.040+Math.random()*W*0.025;
          const bg = ctx.createRadialGradient(clX+boffx,clY+boffy,0,clX+boffx,clY+boffy,br);
          bg.addColorStop(0, _rgb(blCol, bloomA));
          bg.addColorStop(0.55, _rgb(blCol, bloomA*0.55));
          bg.addColorStop(1, _rgb(blCol, 0));
          ctx.fillStyle=bg; ctx.beginPath(); ctx.arc(clX+boffx,clY+boffy,br,0,Math.PI*2); ctx.fill();
        }
        ctx.restore();
      });

      // ── 11. Lanterns (evening/night) ──────────────────────────────────────
      if (period==='EVENING'||period==='NIGHT') {
        this._lanterns.forEach(ln => {
          ln.phase += ln.spd;
          const flicker = 0.80+0.20*Math.sin(ln.phase)+0.08*Math.sin(ln.phase*2.5);
          const la = (period==='NIGHT'?0.55:0.40)*flicker;
          const lg = ctx.createRadialGradient(ln.x,ln.y,0,ln.x,ln.y,ln.r*4.5*flicker);
          lg.addColorStop(0, `rgba(255,195,80,${la*3.2})`);
          lg.addColorStop(0.25, `rgba(245,155,45,${la*1.5})`);
          lg.addColorStop(0.6, `rgba(220,100,25,${la*0.4})`);
          lg.addColorStop(1, 'rgba(180,60,10,0)');
          ctx.fillStyle=lg; ctx.fillRect(ln.x-ln.r*5,ln.y-ln.r*5,ln.r*10,ln.r*10);
          // Lantern body
          ctx.save(); ctx.globalAlpha=0.88;
          ctx.fillStyle=`rgba(255,210,100,${flicker*0.9})`;
          ctx.beginPath(); ctx.ellipse(ln.x,ln.y,ln.r,ln.r*1.4,0,0,Math.PI*2); ctx.fill();
          ctx.restore();
        });
      }

      // ── 12. Animated bokeh orbs ────────────────────────────────────────────
      if (period !== 'NIGHT') {
        this._bokeh.forEach(bk => {
          bk.phase += bk.spd; bk.x += bk.driftX; bk.y += bk.driftY;
          if (bk.y < -bk.r) bk.y = H+bk.r;
          const pulse = 0.7+0.3*Math.sin(bk.phase);
          const a = bk.alpha*pulse;
          const g = ctx.createRadialGradient(bk.x,bk.y,0,bk.x,bk.y,bk.r);
          g.addColorStop(0, `hsla(${bk.hue},90%,82%,${a*2.5})`);
          g.addColorStop(0.38, `hsla(${bk.hue},82%,68%,${a*1.2})`);
          g.addColorStop(1, `hsla(${bk.hue},70%,52%,0)`);
          ctx.fillStyle=g; ctx.beginPath(); ctx.arc(bk.x,bk.y,bk.r,0,Math.PI*2); ctx.fill();
        });
      }

      // ── 13. Bottom ground vignette ─────────────────────────────────────────
      const gndG = ctx.createLinearGradient(0,H*0.88,0,H);
      gndG.addColorStop(0,'rgba(0,0,0,0)');
      gndG.addColorStop(1, period==='NIGHT'?'rgba(5,3,15,0.45)':period==='EVENING'?'rgba(25,12,35,0.35)':'rgba(30,20,28,0.22)');
      ctx.fillStyle=gndG; ctx.fillRect(0,H*0.88,W,H*0.12);
    },

    create(W, H) {
      const r = Math.random();
      if (r < 0.68) {
        // Cherry petal — faster, real tumbling
        return {
          type: 'petal',
          x: Math.random()*W*1.40-W*0.20,
          y: -22-Math.random()*80,
          vx: (Math.random()-0.5)*1.20,
          vy:  1.2+Math.random()*2.0,  // real petal speed
          rot: Math.random()*Math.PI*2,
          rotV: (Math.random()-0.5)*0.10,
          sz: 3.5+Math.random()*7.5,
          alpha: 0, maxAlpha: 0.55+Math.random()*0.38,
          life: 0, fadeIn: 10,
          sw: Math.random()*Math.PI*2,
          swAmp: 1.4+Math.random()*2.8, swSpd: 0.013+Math.random()*0.020,
          col: `hsl(${330+Math.random()*28|0},${68+Math.random()*20|0}%,${72+Math.random()*16|0}%)`,
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

      // Fish schools: multiple species, varied sizes and behaviors
      this._fishSchools = [
        // Tropical school - small, fast, colorful
        { fish: Array.from({ length: 7 }, (_, i) => ({
          x: rng(-200, W + 200), y: H * rng(0.12, 0.55),
          vx: (rng(0,1) < 0.5 ? -1 : 1) * rng(0.8, 1.6),
          vy: (rng(-1,1)) * 0.2,
          sz: rng(8, 14), phase: i * 0.7,
          hue: 28 + i * 22, sat: 85, col2: 48 + i * 18,
          bodyRatio: 0.35, finH: 0.55,
        })), type: 'tropical', offsetSpread: 28 },
        // Deep fish - larger, slower, more muted
        { fish: Array.from({ length: 4 }, (_, i) => ({
          x: rng(-300, W + 300), y: H * rng(0.50, 0.80),
          vx: (rng(0,1) < 0.5 ? -1 : 1) * rng(0.3, 0.65),
          vy: (rng(-1,1)) * 0.12,
          sz: rng(22, 42), phase: i * 1.1,
          hue: 195 + i * 15, sat: 55, col2: 220 + i * 10,
          bodyRatio: 0.30, finH: 0.48,
        })), type: 'deep', offsetSpread: 45 },
        // Mid-water angelfish - iconic shape
        { fish: Array.from({ length: 5 }, (_, i) => ({
          x: rng(-150, W + 150), y: H * rng(0.30, 0.68),
          vx: (rng(0,1) < 0.5 ? -1 : 1) * rng(0.5, 1.0),
          vy: (rng(-1,1)) * 0.15,
          sz: rng(15, 25), phase: i * 0.9,
          hue: 38 + i * 8, sat: 88, col2: 320,
          bodyRatio: 0.58, finH: 0.80, // tall fins = angelfish
        })), type: 'angel', offsetSpread: 18 },
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

      const alpha = period === 'NIGHT' ? 0.60 : 0.82;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(f.x, f.y + bodyWobble);
      ctx.scale(dir, 1);

      // Body gradient
      const bg = ctx.createLinearGradient(-f.sz, 0, f.sz, 0);
      bg.addColorStop(0, `hsl(${f.hue},${f.sat}%,35%)`);
      bg.addColorStop(0.4, `hsl(${f.hue},${f.sat}%,52%)`);
      bg.addColorStop(1, `hsl(${f.hue},${f.sat - 10}%,42%)`);

      // Fish body — ellipse with tapering tail
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(f.sz * 0.1, 0, f.sz * 0.82, f.sz * f.bodyRatio, 0, 0, Math.PI * 2);
      ctx.fill();

      // Caudal fin (tail)
      ctx.fillStyle = `hsl(${f.hue - 10},${f.sat}%,42%)`;
      ctx.beginPath();
      ctx.moveTo(-f.sz * 0.70, 0);
      ctx.lineTo(-f.sz * 1.45, -f.sz * f.finH * 0.65 + tailWag);
      ctx.lineTo(-f.sz * 1.48, 0);
      ctx.lineTo(-f.sz * 1.45,  f.sz * f.finH * 0.65 - tailWag);
      ctx.closePath(); ctx.fill();

      // Dorsal fin
      ctx.beginPath();
      ctx.moveTo(-f.sz * 0.1, -f.sz * f.bodyRatio);
      ctx.quadraticCurveTo(f.sz * 0.15, -f.sz * f.bodyRatio * 1.6, f.sz * 0.55, -f.sz * f.bodyRatio);
      ctx.closePath();
      ctx.fillStyle = `hsl(${f.hue},${f.sat}%,38%)`; ctx.fill();

      // Pectoral fin (angelfish style taller)
      if (f.bodyRatio > 0.50) {
        ctx.beginPath();
        ctx.moveTo(f.sz * 0.1, f.sz * 0.10);
        ctx.quadraticCurveTo(-f.sz * 0.15, f.sz * 0.68, f.sz * 0.30, f.sz * f.bodyRatio * 0.90);
        ctx.quadraticCurveTo(f.sz * 0.50, f.sz * 0.42, f.sz * 0.10, f.sz * 0.10);
        ctx.fillStyle = `hsl(${f.hue + 10},${f.sat - 5}%,48%)`; ctx.fill();
      }

      // Eye + highlight
      const eyeX = f.sz * 0.52, eyeY = -f.sz * 0.08;
      ctx.fillStyle = 'rgba(8,6,4,0.90)';
      ctx.beginPath(); ctx.arc(eyeX, eyeY, f.sz * 0.095, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.80)';
      ctx.beginPath(); ctx.arc(eyeX + f.sz * 0.035, eyeY - f.sz * 0.035, f.sz * 0.032, 0, Math.PI * 2); ctx.fill();

      // Color stripe / pattern
      ctx.save(); ctx.globalAlpha *= 0.52;
      ctx.fillStyle = `hsl(${f.col2},90%,72%)`;
      ctx.beginPath(); ctx.ellipse(f.sz * 0.22, 0, f.sz * 0.18, f.sz * f.bodyRatio * 0.58, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.restore();
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend  = _getSmoothBlend();
      const t = _frame * 0.016;

      // ── 1. Water column gradient ─────────────────────────────────────────
      const WATER = {
        MORNING:   { t:[20,100,160], m:[12,72,128], b:[6,38,78] },
        AFTERNOON: { t:[8,145,210],  m:[5,105,172], b:[3,58,112] },
        EVENING:   { t:[8,55,115],   m:[5,35,85],   b:[2,18,52] },
        NIGHT:     { t:[3,18,48],    m:[2,10,32],   b:[1,5,18]  },
      };
      const wc = _blendPeriodColors(WATER, blend);
      const wg = ctx.createLinearGradient(0, 0, 0, H);
      wg.addColorStop(0,   _rgb(wc.t));
      wg.addColorStop(0.48, _rgb(wc.m));
      wg.addColorStop(1,   _rgb(wc.b));
      ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);

      // ── 2. Surface shimmer layer ─────────────────────────────────────────
      if (period !== 'NIGHT') {
        const surfA = period === 'MORNING' ? 0.12 : 0.09;
        const sg = ctx.createLinearGradient(0, 0, 0, H * 0.38);
        sg.addColorStop(0, `rgba(80,215,255,${surfA * 1.4})`);
        sg.addColorStop(0.4, `rgba(45,185,240,${surfA * 0.6})`);
        sg.addColorStop(1, 'rgba(18,140,210,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H * 0.38);
      }

      // ── 3. Caustic light patches ─────────────────────────────────────────
      if (period !== 'NIGHT') {
        const causA = period === 'MORNING' ? 0.055 : period === 'AFTERNOON' ? 0.040 : 0.020;
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        this._caustics.forEach(c => {
          c.phase += c.spd; c.x += c.driftX;
          if (c.x < -80) c.x = W + 80;
          if (c.x > W + 80) c.x = -80;
          const pulse = 0.55 + 0.45 * Math.sin(c.phase);
          const a = causA * pulse;
          const cy = c.y + Math.sin(c.phase * 0.72) * 14;
          ctx.save();
          ctx.translate(c.x, cy); ctx.rotate(c.rot + c.phase * 0.06);
          const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, c.rx);
          cg.addColorStop(0,   `rgba(120,245,255,${a * 2.6})`);
          cg.addColorStop(0.45,`rgba(68,210,255,${a * 1.1})`);
          cg.addColorStop(1,   'rgba(22,165,230,0)');
          ctx.scale(1, c.ry / c.rx);
          ctx.fillStyle = cg;
          ctx.beginPath(); ctx.arc(0, 0, c.rx, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        });
        ctx.restore();
      }

      // ── 4. Night bioluminescence on water ────────────────────────────────
      if (period === 'NIGHT' || period === 'EVENING') {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        for (let bi = 0; bi < 14; bi++) {
          const bx = W * ((bi * 0.143 + Math.sin(t * 0.3 + bi) * 0.04 + 1) % 1);
          const by = H * (0.35 + 0.55 * ((bi * 0.217 + Math.cos(t * 0.22 + bi * 0.9) * 0.03 + 1) % 1));
          const ba = (period === 'NIGHT' ? 0.04 : 0.018) * (0.5 + 0.5 * Math.sin(t * 2.2 + bi * 1.7));
          const bg2 = ctx.createRadialGradient(bx, by, 0, bx, by, 35);
          bg2.addColorStop(0, `rgba(80,255,200,${ba * 4})`);
          bg2.addColorStop(1, 'rgba(30,200,160,0)');
          ctx.fillStyle = bg2; ctx.beginPath(); ctx.arc(bx, by, 35, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }

      // ── 5. Kelp forest ───────────────────────────────────────────────────
      this._kelp.forEach(k => {
        k.phase += k.swSpd;
        this._drawKelp(ctx, k, t, period);
      });

      // ── 6. Coral reef formations ─────────────────────────────────────────
      this._coral.forEach(c => {
        c.phase += c.swSpd;
        const sw = Math.sin(c.phase) * 5;
        const baseY = H;
        const corA = period === 'NIGHT' ? 0.50 : 0.80;

        ctx.save(); ctx.globalAlpha = corA; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

        if (c.type === 'fan') {
          const steps = c.sub + 3;
          for (let a = -0.8; a <= 0.8; a += 1.6 / steps) {
            const ah = c.h * (0.65 + Math.abs(a) * 0.45);
            ctx.strokeStyle = `hsl(${c.hue},82%,${period === 'NIGHT' ? 28 : 48}%)`;
            ctx.lineWidth = 2.0 + Math.abs(a) * 2.5;
            ctx.beginPath(); ctx.moveTo(c.x, baseY);
            ctx.quadraticCurveTo(
              c.x + Math.sin(a) * c.w * 2.5 + sw, baseY - ah * 0.6,
              c.x + Math.sin(a) * c.w * 4.0 + sw * 1.3, baseY - ah
            );
            ctx.stroke();
          }
        } else if (c.type === 'branch') {
          // Y-tree branching
          const drawBranch = (x, y, len, angle, depth) => {
            if (depth === 0) return;
            const ex = x + Math.sin(angle + sw * 0.04) * len;
            const ey = y - Math.cos(angle) * len;
            ctx.strokeStyle = `hsl(${c.hue},${70 - depth * 8}%,${period === 'NIGHT' ? 22 : 42}%)`;
            ctx.lineWidth = depth * c.w * 0.22;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
            drawBranch(ex, ey, len * 0.68, angle - 0.42, depth - 1);
            drawBranch(ex, ey, len * 0.68, angle + 0.42, depth - 1);
          };
          drawBranch(c.x, baseY, c.h * 0.55, 0, 4);
        } else if (c.type === 'anemone') {
          // Anemone tentacles fanning out
          for (let ai = 0; ai < c.sub + 4; ai++) {
            const ang = (ai / (c.sub + 4)) * Math.PI * 2;
            const tlen = c.h * (0.65 + Math.sin(c.phase + ai * 0.8) * 0.18);
            ctx.strokeStyle = `hsl(${c.hue + ai * 15},90%,${period === 'NIGHT' ? 32 : 58}%)`;
            ctx.lineWidth = 2.8;
            ctx.beginPath(); ctx.moveTo(c.x, baseY);
            ctx.bezierCurveTo(
              c.x + Math.cos(ang) * tlen * 0.35 + sw, baseY - tlen * 0.4,
              c.x + Math.cos(ang) * tlen * 0.75 + sw * 1.2, baseY - tlen * 0.78,
              c.x + Math.cos(ang) * tlen * 0.90 + sw * 1.5, baseY - tlen
            );
            ctx.stroke();
            // Tentacle tip blob
            const tipX = c.x + Math.cos(ang) * tlen * 0.90 + sw * 1.5;
            const tipY = baseY - tlen;
            ctx.fillStyle = `hsl(${c.hue + ai * 20},95%,72%)`;
            ctx.beginPath(); ctx.arc(tipX, tipY, 3.5, 0, Math.PI * 2); ctx.fill();
          }
        } else if (c.type === 'brain') {
          // Brain coral — rounded dome with ridge texture
          ctx.fillStyle = `hsl(${c.hue},65%,${period === 'NIGHT' ? 22 : 38}%)`;
          ctx.beginPath();
          ctx.ellipse(c.x, baseY - c.h * 0.5, c.w * 1.8, c.h * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = `hsl(${c.hue + 10},72%,${period === 'NIGHT' ? 15 : 28}%)`;
          ctx.lineWidth = 1.5;
          for (let ri = -2; ri <= 2; ri++) {
            ctx.beginPath();
            ctx.moveTo(c.x - c.w * 1.6, baseY - c.h * 0.5 + ri * c.h * 0.14);
            ctx.quadraticCurveTo(c.x + sw * 0.4, baseY - c.h * 0.5 + ri * c.h * 0.14 - c.h * 0.08,
              c.x + c.w * 1.6, baseY - c.h * 0.5 + ri * c.h * 0.14);
            ctx.stroke();
          }
        } else { // tube
          for (let ti = 0; ti < c.sub + 2; ti++) {
            const tx = c.x + (ti - c.sub * 0.5) * c.w * 0.8;
            const th = c.h * (0.6 + ti * 0.12);
            ctx.fillStyle = `hsl(${c.hue + ti * 12},80%,${period === 'NIGHT' ? 25 : 45}%)`;
            ctx.beginPath();
            ctx.roundRect(tx - c.w * 0.28, baseY - th, c.w * 0.56, th, [c.w * 0.28, c.w * 0.28, 0, 0]);
            ctx.fill();
            // Tube opening ring
            ctx.strokeStyle = `hsl(${c.hue + ti * 12},88%,${period === 'NIGHT' ? 35 : 62}%)`;
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.ellipse(tx, baseY - th, c.w * 0.28, c.w * 0.14, 0, 0, Math.PI * 2); ctx.stroke();
          }
        }
        ctx.restore();
      });

      // ── 7. Fish schools ──────────────────────────────────────────────────
      this._fishSchools.forEach(school => {
        school.fish.forEach(f => {
          // Schooling behavior: fish drift toward leader slightly
          const leader = school.fish[0];
          if (f !== leader) {
            f.vx += (leader.vx - f.vx) * 0.004;
            f.vy += (leader.vy - f.vy) * 0.003;
            const dist = Math.hypot(f.x - leader.x, f.y - leader.y);
            if (dist > school.offsetSpread * 2.5) {
              f.vx += (leader.x - f.x) * 0.001;
              f.vy += (leader.y - f.y) * 0.001;
            }
          }
          // Gentle directional drift
          f.vx += (Math.random() - 0.5) * 0.015;
          f.vy += (Math.random() - 0.5) * 0.010;
          f.vx = Math.max(-2.5, Math.min(2.5, f.vx));
          f.vy = Math.max(-0.8, Math.min(0.8, f.vy));

          f.x += f.vx; f.y += f.vy;
          // Wrap horizontally
          if (f.vx > 0 && f.x > W + 120) f.x = -120;
          if (f.vx < 0 && f.x < -120) f.x = W + 120;
          f.y = Math.max(H * 0.05, Math.min(H * 0.88, f.y));

          this._drawFish(ctx, f, t, period);
        });
      });

      // ── 8. Sandy seafloor ────────────────────────────────────────────────
      const sfA = period === 'NIGHT' ? 0.75 : 0.88;
      const sfCol = period === 'NIGHT' ? [4, 18, 42] : period === 'EVENING' ? [8, 32, 72] : [15, 55, 95];
      const sf = ctx.createLinearGradient(0, H * 0.87, 0, H);
      sf.addColorStop(0, _rgb(sfCol, 0));
      sf.addColorStop(0.3, _rgb(sfCol, sfA * 0.5));
      sf.addColorStop(1, _rgb(sfCol, sfA));
      ctx.fillStyle = sf; ctx.fillRect(0, H * 0.87, W, H * 0.13);

      // Sand ripples
      if (period !== 'NIGHT') {
        ctx.save(); ctx.globalAlpha = 0.10;
        ctx.strokeStyle = 'rgba(80,155,195,1)'; ctx.lineWidth = 0.8;
        for (let ri = 0; ri < 8; ri++) {
          const ry = H * (0.90 + ri * 0.012);
          const ramp = Math.sin(t * 0.5 + ri * 0.8) * W * 0.006;
          ctx.beginPath(); ctx.moveTo(0, ry + ramp);
          ctx.bezierCurveTo(W * 0.25, ry - ramp, W * 0.75, ry + ramp, W, ry - ramp);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── 9. Pop animations ───────────────────────────────────────────────
      this._pops = this._pops.filter(pop => {
        pop.frame++;
        const prog = pop.frame / pop.maxFrame;
        ctx.save();
        ctx.globalAlpha = (1 - prog) * 0.85;
        ctx.strokeStyle = 'rgba(180,240,255,1)'; ctx.lineWidth = 1.5;
        // Expanding ring
        ctx.beginPath(); ctx.arc(pop.x, pop.y, pop.r * (1 + prog * 2.5), 0, Math.PI * 2); ctx.stroke();
        // Pop droplets
        for (let di = 0; di < 6; di++) {
          const da = (di / 6) * Math.PI * 2;
          const dr = pop.r * (1.8 + prog * 3.5);
          const dx = pop.x + Math.cos(da) * dr;
          const dy = pop.y + Math.sin(da) * dr;
          ctx.fillStyle = 'rgba(150,235,255,1)';
          ctx.beginPath(); ctx.arc(dx, dy, 1.5 * (1 - prog), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        return pop.frame < pop.maxFrame;
      });

      // ── 10. Depth vignette ───────────────────────────────────────────────
      const dv = ctx.createRadialGradient(W * 0.5, H * 0.4, W * 0.1, W * 0.5, H * 0.4, W * 0.85);
      const dvCol = period === 'NIGHT' ? 'rgba(0,2,12,' : period === 'EVENING' ? 'rgba(1,4,20,' : 'rgba(0,8,25,';
      dv.addColorStop(0, dvCol + '0)');
      dv.addColorStop(0.65, dvCol + '0)');
      dv.addColorStop(1, dvCol + '0.58)');
      ctx.fillStyle = dv; ctx.fillRect(0, 0, W, H);
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
  snow: {
    max: 85, rate: 0.28,
    _pines: null, _aurora: null, _ground: null, _cabinLights: null, _breath: null,

    init(W, H) {
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);
      _stars = [];
      _initStars(W, H, 70);
      _stars.forEach(s => { s.y *= 0.55; });

      // Pine trees: layered at different depths
      this._pines = Array.from({ length: 22 }, (_, i) => {
        const depth = i < 7 ? 0 : i < 14 ? 1 : 2; // far, mid, near
        return {
          x: W * (i / 21) + rng(-W * 0.02, W * 0.02),
          baseY: H * (0.58 + depth * 0.10),
          height: H * (0.12 + (2 - depth) * 0.06 + rng(0, 0.05)),
          layers: 4 + depth,
          depth,
          phase: rng(0, Math.PI * 2),
          swSpd: rng(0.003, 0.008),
          snowLoad: rng(0.3, 0.8),
        };
      });

      // Aurora bands for night/evening
      this._aurora = Array.from({ length: 5 }, (_, i) => ({
        phase: i * 1.3,
        spd: 0.006 + i * 0.003,
        hue: 155 + i * 28,
        y: H * (0.06 + i * 0.08),
        amp: H * (0.045 + i * 0.012),
        alpha: 0.0,
      }));

      // Snow ground hills
      this._ground = Array.from({ length: 3 }, (_, li) => {
        const pts = [];
        const steps = 24;
        for (let j = 0; j <= steps; j++) {
          pts.push({
            x: W * j / steps,
            y: H * (0.68 + li * 0.09) - H * (0.045 + li * 0.015) * Math.sin(j * 0.42 + li * 1.8),
          });
        }
        return { pts, li };
      });

      // Cabin warm lights (small glowing windows)
      this._cabinLights = [
        { x: W * 0.12, y: H * 0.65, w: W * 0.022, h: H * 0.018, phase: 0, spd: 0.06 },
        { x: W * 0.82, y: H * 0.62, w: W * 0.018, h: H * 0.016, phase: 1.4, spd: 0.05 },
      ];

      // Breath/steam puffs from cabin chimney
      this._breath = [];
    },

    _drawPine(ctx, tree, period) {
      const { x, baseY, height, layers, snowLoad } = tree;
      const trunkH = height * 0.18;
      const trunkW = height * 0.055;

      // Trunk
      const trunkCol = period === 'MORNING' ? 'rgba(52,35,18,0.78)' :
        period === 'EVENING' ? 'rgba(75,48,22,0.68)' : 'rgba(35,22,10,0.85)';
      ctx.fillStyle = trunkCol;
      ctx.beginPath();
      ctx.rect(x - trunkW * 0.5, baseY - trunkH, trunkW, trunkH);
      ctx.fill();

      // Layered triangular branches with snow on top
      const treeCol = period === 'NIGHT' ? 'rgba(18,28,18,0.92)' :
        period === 'EVENING' ? 'rgba(32,52,28,0.85)' :
        period === 'MORNING' ? 'rgba(28,45,22,0.82)' : 'rgba(22,42,18,0.88)';

      for (let li = 0; li < layers; li++) {
        const prog = li / layers;
        const layW = height * (0.32 + (1 - prog) * 0.38);
        const layY = baseY - trunkH - li * height * 0.18;
        const layH = height * (0.22 + (1 - prog) * 0.06);

        ctx.fillStyle = treeCol;
        ctx.beginPath();
        ctx.moveTo(x - layW, layY);
        ctx.lineTo(x + layW, layY);
        ctx.lineTo(x, layY - layH);
        ctx.closePath(); ctx.fill();

        // Snow on branch edges
        const snowA = snowLoad * (0.55 + prog * 0.45);
        ctx.fillStyle = `rgba(230,240,255,${snowA * 0.80})`;
        ctx.beginPath();
        ctx.moveTo(x - layW, layY);
        ctx.lineTo(x - layW + layW * 0.22, layY);
        ctx.lineTo(x - layW * 0.62, layY - layH * 0.32);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + layW, layY);
        ctx.lineTo(x + layW - layW * 0.22, layY);
        ctx.lineTo(x + layW * 0.62, layY - layH * 0.32);
        ctx.closePath(); ctx.fill();
        // Snow cap
        ctx.beginPath();
        ctx.moveTo(x, layY - layH);
        ctx.lineTo(x - layW * 0.30, layY - layH * 0.65);
        ctx.lineTo(x + layW * 0.30, layY - layH * 0.65);
        ctx.closePath(); ctx.fillStyle = `rgba(235,245,255,${snowA * 0.65})`; ctx.fill();
      }
    },

    drawBackground(ctx, W, H) {
      const period = _getCanvasPeriod();
      const blend = _getSmoothBlend();
      const t = _frame * 0.012;

      // ── 1. Sky gradient ───────────────────────────────────────────────────
      const SKY = {
        MORNING:   { t:[145,162,210], b:[200,215,240] },
        AFTERNOON: { t:[98, 148,218], b:[195,218,248] },
        EVENING:   { t:[200,95, 60],  b:[248,185,128] },
        NIGHT:     { t:[8,  12, 35],  b:[22, 30, 68]  },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H * 0.78);
      skyG.addColorStop(0, _rgb(sk.t)); skyG.addColorStop(1, _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Stars (night/early morning) ────────────────────────────────────
      if (period === 'NIGHT' || period === 'MORNING') {
        const sA = period === 'NIGHT' ? 1.0 : 0.38;
        _stars.forEach(s => {
          s.twinklePhase += s.twinkleSpd;
          const a = s.alpha * sA * (0.35 + 0.65 * Math.sin(s.twinklePhase));
          ctx.save(); ctx.globalAlpha = a;
          ctx.fillStyle = 'rgba(210,225,255,1)';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.82, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        });
      }

      // ── 3. Aurora Borealis ─────────────────────────────────────────────────
      const auroraAlpha = period === 'NIGHT' ? 1.0 : period === 'MORNING' ? 0.25 : 0;
      if (auroraAlpha > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        this._aurora.forEach(au => {
          au.phase += au.spd;
          au.alpha = auroraAlpha * (0.06 + 0.05 * Math.sin(au.phase * 0.7));
          const points = [];
          for (let ai = 0; ai <= W; ai += W / 28) {
            points.push({
              x: ai,
              y: au.y + Math.sin(ai / W * Math.PI * 3 + au.phase) * au.amp
                + Math.sin(ai / W * Math.PI * 5.5 + au.phase * 1.3) * au.amp * 0.38,
            });
          }
          const auH = H * 0.10;
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          points.forEach((p, i) => {
            if (i > 0) ctx.lineTo(p.x, p.y);
          });
          ctx.lineTo(W, points[points.length - 1].y + auH);
          ctx.lineTo(0, points[0].y + auH);
          ctx.closePath();
          const ag = ctx.createLinearGradient(0, au.y - au.amp, 0, au.y + au.amp + auH);
          ag.addColorStop(0, `hsla(${au.hue},90%,62%,0)`);
          ag.addColorStop(0.35, `hsla(${au.hue},90%,62%,${au.alpha * 2.2})`);
          ag.addColorStop(0.65, `hsla(${au.hue + 30},88%,58%,${au.alpha * 1.6})`);
          ag.addColorStop(1, `hsla(${au.hue},80%,55%,0)`);
          ctx.fillStyle = ag; ctx.fill();
        });
        ctx.restore();
      }

      // ── 4. Sun/Moon ───────────────────────────────────────────────────────
      if (period === 'NIGHT') {
        // Crescent moon
        const mx = W * 0.78, my = H * 0.10, mr = Math.min(W, H) * 0.038;
        const moonG = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.5);
        moonG.addColorStop(0, 'rgba(240,248,255,0.22)');
        moonG.addColorStop(1, 'rgba(200,220,255,0)');
        ctx.fillStyle = moonG; ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
        ctx.fillStyle = 'rgba(235,245,255,0.92)';
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(22,30,68,1)';
        ctx.beginPath(); ctx.arc(mx + mr * 0.42, my - mr * 0.05, mr * 0.85, 0, Math.PI * 2); ctx.fill();
      } else if (period === 'AFTERNOON') {
        const sx = W * 0.72, sy = H * 0.08;
        const sunG = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.20);
        sunG.addColorStop(0, 'rgba(255,252,210,0.92)');
        sunG.addColorStop(0.12, 'rgba(255,240,180,0.55)');
        sunG.addColorStop(0.4, 'rgba(255,225,150,0.15)');
        sunG.addColorStop(1, 'rgba(240,210,130,0)');
        ctx.fillStyle = sunG; ctx.fillRect(0, 0, W, H * 0.38);
      } else if (period === 'EVENING') {
        const sx = W * 0.82, sy = H * 0.20;
        const sunG = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.28);
        sunG.addColorStop(0, 'rgba(255,200,80,0.72)');
        sunG.addColorStop(0.22, 'rgba(255,150,50,0.38)');
        sunG.addColorStop(1, 'rgba(220,80,20,0)');
        ctx.fillStyle = sunG; ctx.fillRect(0, 0, W, H * 0.55);
      }

      // ── 5. Distant snow mountains ─────────────────────────────────────────
      const MTN = {
        MORNING:   [[148,162,205,0.55],[120,138,188,0.68],[88,108,160,0.80]],
        AFTERNOON: [[175,200,235,0.50],[148,178,220,0.65],[110,148,200,0.78]],
        EVENING:   [[200,130,100,0.52],[180,100,70,0.65],[145,75,48,0.78]],
        NIGHT:     [[18, 25, 68, 0.58],[12, 18, 52, 0.72],[6,  10, 35, 0.85]],
      };
      const mc = MTN[period] || MTN.AFTERNOON;
      [2, 1, 0].forEach(li => {
        const baseY = H * (0.42 + li * 0.065);
        ctx.beginPath();
        for (let xi = 0; xi <= 18; xi++) {
          const fx = xi * (W / 18);
          const fy = baseY - H * (0.08 + li * 0.012) * Math.sin(xi * 0.52 + li * 1.6 + 2.0)
            - H * 0.035 * Math.sin(xi * 1.08 + li * 0.7);
          xi === 0 ? ctx.moveTo(fx, fy) : ctx.lineTo(fx, fy);
        }
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        const [r, g, b, a] = mc[li];
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`; ctx.fill();

        // Snow cap on mountains
        if (period !== 'EVENING') {
          ctx.save(); ctx.clip();
          const scY = baseY - H * (0.08 + li * 0.012) * 0.75;
          const scG = ctx.createLinearGradient(0, scY - H * 0.04, 0, scY + H * 0.055);
          scG.addColorStop(0, `rgba(235,242,255,${0.65 - li * 0.12})`);
          scG.addColorStop(0.55, `rgba(215,228,252,${0.28 - li * 0.06})`);
          scG.addColorStop(1, 'rgba(200,218,250,0)');
          ctx.fillStyle = scG; ctx.fillRect(0, scY - H * 0.04, W, H * 0.09); ctx.restore();
        }
      });

      // ── 6. Pine tree forest ───────────────────────────────────────────────
      this._pines.sort((a, b) => a.depth - b.depth).forEach(tree => {
        tree.phase += tree.swSpd;
        const depthAlpha = [0.45, 0.68, 0.88][tree.depth];
        ctx.save(); ctx.globalAlpha = depthAlpha;
        this._drawPine(ctx, tree, period);
        ctx.restore();
      });

      // ── 7. Cabin with warm light (EVENING/NIGHT) ──────────────────────────
      if (period === 'EVENING' || period === 'NIGHT') {
        this._cabinLights.forEach(cl => {
          cl.phase += cl.spd;
          const flicker = 0.82 + 0.18 * Math.sin(cl.phase) + 0.08 * Math.sin(cl.phase * 2.3);
          // Warm window glow
          const wg = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.w * 3.5);
          wg.addColorStop(0, `rgba(255,200,90,${0.38 * flicker})`);
          wg.addColorStop(0.4, `rgba(240,165,55,${0.18 * flicker})`);
          wg.addColorStop(1, 'rgba(210,130,30,0)');
          ctx.fillStyle = wg; ctx.fillRect(cl.x - cl.w * 4, cl.y - cl.h * 4, cl.w * 8, cl.h * 8);
          // Window pane
          ctx.fillStyle = `rgba(255,210,110,${0.82 * flicker})`;
          ctx.beginPath(); ctx.roundRect(cl.x - cl.w, cl.y - cl.h, cl.w * 2, cl.h * 2, 2); ctx.fill();
        });

        // Chimney smoke puffs
        if (Math.random() < 0.04) {
          this._breath.push({
            x: this._cabinLights[0].x - W * 0.005,
            y: this._cabinLights[0].y - H * 0.08,
            r: 4 + Math.random() * 6,
            vx: (Math.random() - 0.5) * 0.4,
            vy: -(0.22 + Math.random() * 0.35),
            alpha: 0, maxAlpha: 0.18, life: 0, maxLife: 80 + Math.random() * 50|0,
          });
        }
        this._breath = this._breath.filter(b => {
          b.life++; b.x += b.vx; b.y += b.vy; b.r += 0.08;
          b.alpha = b.life < 12 ? b.life / 12 * b.maxAlpha
            : b.life > b.maxLife - 20 ? Math.max(0, (b.maxLife - b.life) / 20 * b.maxAlpha)
            : b.maxAlpha;
          ctx.save(); ctx.globalAlpha = b.alpha;
          ctx.fillStyle = 'rgba(200,205,218,1)';
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          return b.life < b.maxLife;
        });
      }

      // ── 8. Snow ground ────────────────────────────────────────────────────
      this._ground.forEach(layer => {
        const gCol = period === 'EVENING' ? [248, 195, 155] :
          period === 'NIGHT' ? [48, 62, 108] : [228, 238, 252];
        const gA = [0.70, 0.82, 0.92][layer.li];
        ctx.beginPath();
        ctx.moveTo(layer.pts[0].x, layer.pts[0].y);
        for (let i = 1; i < layer.pts.length; i++) {
          const p0 = layer.pts[i - 1], p1 = layer.pts[i];
          const mx = (p0.x + p1.x) * 0.5, my = (p0.y + p1.y) * 0.5;
          ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
        }
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        const gg = ctx.createLinearGradient(0, layer.pts[0].y, 0, H);
        gg.addColorStop(0, _rgb(gCol, gA));
        gg.addColorStop(1, _rgb(gCol, Math.min(1, gA + 0.12)));
        ctx.fillStyle = gg; ctx.fill();

        // Soft shadow under ground crest
        ctx.save();
        const sg = ctx.createLinearGradient(0, layer.pts[0].y, 0, layer.pts[0].y + H * 0.04);
        const shadowCol = period === 'NIGHT' ? 'rgba(20,28,70,' : 'rgba(140,165,210,';
        sg.addColorStop(0, shadowCol + '0.22)'); sg.addColorStop(1, shadowCol + '0)');
        ctx.fillStyle = sg; ctx.fillRect(0, layer.pts[0].y, W, H * 0.04); ctx.restore();
      });

      // ── 9. Bottom snow sparkle ─────────────────────────────────────────────
      if (period === 'AFTERNOON' || period === 'MORNING') {
        ctx.save(); ctx.globalAlpha = 0.40;
        for (let si = 0; si < 18; si++) {
          const sx = W * ((si * 0.17 + Math.sin(t + si) * 0.03 + 1) % 1);
          const sy = H * (0.78 + Math.random() * 0.18);
          const sa = 0.3 + 0.7 * Math.sin(t * 2.5 + si * 1.8);
          ctx.fillStyle = `rgba(255,255,255,${sa * 0.65})`;
          ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }

      // ── 10. Edge vignette ─────────────────────────────────────────────────
      const vigC = period === 'NIGHT' ? 'rgba(2,4,18,' : 'rgba(8,18,48,';
      const vigL = ctx.createLinearGradient(0, 0, W * 0.18, 0);
      vigL.addColorStop(0, vigC + '0.45)'); vigL.addColorStop(1, vigC + '0)');
      const vigR = ctx.createLinearGradient(W, 0, W * 0.82, 0);
      vigR.addColorStop(0, vigC + '0.45)'); vigR.addColorStop(1, vigC + '0)');
      ctx.fillStyle = vigL; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = vigR; ctx.fillRect(0, 0, W, H);
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
  sunset: {
    max: 52, rate: 0.10,
    _rays: null, _clouds: null, _palms: null, _gridLines: null, _stars: null,

    init(W, H) {
      const rng = (lo, hi) => lo + Math.random() * (hi - lo);
      _stars = [];

      this._rays = Array.from({ length: 9 }, (_, i) => ({
        angle: (-0.70 + i * 0.175) * Math.PI,
        width: W * (0.016 + rng(0, 0.020)),
        alpha: 0.025 + rng(0, 0.022),
        phase: rng(0, Math.PI * 2),
        spd: 0.0025 + rng(0, 0.003),
      }));

      this._clouds = Array.from({ length: 8 }, (_, i) => ({
        x: W * (0.04 + i * 0.13) + rng(-W * 0.06, W * 0.06),
        y: H * (0.15 + rng(0, 0.28)),
        w: W * (0.10 + rng(0, 0.16)),
        h: H * (0.038 + rng(0, 0.055)),
        alpha: 0.06 + rng(0, 0.10),
        phase: rng(0, Math.PI * 2), spd: 0.003 + rng(0, 0.004),
        hue: 285 + Math.floor(rng(-20, 20)),
      }));

      // Retro palm trees — silhouette
      this._palms = [
        { x: W * 0.07, h: H * 0.38, lean: 0.18, side: 1 },
        { x: W * 0.14, h: H * 0.30, lean: 0.08, side: -1 },
        { x: W * 0.88, h: H * 0.36, lean: -0.15, side: -1 },
        { x: W * 0.93, h: H * 0.28, lean: -0.06, side: 1 },
      ];

      // Perspective grid lines
      const vanishX = W * 0.50, vanishY = H * 0.60;
      this._gridLines = [];
      for (let gi = 0; gi <= 18; gi++) {
        this._gridLines.push({
          type: 'v',
          sx: W * (gi / 18), sy: H,
          ex: vanishX, ey: vanishY,
        });
      }
      for (let hi = 0; hi < 12; hi++) {
        const prog = hi / 11;
        const gy = vanishY + (H - vanishY) * prog * prog;
        this._gridLines.push({ type: 'h', y: gy, prog });
      }

      this._stars = Array.from({ length: 55 }, () => ({
        x: rng(0, W), y: rng(0, H * 0.65),
        r: 0.4 + rng(0, 1.2), alpha: 0.2 + rng(0, 0.65),
        phase: rng(0, Math.PI * 2), spd: 0.012 + rng(0, 0.022),
      }));
    },

    _drawPalm(ctx, palm, t, period) {
      const { x, h, lean } = palm;
      const baseY = H_CACHED;
      const tipX = x + lean * h;
      const tipY = baseY - h;

      const palmCol = 'rgba(8,4,2,0.92)';
      ctx.save();
      ctx.fillStyle = palmCol;
      ctx.lineWidth = h * 0.035; ctx.strokeStyle = palmCol;

      // Trunk (tapering bezier)
      ctx.beginPath();
      ctx.moveTo(x - h * 0.022, baseY);
      ctx.bezierCurveTo(
        x - h * 0.018 + lean * h * 0.3, baseY - h * 0.35,
        tipX - h * 0.010, tipY + h * 0.22,
        tipX, tipY
      );
      ctx.lineTo(tipX + h * 0.012, tipY);
      ctx.bezierCurveTo(
        tipX + h * 0.010, tipY + h * 0.22,
        x + h * 0.018 + lean * h * 0.3, baseY - h * 0.35,
        x + h * 0.022, baseY
      );
      ctx.closePath(); ctx.fill();

      // Fronds
      const fronds = 7;
      for (let fi = 0; fi < fronds; fi++) {
        const fa = ((fi / fronds) * Math.PI * 2) + Math.sin(t * 0.8 + fi) * 0.12;
        const fl = h * (0.35 + Math.abs(Math.sin(fa)) * 0.12);
        const fcpx = tipX + Math.cos(fa) * fl * 0.45;
        const fcpy = tipY + Math.sin(fa) * fl * 0.38 - h * 0.05;
        const fex = tipX + Math.cos(fa) * fl;
        const fey = tipY + Math.sin(fa) * fl;
        if (fey < baseY) {
          ctx.lineWidth = h * 0.018;
          ctx.beginPath(); ctx.moveTo(tipX, tipY);
          ctx.quadraticCurveTo(fcpx, fcpy, fex, fey);
          ctx.stroke();
        }
      }
      ctx.restore();
    },

    drawBackground(ctx, W, H) {
      // Cache H for palm drawing
      H_CACHED = H;
      const period = _getCanvasPeriod();
      const blend = _getSmoothBlend();
      const t = _frame * 0.012;

      // ── 1. Sky gradient ───────────────────────────────────────────────────
      const SKY = {
        MORNING:   { t:[22,14,55],  m:[110,50,130], b:[210,120,90] },
        AFTERNOON: { t:[18,8, 42],  m:[80, 25,110], b:[185,70, 65] },
        EVENING:   { t:[12,4, 28],  m:[55, 15,88],  b:[225,90, 30] },
        NIGHT:     { t:[4, 2, 18],  m:[18, 8, 45],  b:[45, 20, 75] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H);
      skyG.addColorStop(0,    _rgb(sk.t));
      skyG.addColorStop(0.45, _rgb(sk.m));
      skyG.addColorStop(1,    _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Stars ─────────────────────────────────────────────────────────
      this._stars.forEach(s => {
        s.phase += s.spd;
        const sa = s.alpha * (0.4 + 0.6 * Math.sin(s.phase));
        ctx.save(); ctx.globalAlpha = sa;
        ctx.fillStyle = 'rgba(255,225,255,1)';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // ── 3. Sun/Moon disc ─────────────────────────────────────────────────
      const sunX = W * 0.50, sunY = H * 0.60;
      if (period !== 'NIGHT') {
        const SUN_COL = {
          MORNING:   [255, 180, 200],
          AFTERNOON: [255, 140, 160],
          EVENING:   [255, 110, 60],
        };
        const sc = SUN_COL[period] || SUN_COL.AFTERNOON;
        const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, W * 0.32);
        sg.addColorStop(0,   _rgb(sc, 0.68));
        sg.addColorStop(0.18, _rgb(sc, 0.32));
        sg.addColorStop(0.50, _rgb(sc, 0.08));
        sg.addColorStop(1,   'rgba(180,40,100,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, H * 0.25, W, H * 0.55);
        // Hard sun disc
        ctx.fillStyle = _rgb(sc, 0.88);
        ctx.beginPath(); ctx.arc(sunX, sunY, W * 0.028, 0, Math.PI * 2); ctx.fill();
      }

      // ── 4. God rays ───────────────────────────────────────────────────────
      this._rays.forEach(r => {
        r.phase += r.spd;
        const a = r.alpha * (0.55 + 0.45 * Math.sin(r.phase));
        ctx.save();
        ctx.translate(sunX, sunY); ctx.rotate(r.angle);
        const rg = ctx.createLinearGradient(-r.width * 0.5, 0, r.width * 0.5, 0);
        const rHue = period === 'NIGHT' ? 280 : period === 'EVENING' ? 30 : 320;
        rg.addColorStop(0,   'rgba(200,80,200,0)');
        rg.addColorStop(0.5, `hsla(${rHue},85%,68%,${a})`);
        rg.addColorStop(1,   'rgba(200,80,200,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(-r.width * 0.5, -H * 0.1, r.width, H * 1.25);
        ctx.restore();
      });

      // ── 5. Retro perspective grid ─────────────────────────────────────────
      const GRID_COL = {
        MORNING:   [220, 80, 200],
        AFTERNOON: [200, 60, 200],
        EVENING:   [245, 50, 130],
        NIGHT:     [160, 40, 220],
      };
      const gc = GRID_COL[period] || GRID_COL.AFTERNOON;
      ctx.save();
      ctx.lineWidth = 0.8;
      this._gridLines.forEach(gl => {
        if (gl.type === 'v') {
          const a = 0.28 + 0.12 * Math.sin(t * 0.6);
          ctx.strokeStyle = `rgba(${gc[0]},${gc[1]},${gc[2]},${a})`;
          ctx.beginPath(); ctx.moveTo(gl.sx, gl.sy); ctx.lineTo(gl.ex, gl.ey); ctx.stroke();
        } else {
          const a = (0.08 + gl.prog * 0.32) * (0.6 + 0.4 * Math.sin(t * 0.8 + gl.prog * 2));
          ctx.strokeStyle = `rgba(${gc[0]},${gc[1]},${gc[2]},${a})`;
          ctx.beginPath(); ctx.moveTo(0, gl.y); ctx.lineTo(W, gl.y); ctx.stroke();
        }
      });
      ctx.restore();

      // ── 6. Grid floor fill ────────────────────────────────────────────────
      const flG = ctx.createLinearGradient(0, H * 0.60, 0, H);
      flG.addColorStop(0, 'rgba(12,4,28,0)');
      flG.addColorStop(1, 'rgba(4,2,18,0.82)');
      ctx.fillStyle = flG; ctx.fillRect(0, H * 0.60, W, H * 0.40);

      // ── 7. Neon horizon line ──────────────────────────────────────────────
      const hLineY = H * 0.60;
      const hlG = ctx.createLinearGradient(0, hLineY - 2, 0, hLineY + 2);
      hlG.addColorStop(0, `rgba(${gc[0]},${gc[1]},${gc[2]},0.06)`);
      hlG.addColorStop(0.5, `rgba(${gc[0]},${gc[1]},${gc[2]},0.55)`);
      hlG.addColorStop(1, `rgba(${gc[0]},${gc[1]},${gc[2]},0.06)`);
      ctx.fillStyle = hlG; ctx.fillRect(0, hLineY - 2, W, 4);
      // Glow
      const hlGlow = ctx.createLinearGradient(0, hLineY - 18, 0, hLineY + 18);
      hlGlow.addColorStop(0, `rgba(${gc[0]},${gc[1]},${gc[2]},0)`);
      hlGlow.addColorStop(0.5, `rgba(${gc[0]},${gc[1]},${gc[2]},0.18)`);
      hlGlow.addColorStop(1, `rgba(${gc[0]},${gc[1]},${gc[2]},0)`);
      ctx.fillStyle = hlGlow; ctx.fillRect(0, hLineY - 18, W, 36);

      // ── 8. Cloud wisps ────────────────────────────────────────────────────
      this._clouds.forEach(c => {
        c.phase += c.spd;
        const pulse = 0.72 + 0.28 * Math.sin(c.phase);
        ctx.save(); ctx.globalAlpha = c.alpha * pulse;
        const cg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.w * 0.52);
        cg.addColorStop(0, `hsla(${c.hue},72%,68%,1)`);
        cg.addColorStop(0.5, `hsla(${c.hue},65%,55%,0.5)`);
        cg.addColorStop(1, `hsla(${c.hue},58%,42%,0)`);
        ctx.scale(1, c.h / (c.w * 0.52));
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(c.x, c.y * c.w * 0.52 / c.h, c.w * 0.52, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // ── 9. Palm tree silhouettes ──────────────────────────────────────────
      this._palms.forEach(palm => this._drawPalm(ctx, palm, t, period));

      // ── 10. Scanline overlay (retro CRT effect) ───────────────────────────
      const scanA = 0.028;
      for (let sy = 0; sy < H; sy += 3) {
        ctx.fillStyle = `rgba(0,0,0,${scanA})`;
        ctx.fillRect(0, sy, W, 1);
      }

      // ── 11. Bottom vignette ───────────────────────────────────────────────
      const bv = ctx.createLinearGradient(0, H * 0.80, 0, H);
      bv.addColorStop(0, 'rgba(2,1,10,0)');
      bv.addColorStop(1, 'rgba(2,1,10,0.72)');
      ctx.fillStyle = bv; ctx.fillRect(0, H * 0.80, W, H * 0.20);
    },

    create(W, H) {
      const r = Math.random();
      if (r < 0.42) {
        return {
          type: 'ember',
          x: W * 0.12 + Math.random() * W * 0.76,
          y: H * 0.55 + Math.random() * H * 0.42,
          vx: (Math.random() - 0.5) * 1.4, vy: -(0.52 + Math.random() * 1.45),
          r: 1.0 + Math.random() * 3.5,
          hue: [300, 320, 340, 20, 38, 270][Math.floor(Math.random() * 6)],
          alpha: 0, maxAlpha: 0.60 + Math.random() * 0.32,
          life: 0, fadeIn: 10, maxLife: 75 + Math.floor(Math.random() * 60),
          sw: Math.random() * Math.PI * 2, swAmp: 0.8 + Math.random() * 2.2, swSpd: 0.016 + Math.random() * 0.024,
        };
      } else if (r < 0.72) {
        return {
          type: 'mote',
          x: Math.random() * W, y: H * 0.28 + Math.random() * H * 0.58,
          vx: (Math.random() - 0.5) * 0.48, vy: -(0.07 + Math.random() * 0.22),
          r: 0.7 + Math.random() * 1.6,
          hue: 285 + Math.floor(Math.random() * 65),
          alpha: 0, maxAlpha: 0.20 + Math.random() * 0.22,
          life: 0, fadeIn: 22, maxLife: 175 + Math.floor(Math.random() * 105),
          sw: Math.random() * Math.PI * 2, swAmp: 0.45 + Math.random() * 1.0, swSpd: 0.009 + Math.random() * 0.013,
        };
      } else {
        return {
          type: 'bird',
          x: Math.random() < 0.5 ? -40 : W + 40,
          y: H * 0.10 + Math.random() * H * 0.38,
          vx: (Math.random() < 0.5 ? 1 : -1) * (0.75 + Math.random() * 1.5),
          vy: (Math.random() - 0.5) * 0.22,
          sz: 5 + Math.random() * 9, flapPhase: Math.random() * Math.PI * 2,
          alpha: 0, maxAlpha: 0.65 + Math.random() * 0.28,
          life: 0, fadeIn: 15,
        };
      }
    },

    draw(ctx, p) {
      ctx.save(); ctx.globalAlpha = p.alpha;
      if (p.type === 'ember') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.0);
        g.addColorStop(0,    `hsla(${p.hue + 25},100%,92%,1)`);
        g.addColorStop(0.35, `hsla(${p.hue},     94%,68%,0.72)`);
        g.addColorStop(1,    `hsla(${p.hue - 10},80%,42%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.0, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'mote') {
        ctx.fillStyle = `hsla(${p.hue},88%,72%,1)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else {
        const d = p.vx > 0 ? 1 : -1;
        const f = Math.sin(p.flapPhase) * p.sz * 0.58;
        ctx.fillStyle = 'rgba(6,3,14,0.92)';
        [[0, d], [d, -d]].forEach(([mx, ex]) => {
          ctx.beginPath();
          ctx.moveTo(p.x + mx * p.sz * 0.02, p.y);
          ctx.quadraticCurveTo(p.x + ex * p.sz * 0.52, p.y - f, p.x + ex * p.sz, p.y);
          ctx.quadraticCurveTo(p.x + ex * p.sz * 0.52, p.y + f * 0.55, p.x + mx * p.sz * 0.02, p.y);
          ctx.fill();
        });
      }
      ctx.restore();
    },

    update(p, W, H) {
      p.life++;
      if (p.sw !== undefined) { p.sw += p.swSpd; p.x += p.vx + Math.sin(p.sw) * p.swAmp; } else p.x += p.vx;
      p.y += p.vy;
      if (p.flapPhase !== undefined) p.flapPhase += 0.13;
      const fi = Math.min(1, p.life / p.fadeIn);
      const fo = (p.maxLife && p.life > p.maxLife - 18) ? Math.max(0, (p.maxLife - p.life) / 18) : 1;
      p.alpha = p.maxAlpha * fi * fo;
      if (p.type === 'bird') return p.x > -80 && p.x < W + 80;
      return p.life < p.maxLife && p.y > -25;
    },
  },

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

      // ── 1. Night sky gradient ─────────────────────────────────────────────
      const SKY = {
        MORNING:   { t:[22,12,52], m:[42,25,88], b:[65,38,88] },
        AFTERNOON: { t:[28,18,65], m:[52,30,98], b:[75,45,95] },
        EVENING:   { t:[8, 5, 28], m:[18,10,52], b:[32,18,72] },
        NIGHT:     { t:[2, 1, 12], m:[6,  4, 28], b:[12, 8, 42] },
      };
      const sk = _blendPeriodColors(SKY, blend);
      const skyG = ctx.createLinearGradient(0, 0, 0, H * 0.68);
      skyG.addColorStop(0, _rgb(sk.t)); skyG.addColorStop(1, _rgb(sk.b));
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, H);

      // ── 2. Stars ─────────────────────────────────────────────────────────
      const starVis = period === 'NIGHT' ? 0.90 : period === 'EVENING' ? 0.45 : 0.12;
      this._stars.forEach(s => {
        s.phase += s.spd;
        const a = s.alpha * starVis * (0.35 + 0.65 * Math.sin(s.phase));
        if (a < 0.02) return;
        ctx.save(); ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(200,210,255,1)';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // ── 3. Moon ───────────────────────────────────────────────────────────
      const moonVis = period === 'NIGHT' ? 1.0 : period === 'EVENING' ? 0.60 : 0;
      if (moonVis > 0) {
        this._moon.phase += 0.008;
        const moonG = ctx.createRadialGradient(this._moon.x, this._moon.y, 0, this._moon.x, this._moon.y, this._moon.r * 4.5);
        moonG.addColorStop(0, 'rgba(180,220,255,0.18)');
        moonG.addColorStop(1, 'rgba(140,180,255,0)');
        ctx.save(); ctx.globalAlpha = moonVis;
        ctx.fillStyle = moonG; ctx.fillRect(this._moon.x - this._moon.r * 5, this._moon.y - this._moon.r * 5, this._moon.r * 10, this._moon.r * 10);
        ctx.fillStyle = 'rgba(210,235,255,0.90)';
        ctx.beginPath(); ctx.arc(this._moon.x, this._moon.y, this._moon.r, 0, Math.PI * 2); ctx.fill();
        // Moon craters
        ctx.fillStyle = 'rgba(170,200,240,0.30)';
        [[this._moon.r * 0.28, -this._moon.r * 0.22, this._moon.r * 0.14],
         [-this._moon.r * 0.18, this._moon.r * 0.20, this._moon.r * 0.10],
         [this._moon.r * 0.08, this._moon.r * 0.32, this._moon.r * 0.07]].forEach(([ox,oy,cr]) => {
          ctx.beginPath(); ctx.arc(this._moon.x + ox, this._moon.y + oy, cr, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
      }

      // ── 4. Day sun glow (morning/afternoon) ──────────────────────────────
      if (period === 'MORNING' || period === 'AFTERNOON') {
        const sunVis = period === 'MORNING' ? 0.45 : 0.35;
        const sunX = W * 0.65, sunY = H * 0.08;
        const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, W * 0.28);
        sg.addColorStop(0, `rgba(180,140,255,${sunVis * 0.8})`);
        sg.addColorStop(0.35, `rgba(140,90,220,${sunVis * 0.3})`);
        sg.addColorStop(1, 'rgba(90,50,160,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H * 0.40);
      }

      // ── 5. Buildings ─────────────────────────────────────────────────────
      this._buildings.sort((a, b) => b.layer - a.layer).forEach(bld => {
        bld.phase += 0.012;
        const byA = H * 0.02 * bld.layer;

        // Building base color
        const dark = period === 'NIGHT' ? 6 : period === 'EVENING' ? 10 : 14;
        const bc = ctx.createLinearGradient(bld.x, bld.baseY - bld.bH, bld.x + bld.bW, bld.baseY);
        bc.addColorStop(0, `hsl(${bld.hue},40%,${dark + bld.layer * 4}%)`);
        bc.addColorStop(1, `hsl(${bld.hue},35%,${dark}%)`);
        ctx.fillStyle = bc;
        ctx.fillRect(bld.x, bld.baseY - bld.bH - byA, bld.bW, bld.bH + byA);

        // Windows grid
        const wW = bld.bW / (bld.windowsW + 1) * 0.72;
        const wH = bld.bH / (bld.windowsH + 1) * 0.45;
        for (let wr = 0; wr < bld.windowsH; wr++) {
          for (let wc2 = 0; wc2 < bld.windowsW; wc2++) {
            const wx = bld.x + (wc2 + 0.65) * bld.bW / (bld.windowsW + 0.5);
            const wy = bld.baseY - bld.bH - byA + (wr + 0.8) * bld.bH / (bld.windowsH + 0.5);
            const lit = Math.sin(bld.phase + wr * 0.8 + wc2 * 1.3) > 0.12;
            if (lit || period === 'AFTERNOON') {
              const wa = period === 'NIGHT' ? 0.82 : period === 'EVENING' ? 0.65 : 0.35;
              const wHue = Math.sin(bld.phase * 0.5 + wr + wc2) > 0.5 ? bld.hue : bld.hue + 60;
              ctx.fillStyle = `hsla(${wHue},${period==='AFTERNOON'?30:88}%,${period==='AFTERNOON'?55:68}%,${wa})`;
              ctx.fillRect(wx - wW * 0.5, wy - wH * 0.5, wW, wH);
              // Window glow
              if (lit && period !== 'AFTERNOON') {
                const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wW * 2.5);
                wg.addColorStop(0, `hsla(${wHue},90%,72%,0.14)`);
                wg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = wg; ctx.fillRect(wx - wW * 2.5, wy - wH * 2.5, wW * 5, wH * 5);
              }
            }
          }
        }

        // Antenna / spire
        if (bld.antennaH > 10) {
          const ax = bld.x + bld.bW * 0.5;
          const ay = bld.baseY - bld.bH - byA;
          ctx.strokeStyle = `hsl(${bld.hue},50%,${dark + 10}%)`;
          ctx.lineWidth = 1.5; ctx.beginPath();
          ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - bld.antennaH); ctx.stroke();
          // Beacon blink
          const beacon = (Math.sin(_frame * 0.08 + bld.phase) > 0.6);
          if (beacon) {
            ctx.fillStyle = `hsla(${bld.hue},92%,72%,0.85)`;
            ctx.beginPath(); ctx.arc(ax, ay - bld.antennaH, 2.5, 0, Math.PI * 2); ctx.fill();
          }
        }
      });

      // ── 6. Neon signs ─────────────────────────────────────────────────────
      this._signs.forEach(sg => {
        sg.phase += sg.spd;
        if (sg.flicker && Math.random() < 0.04) sg.on = !sg.on;
        const svA = sg.on ? (period === 'NIGHT' ? 0.88 : period === 'EVENING' ? 0.70 : 0.40) : 0;
        if (svA < 0.02) return;
        const pulse = 0.78 + 0.22 * Math.sin(sg.phase);
        // Glow behind sign
        const gBig = ctx.createRadialGradient(sg.x, sg.y, 0, sg.x, sg.y, sg.w * 2.5);
        gBig.addColorStop(0, `hsla(${sg.hue},92%,62%,${svA * pulse * 0.35})`);
        gBig.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gBig; ctx.fillRect(sg.x - sg.w * 2.5, sg.y - sg.h * 2.5, sg.w * 5, sg.h * 5);
        // Sign body
        ctx.save(); ctx.globalAlpha = svA * pulse;
        ctx.strokeStyle = `hsla(${sg.hue},95%,72%,1)`;
        ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.strokeRect(sg.x - sg.w * 0.5, sg.y - sg.h * 0.5, sg.w, sg.h);
        ctx.restore();
      });

      // ── 7. Moving car light streaks ───────────────────────────────────────
      const streetY = H * 0.82;
      this._cars.forEach(car => {
        car.x += car.speed;
        if (car.speed > 0 && car.x > W + car.sz * 4) car.x = -car.sz * 4;
        if (car.speed < 0 && car.x < -car.sz * 4) car.x = W + car.sz * 4;
        const carY = streetY + car.lane * H * 0.028;
        const dir = car.speed > 0 ? 1 : -1;
        const trailLen = car.sz * (3.5 + Math.abs(car.speed) * 0.5);

        // Headlights
        const hue1 = car.speed > 0 ? car.hue : (car.hue + 180) % 360;
        const cg = ctx.createLinearGradient(car.x, 0, car.x + dir * trailLen, 0);
        cg.addColorStop(0, `hsla(${hue1},92%,75%,0.78)`);
        cg.addColorStop(0.35, `hsla(${hue1},88%,62%,0.32)`);
        cg.addColorStop(1, `hsla(${hue1},80%,48%,0)`);
        ctx.fillStyle = cg;
        ctx.fillRect(Math.min(car.x, car.x + dir * trailLen), carY - 2, trailLen, 4);

        // Car reflection in wet street
        const refA = 0.22;
        const rg = ctx.createLinearGradient(car.x, carY, car.x, carY + H * 0.06);
        rg.addColorStop(0, `hsla(${hue1},90%,68%,${refA})`);
        rg.addColorStop(1, `hsla(${hue1},80%,50%,0)`);
        ctx.fillStyle = rg; ctx.fillRect(car.x - car.sz * 0.3, carY, car.sz * 0.6, H * 0.06);
      });

      // ── 8. Wet street (reflective ground) ─────────────────────────────────
      const stG = ctx.createLinearGradient(0, H * 0.75, 0, H);
      const STREET = {
        MORNING:   [8,5,22],  AFTERNOON: [12,8,30],
        EVENING:   [5,3,15],  NIGHT:     [2,1,10],
      };
      const stc = STREET[period] || STREET.NIGHT;
      stG.addColorStop(0, _rgb(stc, 0));
      stG.addColorStop(0.3, _rgb(stc, 0.72));
      stG.addColorStop(1, _rgb(stc, 0.92));
      ctx.fillStyle = stG; ctx.fillRect(0, H * 0.75, W, H * 0.25);

      // Street reflection glow from neon signs
      ctx.save(); ctx.globalAlpha = period === 'NIGHT' ? 0.22 : 0.10;
      this._signs.forEach(sg => {
        if (!sg.on) return;
        const rg2 = ctx.createRadialGradient(sg.x, H * 0.92, 0, sg.x, H * 0.92, sg.w * 4);
        rg2.addColorStop(0, `hsla(${sg.hue},90%,65%,0.28)`);
        rg2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg2; ctx.fillRect(sg.x - sg.w * 4, H * 0.80, sg.w * 8, H * 0.20);
      });
      ctx.restore();

      // ── 9. Edge / sky vignette ────────────────────────────────────────────
      const vigC = 'rgba(0,0,5,';
      [ctx.createLinearGradient(0,0,W*0.15,0), ctx.createLinearGradient(W,0,W*0.85,0)].forEach((vg, i) => {
        vg.addColorStop(0, vigC + '0.58)'); vg.addColorStop(1, vigC + '0)');
        ctx.fillStyle = vg; ctx.fillRect(i===0?0:W*0.85, 0, W*0.15, H);
      });
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

      // ── 1. Room wall — warm plaster ───────────────────────────────────────
      const WALL = {
        MORNING:   { t:[165,125,88], b:[140,100,68] },
        AFTERNOON: { t:[172,132,92], b:[148,108,72] },
        EVENING:   { t:[155,105,65], b:[128,82,48] },
        NIGHT:     { t:[82, 55,32],  b:[62, 40,22]  },
      };
      const wc = _blendPeriodColors(WALL, blend);
      const wallG = ctx.createLinearGradient(0, 0, 0, H);
      wallG.addColorStop(0, _rgb(wc.t)); wallG.addColorStop(1, _rgb(wc.b));
      ctx.fillStyle = wallG; ctx.fillRect(0, 0, W, H);

      // ── 2. Ambient fireplace glow on walls ────────────────────────────────
      const fireA = period === 'NIGHT' ? 0.38 : period === 'EVENING' ? 0.28 : 0.15;
      const fireFlicker = 0.82 + 0.18 * Math.sin(t * 5.5) + 0.08 * Math.sin(t * 11.2);
      const fireGlow = ctx.createRadialGradient(W * 0.5, H * 0.90, 0, W * 0.5, H * 0.90, W * 0.62);
      fireGlow.addColorStop(0,   `rgba(255,180,80,${fireA * fireFlicker * 0.80})`);
      fireGlow.addColorStop(0.30, `rgba(245,140,45,${fireA * fireFlicker * 0.35})`);
      fireGlow.addColorStop(0.65, `rgba(220,100,22,${fireA * fireFlicker * 0.10})`);
      fireGlow.addColorStop(1,   'rgba(180,70,10,0)');
      ctx.fillStyle = fireGlow; ctx.fillRect(0, 0, W, H);

      // ── 3. Window (left side, rain outside) ──────────────────────────────
      const winX = W * 0.04, winY = H * 0.12, winW = W * 0.24, winH = H * 0.45;
      // Window frame (dark wood)
      const frameW = W * 0.012;
      ctx.fillStyle = period === 'NIGHT' ? 'rgba(32,20,10,0.95)' : 'rgba(52,32,14,0.92)';
      ctx.fillRect(winX - frameW, winY - frameW, winW + frameW*2, winH + frameW*2);
      // Window glass (slightly transparent, shows outside night/rain)
      const outsideCol = period === 'NIGHT' ? [8, 10, 28] :
        period === 'EVENING' ? [22, 18, 45] : [55, 75, 110];
      const wg = ctx.createLinearGradient(winX, winY, winX, winY + winH);
      wg.addColorStop(0, _rgb(outsideCol, 0.88));
      wg.addColorStop(1, _rgb(outsideCol, 0.95));
      ctx.fillStyle = wg; ctx.fillRect(winX, winY, winW, winH);
      // Window cross bar
      ctx.fillStyle = period === 'NIGHT' ? 'rgba(32,20,10,0.92)' : 'rgba(52,32,14,0.88)';
      ctx.fillRect(winX, winY + winH * 0.5 - frameW * 0.5, winW, frameW);
      ctx.fillRect(winX + winW * 0.5 - frameW * 0.5, winY, frameW, winH);

      // Rain on window (clipped to window)
      ctx.save(); ctx.beginPath(); ctx.rect(winX, winY, winW, winH); ctx.clip();
      this._rainDrops.forEach(rd => {
        rd.y += rd.speed;
        if (rd.y > winY + winH) rd.y = winY - rd.len;
        ctx.save(); ctx.globalAlpha = rd.alpha;
        ctx.strokeStyle = 'rgba(165,195,230,1)';
        ctx.lineWidth = rd.width; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(winX + rd.x, rd.y);
        ctx.lineTo(winX + rd.x + rd.len * 0.08, rd.y + rd.len);
        ctx.stroke();
        ctx.restore();
      });
      // Outside light blur
      if (period !== 'NIGHT') {
        const streetLamp = ctx.createRadialGradient(winX + winW * 0.7, winY + winH * 0.65, 0, winX + winW * 0.7, winY + winH * 0.65, winW * 0.45);
        streetLamp.addColorStop(0, 'rgba(255,220,140,0.22)');
        streetLamp.addColorStop(1, 'rgba(200,180,100,0)');
        ctx.fillStyle = streetLamp; ctx.fillRect(winX, winY, winW, winH);
      }
      ctx.restore();

      // Window glass sheen
      ctx.save(); ctx.globalAlpha = 0.06;
      ctx.fillStyle = 'rgba(200,225,255,1)';
      ctx.fillRect(winX, winY, winW * 0.15, winH);
      ctx.restore();

      // ── 4. Warm lamp (upper right) ────────────────────────────────────────
      const lampX = W * 0.85, lampY = H * 0.18;
      const lampA = period === 'NIGHT' ? 0.55 : period === 'EVENING' ? 0.40 : 0.22;
      const lampG = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, W * 0.38);
      lampG.addColorStop(0,    `rgba(255,210,120,${lampA * 0.90})`);
      lampG.addColorStop(0.22, `rgba(245,185,85,${lampA * 0.42})`);
      lampG.addColorStop(0.55, `rgba(225,155,55,${lampA * 0.12})`);
      lampG.addColorStop(1,    'rgba(200,130,40,0)');
      ctx.fillStyle = lampG; ctx.fillRect(0, 0, W, H);
      // Lamp shade silhouette
      ctx.fillStyle = period === 'NIGHT' ? 'rgba(22,14,6,0.90)' : 'rgba(38,24,10,0.85)';
      ctx.beginPath();
      ctx.moveTo(lampX - W * 0.045, lampY);
      ctx.lineTo(lampX + W * 0.045, lampY);
      ctx.lineTo(lampX + W * 0.025, lampY + H * 0.04);
      ctx.lineTo(lampX - W * 0.025, lampY + H * 0.04);
      ctx.closePath(); ctx.fill();
      // Lamp pole
      ctx.fillRect(lampX - W * 0.004, lampY + H * 0.04, W * 0.008, H * 0.10);

      // ── 5. Bookshelf ──────────────────────────────────────────────────────
      const shelfY = H * 0.70;
      // Shelf board
      ctx.fillStyle = period === 'NIGHT' ? 'rgba(38,24,10,0.92)' : 'rgba(72,45,18,0.88)';
      ctx.fillRect(W * 0.04 - W * 0.01, shelfY, W * 0.25, H * 0.015);
      // Books
      this._books.forEach((bk, bi) => {
        ctx.save();
        ctx.translate(W * 0.04 + bi * (W * 0.23 / 14) + bk.w * 0.5, shelfY);
        ctx.rotate(bk.lean);
        const bookDark = period === 'NIGHT' ? 0.65 : 1.0;
        ctx.fillStyle = `hsla(${bk.hue},${58}%,${28 + Math.sin(bi * 1.7) * 8}%,${bookDark})`;
        ctx.fillRect(-bk.w * 0.5, -bk.h, bk.w, bk.h);
        // Spine line
        ctx.fillStyle = `hsla(${bk.hue + 25},70%,${48}%,${bookDark * 0.55})`;
        ctx.fillRect(-bk.w * 0.5 + 1, -bk.h + bk.h * 0.12, bk.w - 2, bk.h * 0.05);
        ctx.restore();
      });

      // ── 6. Fireplace ──────────────────────────────────────────────────────
      const fpX = W * 0.5, fpW = W * 0.22, fpH = H * 0.22, fpY = H * 0.98;
      // Mantle
      ctx.fillStyle = period === 'NIGHT' ? 'rgba(28,18,8,0.98)' : 'rgba(55,35,14,0.95)';
      ctx.fillRect(fpX - fpW * 0.6, fpY - fpH, fpW * 1.2, H * 0.015); // top mantle
      ctx.fillRect(fpX - fpW * 0.55, fpY - fpH + H * 0.012, fpW * 0.06, fpH); // left pillar
      ctx.fillRect(fpX + fpW * 0.49, fpY - fpH + H * 0.012, fpW * 0.06, fpH); // right pillar
      // Firebox opening (dark)
      ctx.fillStyle = 'rgba(8,4,2,0.95)';
      ctx.beginPath();
      ctx.roundRect(fpX - fpW * 0.40, fpY - fpH + H * 0.025, fpW * 0.80, fpH * 0.80, [H * 0.015, H * 0.015, 0, 0]);
      ctx.fill();

      // Animated fire inside firebox
      this._fireParticles.forEach((fp, i) => {
        fp.life++;
        if (fp.life > fp.maxLife) {
          fp.life = 0; fp.maxLife = 35 + Math.random() * 25|0;
          fp.x = fpX + (Math.random() - 0.5) * fpW * 0.55;
          fp.y = fpY - H * 0.05;
          fp.vx = (Math.random() - 0.5) * 0.65;
          fp.vy = -(0.55 + Math.random() * 1.0);
          fp.r = 5 + Math.random() * 18;
          fp.hue = 10 + Math.random() * 35|0;
        }
        fp.x += fp.vx + Math.sin(t * 2.2 + i) * 0.45;
        fp.y += fp.vy;
        fp.vy -= 0.012; // flame rises faster
        const prog = fp.life / fp.maxLife;
        fp.alpha = Math.sin(prog * Math.PI) * 0.82;
        const flameHue = _lrp(fp.hue, fp.hue + 25, prog);
        const flameLit = _lrp(70, 90, prog);
        const fG = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, fp.r * (1.5 - prog * 0.6));
        fG.addColorStop(0,   `hsla(${flameHue+15},100%,${flameLit}%,${fp.alpha * 1.2})`);
        fG.addColorStop(0.38, `hsla(${flameHue},95%,${flameLit-10}%,${fp.alpha * 0.8})`);
        fG.addColorStop(1,   `hsla(${fp.hue-8},88%,42%,0)`);
        ctx.save();
        ctx.beginPath(); ctx.rect(fpX - fpW * 0.40, fpY - fpH + H * 0.025, fpW * 0.80, fpH * 0.80); ctx.clip();
        ctx.fillStyle = fG; ctx.beginPath(); ctx.arc(fp.x, fp.y, fp.r * (1.5 - prog * 0.6), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // ── 7. Candles ───────────────────────────────────────────────────────
      this._candles.forEach(cd => {
        cd.phase += cd.spd;
        const flicker = 0.80 + 0.20 * Math.sin(cd.phase) + 0.08 * Math.sin(cd.phase * 2.7);
        // Candle body
        ctx.fillStyle = 'rgba(248,238,220,0.92)';
        ctx.fillRect(cd.x - cd.r, cd.y - cd.h, cd.r * 2, cd.h);
        // Flame
        const flameFl = Math.sin(cd.phase * 1.8) * 2.5;
        const fmG = ctx.createRadialGradient(cd.x + flameFl, cd.y - cd.h - cd.h * 0.5, 0, cd.x + flameFl, cd.y - cd.h, cd.r * 3.5);
        fmG.addColorStop(0,   `rgba(255,248,188,${0.92 * flicker})`);
        fmG.addColorStop(0.35, `rgba(255,200,80,${0.65 * flicker})`);
        fmG.addColorStop(0.65, `rgba(240,140,30,${0.28 * flicker})`);
        fmG.addColorStop(1,   'rgba(200,90,10,0)');
        ctx.fillStyle = fmG; ctx.fillRect(cd.x - cd.r * 4, cd.y - cd.h - cd.h * 0.9, cd.r * 8, cd.h * 0.9);
        // Flame shape
        ctx.fillStyle = `rgba(255,240,150,${0.88 * flicker})`;
        ctx.beginPath();
        ctx.moveTo(cd.x + flameFl, cd.y - cd.h - cd.h * 0.65);
        ctx.bezierCurveTo(cd.x + flameFl - cd.r, cd.y - cd.h - cd.h * 0.32, cd.x - cd.r, cd.y - cd.h + 2, cd.x, cd.y - cd.h);
        ctx.bezierCurveTo(cd.x + cd.r, cd.y - cd.h + 2, cd.x + flameFl + cd.r, cd.y - cd.h - cd.h * 0.32, cd.x + flameFl, cd.y - cd.h - cd.h * 0.65);
        ctx.fill();
        // Candle glow on surrounding area
        const cgG = ctx.createRadialGradient(cd.x, cd.y - cd.h, 0, cd.x, cd.y - cd.h, cd.r * 8 * flicker);
        cgG.addColorStop(0, `rgba(255,200,90,${0.22 * flicker * (period === 'NIGHT' ? 1.4 : 0.8)})`);
        cgG.addColorStop(1, 'rgba(240,160,50,0)');
        ctx.fillStyle = cgG; ctx.fillRect(cd.x - cd.r * 9, cd.y - cd.h * 1.5 - cd.r * 8, cd.r * 18, cd.r * 16);
      });

      // ── 8. Hot mug (bottom right) ─────────────────────────────────────────
      const mugX = W * 0.66, mugY = H * 0.90;
      const mugW = W * 0.032, mugH = H * 0.038;
      // Mug body
      ctx.fillStyle = period === 'NIGHT' ? 'rgba(58,28,12,0.95)' : 'rgba(105,52,22,0.90)';
      ctx.beginPath();
      ctx.roundRect(mugX - mugW, mugY - mugH, mugW * 2, mugH, [mugW * 0.3, mugW * 0.3, mugW * 0.5, mugW * 0.5]);
      ctx.fill();
      // Mug handle
      ctx.strokeStyle = period === 'NIGHT' ? 'rgba(48,22,8,0.95)' : 'rgba(88,42,14,0.90)';
      ctx.lineWidth = W * 0.006; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(mugX + mugW, mugY - mugH * 0.42, mugW * 0.55, -0.5, 0.5, false);
      ctx.stroke();
      // Hot liquid surface
      ctx.fillStyle = 'rgba(165,88,28,0.75)';
      ctx.beginPath(); ctx.ellipse(mugX, mugY - mugH, mugW * 0.82, mugH * 0.12, 0, 0, Math.PI * 2); ctx.fill();

      // Steam wisps
      this._steam.forEach(st => {
        st.life++;
        if (st.life > st.maxLife) {
          st.life = 0; st.maxLife = 55 + Math.random() * 35|0;
          st.x = mugX + (Math.random() - 0.5) * mugW * 1.2;
          st.y = mugY - mugH - 2;
          st.vy = -(0.28 + Math.random() * 0.25);
        }
        st.sw += st.swSpd;
        st.x += st.vx + Math.sin(st.sw) * st.swAmp * 0.4;
        st.y += st.vy;
        st.r += 0.04;
        const prog = st.life / st.maxLife;
        const stA = Math.sin(prog * Math.PI) * st.maxAlpha;
        ctx.save(); ctx.globalAlpha = stA;
        ctx.fillStyle = 'rgba(215,205,200,1)';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      // ── 9. Wooden floor ───────────────────────────────────────────────────
      const floorY = H * 0.88;
      const floorG = ctx.createLinearGradient(0, floorY, 0, H);
      const FLOOR = {
        MORNING:   { t:[95,60,28], b:[72,44,18] },
        AFTERNOON: { t:[100,65,30], b:[78,48,20] },
        EVENING:   { t:[88,52,20], b:[65,38,12] },
        NIGHT:     { t:[42,25,8], b:[28,15,4] },
      };
      const fc = _blendPeriodColors(FLOOR, blend);
      floorG.addColorStop(0, _rgb(fc.t)); floorG.addColorStop(1, _rgb(fc.b));
      ctx.fillStyle = floorG; ctx.fillRect(0, floorY, W, H - floorY);
      // Floorboard lines
      ctx.save(); ctx.globalAlpha = period === 'NIGHT' ? 0.12 : 0.18;
      ctx.strokeStyle = 'rgba(35,15,4,1)'; ctx.lineWidth = 0.8;
      for (let flb = 0; flb < 8; flb++) {
        const fy = floorY + flb * (H - floorY) / 8;
        ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
      }
      ctx.restore();

      // Fireplace glow reflection on floor
      const flRef = ctx.createLinearGradient(0, floorY, 0, H);
      flRef.addColorStop(0, `rgba(255,160,60,${fireA * fireFlicker * 0.35})`);
      flRef.addColorStop(1, `rgba(220,120,30,${fireA * fireFlicker * 0.10})`);
      const refW = fpW * 1.8;
      ctx.fillStyle = flRef; ctx.fillRect(fpX - refW, floorY, refW * 2, H - floorY);

      // ── 10. Cozy vignette — warm dark corners ─────────────────────────────
      const vigG = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.18, W * 0.5, H * 0.5, W * 0.72);
      vigG.addColorStop(0, 'rgba(0,0,0,0)');
      vigG.addColorStop(0.68, 'rgba(0,0,0,0)');
      vigG.addColorStop(1, `rgba(${period === 'NIGHT' ? '2,1,0' : '8,4,1'},0.72)`);
      ctx.fillStyle = vigG; ctx.fillRect(0, 0, W, H);
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

  // ── Matrix — keep pristine ────────────────────────────────────────────────
  matrix: {
    max: 0, rate: 0,
    _cols: null,

    _mc() {
      return Math.random() < 0.55
        ? (Math.random() > 0.5 ? '0' : '1')
        : String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96));
    },

    init(W, H) {
      _stars = [];
      const n = Math.floor(W / 14);
      this._cols = Array.from({ length: n }, (_, i) => ({
        x: i * 14 + 7,
        y: -Math.random() * H * 2,
        speed: 0.8 + Math.random() * 2.2,
        chars: Array.from({ length: 32 }, () => ({ c: this._mc(), age: 0, maxAge: 6 + Math.floor(Math.random() * 12) })),
        head: 0,
        bright: Math.random() > 0.88,
      }));
    },

    drawBackground(ctx, W, H) {
      ctx.fillStyle = 'rgba(0, 2, 0, 0.18)';
      ctx.fillRect(0, 0, W, H);
      if (!this._cols) return;
      this._cols.forEach(col => {
        col.y += col.speed;
        if (col.y > H + 280) {
          col.y = -Math.random() * H * 0.6;
          col.speed = 0.8 + Math.random() * 2.2;
          col.bright = Math.random() > 0.88;
        }
        col.chars.forEach((ch, i) => {
          ch.age++;
          if (ch.age >= ch.maxAge) { ch.c = this._mc(); ch.age = 0; ch.maxAge = 6 + Math.floor(Math.random() * 12); }
          const charY = col.y - i * 14;
          if (charY < -14 || charY > H + 14) return;
          const isHead = i === 0;
          const distFromHead = i;
          const fade = Math.max(0, 1 - distFromHead / 22);
          if (fade < 0.02) return;
          const alpha = isHead ? (col.bright ? 1.0 : 0.92) : fade * (col.bright ? 0.85 : 0.65);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.font = `${13}px monospace`;
          ctx.fillStyle = isHead ? (col.bright ? '#e0ffe0' : '#c8ffc8') : `rgba(0,${Math.floor(140 + fade * 115)},0,1)`;
          ctx.fillText(ch.c, col.x - 5, charY);
          ctx.restore();
        });
      });
    },

    create() { return null; },
    draw() {},
    update() { return false; },
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
                           'theme-snow','theme-sunset','theme-anime','theme-matrix','theme-neon','theme-cozy'];

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

    // Also update ThemeCanvas when theme changes
    Settings.onChange('fullTheme', (v) => {
      ThemeCanvas.setTheme(v || 'galaxy');
    });

    // ── Time-of-day atmosphere ────────────────────────────────────────────
    // Only galaxy, classic, matrix are fully immune (no time canvas logic).
    // All scene themes (forest, cherry, ocean, snow, sunset, anime, neon, cozy)
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
      galaxy:    '#0d0820', classic:   '#111111', forest:    '#1a2e1a',
      cherry:    '#2e1220', ocean:     '#0a1e2e',  snow:      '#1a1e2e',
      sunset:    '#1a0a1e', anime:     '#150a20',  matrix:    '#000800',
      neon:      '#08001e', cozy:      '#1e100a',
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
      'glowIntensity','themeParticles','pipOpacity','pipShape','companionPos'];

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
