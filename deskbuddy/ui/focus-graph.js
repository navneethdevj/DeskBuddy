/**
 * FocusGraph — Post-session attention graph.
 *
 * Draws an animated bezier focus-level curve onto a supplied <canvas> element.
 * The curve reveals itself left-to-right over 1.5 seconds using
 * requestAnimationFrame and a clip-rect reveal technique.
 *
 * The curve is drawn in segments coloured by the focus state of each data
 * point — green (FOCUSED), amber (DRIFTING), red (DISTRACTED/CRITICAL/FAILED).
 * Distraction markers (amber dot + drop line) and 5-minute milestone markers
 * (white star) are drawn alongside the curve.  Milestone markers appear as
 * the animation reaches their x position.
 *
 * No auto-fade — the graph persists until the parent modal is closed.
 *
 * Public API
 *   FocusGraph.draw(canvas, focusTimeline, milestones)
 *   FocusGraph.cancel()   — abort any running animation (call on modal close)
 */
const FocusGraph = (() => {

  // ── Layout constants ────────────────────────────────────────────────────────

  const W   = 600;
  const H   = 220;
  const PAD = { top: 18, right: 20, bottom: 18, left: 20 };

  // ── Active animation handle ─────────────────────────────────────────────────

  let _rafId = null;

  // ── Drawing helpers ─────────────────────────────────────────────────────────

  /**
   * Map a focus level (0–100) to a canvas Y coordinate.
   * Level 100 → top padding; level 0 → bottom padding.
   */
  function _ly(level) {
    const innerH = H - PAD.top - PAD.bottom;
    return PAD.top + innerH - (Math.max(0, Math.min(100, level)) / 100) * innerH;
  }

  /**
   * Map an elapsed-time value to a canvas X coordinate.
   * @param {number} t      — elapsed seconds for this point
   * @param {number} maxT   — total session duration in seconds (x-axis span)
   */
  function _tx(t, maxT) {
    const innerW = W - PAD.left - PAD.right;
    return PAD.left + (t / maxT) * innerW;
  }

  /**
   * Return the stroke colour that corresponds to a timer state name.
   * FOCUSED → green, DRIFTING → amber, DISTRACTED/CRITICAL/FAILED → red.
   */
  function _colorForState(state) {
    switch (state) {
      case 'FOCUSED':    return 'rgba(74, 222, 128, 0.90)';
      case 'DRIFTING':   return 'rgba(251, 191,  36, 0.90)';
      case 'DISTRACTED': return 'rgba(248, 113, 113, 0.90)';
      case 'CRITICAL':   return 'rgba(239,  68,  68, 0.90)';
      case 'FAILED':     return 'rgba(220,  38,  38, 0.90)';
      default:           return 'rgba(255, 255, 255, 0.75)';
    }
  }

  /**
   * Draw a neutral chart background with faint horizontal guide lines at the
   * state-threshold levels (60 and 35).  No coloured zone bands — the curve
   * itself carries the colour information.
   */
  function _drawBackground(ctx) {
    const innerW = W - PAD.left - PAD.right;

    // Subtle dark fill for the plot area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(PAD.left, PAD.top, innerW, H - PAD.top - PAD.bottom);

    // Faint guide lines at the two threshold levels
    const guides = [60, 35];
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    for (const lvl of guides) {
      const gy = _ly(lvl);
      ctx.beginPath();
      ctx.moveTo(PAD.left,         gy);
      ctx.lineTo(PAD.left + innerW, gy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * Draw the focus curve segment-by-segment, each segment coloured by the
   * timer state of the destination point (FOCUSED=green, DRIFTING=amber,
   * DISTRACTED/CRITICAL/FAILED=red).  Uses horizontal mid-point bezier
   * control points for a smooth S-curve between consecutive data points.
   */
  function _drawCurve(ctx, pts) {
    if (pts.length < 2) return;

    ctx.lineWidth = 2.5;
    ctx.lineJoin  = 'round';
    ctx.lineCap   = 'round';

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur  = pts[i];
      const midX = (prev.x + cur.x) / 2;

      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.bezierCurveTo(midX, prev.y, midX, cur.y, cur.x, cur.y);
      ctx.strokeStyle = _colorForState(cur.state);
      ctx.stroke();
    }
  }

  /**
   * Draw a small white star (✦) above the curve at position (cx, cy).
   * Implemented as a 4-point star polygon.
   */
  function _drawStar(ctx, cx, cy) {
    const outer = 6;
    const inner = 2.4;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.60)';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r     = (i % 2 === 0) ? outer : inner;
      const px    = cx + Math.cos(angle) * r;
      const py    = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw milestone markers for all milestones whose x position ≤ revealX.
   * - 'distraction'  : amber dot + vertical drop line to x-axis bottom
   * - 'milestone_5m' : white star above the curve at that x position
   */
  function _drawMilestones(ctx, milestones, pts, maxT, revealX) {
    for (const m of milestones) {
      const mx = _tx(m.t, maxT);
      if (mx > revealX) continue;   // not yet revealed by animation

      if (m.type === 'distraction') {
        // Find interpolated curve Y at this x for a nicer placement
        const curveY = _interpolateCurveY(pts, mx);
        const bottomY = H - PAD.bottom;

        // Vertical drop line from curve to bottom
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 180, 40, 0.40)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(mx, curveY);
        ctx.lineTo(mx, bottomY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Amber dot on the curve
        ctx.save();
        ctx.fillStyle = 'rgba(255, 180, 40, 0.90)';
        ctx.beginPath();
        ctx.arc(mx, curveY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

      } else if (m.type === 'milestone_5m') {
        const curveY = _interpolateCurveY(pts, mx);
        _drawStar(ctx, mx, curveY - 14);
      }
    }
  }

  /**
   * Linear interpolation of curve Y at a given X by scanning the pts array.
   * Falls back to the first/last point Y when x is out of range.
   */
  function _interpolateCurveY(pts, x) {
    if (!pts.length) return H / 2;
    if (x <= pts[0].x) return pts[0].y;
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i].x) {
        const span = pts[i].x - pts[i - 1].x;
        if (span === 0) return pts[i].y;
        const frac = (x - pts[i - 1].x) / span;
        return pts[i - 1].y + frac * (pts[i].y - pts[i - 1].y);
      }
    }
    return pts[pts.length - 1].y;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * draw(canvas, focusTimeline, milestones)
   *
   * Configures the canvas and starts the draw-in animation.
   * The curve builds from left to right over 1.5 s.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {Array}  focusTimeline  — [{ t, level, state }, ...]
   * @param {Array}  milestones     — [{ t, type }, ...]
   */
  function draw(canvas, focusTimeline, milestones) {
    cancel();  // abort any previous animation

    // Size the canvas at 2× for HiDPI sharpness
    canvas.width  = W * 2;
    canvas.height = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    const timeline   = (focusTimeline  || []).slice();
    const marks      = (milestones     || []).slice();

    // Require at least 2 data points to draw anything meaningful
    if (timeline.length < 2) {
      _drawBackground(ctx);
      return;
    }

    const maxT = timeline[timeline.length - 1].t || 1;

    // Pre-compute pixel coordinates for every data point (include state for colour)
    const pts = timeline.map(p => ({
      x:     _tx(p.t, maxT),
      y:     _ly(p.level),
      state: p.state,
    }));

    const innerW   = W - PAD.left - PAD.right;
    const DURATION = 1500;  // ms for the full left-to-right reveal
    let   startTs  = null;

    function _frame(ts) {
      if (!startTs) startTs = ts;
      const progress = Math.min(1, (ts - startTs) / DURATION);

      // The x boundary up to which the curve is revealed
      const revealX = PAD.left + innerW * progress;

      ctx.clearRect(0, 0, W, H);

      // 1. Background + guide lines — always full-width, drawn instantly
      _drawBackground(ctx);

      // 2. Curve — clipped to the revealed region
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.left, PAD.top - 2, innerW * progress, H - PAD.top + 2);
      ctx.clip();
      _drawCurve(ctx, pts);
      ctx.restore();

      // 3. Milestone markers — appear as the animation reaches their position
      _drawMilestones(ctx, marks, pts, maxT, revealX);

      if (progress < 1) {
        _rafId = requestAnimationFrame(_frame);
      } else {
        _rafId = null;
      }
    }

    _rafId = requestAnimationFrame(_frame);
  }

  /**
   * cancel() — stop any running animation (call when the modal closes).
   */
  function cancel() {
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
  }

  return { draw, cancel };

})();
