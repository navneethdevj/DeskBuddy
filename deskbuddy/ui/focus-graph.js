/**
 * FocusGraph — Post-session attention graph.
 *
 * Draws an animated bezier focus-level curve onto a supplied <canvas> element.
 * The curve reveals itself left-to-right over 1.5 seconds using
 * requestAnimationFrame and a clip-rect reveal technique.
 *
 * Zone bands (green / amber / red), distraction markers (amber dot + drop line),
 * and 5-minute milestone markers (white star) are drawn alongside the curve.
 * Milestone markers appear as the animation reaches their x position.
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

  /** Draw the three zone bands — call once as the static background. */
  function _drawBands(ctx) {
    const innerW = W - PAD.left - PAD.right;

    // Green band: 60–100
    ctx.fillStyle = 'rgba(80, 220, 120, 0.08)';
    ctx.fillRect(PAD.left, _ly(100), innerW, _ly(60) - _ly(100));

    // Amber band: 35–59
    ctx.fillStyle = 'rgba(255, 180, 40, 0.08)';
    ctx.fillRect(PAD.left, _ly(60), innerW, _ly(35) - _ly(60));

    // Red band: 0–34
    ctx.fillStyle = 'rgba(255, 60, 60, 0.10)';
    ctx.fillRect(PAD.left, _ly(35), innerW, _ly(0) - _ly(35));
  }

  /**
   * Draw the focus curve clipped to `revealX` pixels from the left edge.
   * Uses a smooth bezier path: for each segment i → i+1 the horizontal
   * mid-point is used as both control points, giving a gentle S-curve that
   * respects the data shape without overshooting.
   */
  function _drawCurve(ctx, pts) {
    if (pts.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur  = pts[i];
      const midX = (prev.x + cur.x) / 2;
      ctx.bezierCurveTo(midX, prev.y, midX, cur.y, cur.x, cur.y);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();
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
      _drawBands(ctx);
      return;
    }

    const maxT = timeline[timeline.length - 1].t || 1;

    // Pre-compute pixel coordinates for every data point
    const pts = timeline.map(p => ({
      x: _tx(p.t, maxT),
      y: _ly(p.level),
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

      // 1. Zone bands — always full-width, drawn instantly
      _drawBands(ctx);

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
