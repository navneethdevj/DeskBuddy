/**
 * FocusGraph — ephemeral post-session attention graph.
 *
 * Renders an animated canvas chart over the session outcome screen immediately
 * after any session ends (COMPLETED / FAILED / ABANDONED).  The curve draws
 * itself left-to-right over 1.5 s, holds for 8 s, then fades out.
 *
 * The chart is purely visual — no interaction, no scrolling, no labels.
 * Its job is to mirror the session back to the user in 2 seconds of looking.
 *
 * Public API:
 *   FocusGraph.show(sessionData, onDone?) — render the graph, call onDone
 *                                           after the overlay has faded out.
 *   FocusGraph.cancel()                  — abort any in-progress animation.
 *
 * Data contract (from session.js):
 *   sessionData.focusTimeline  — Array<{ t: number, level: number, state: string }>
 *   sessionData.milestones     — Array<{ t: number, type: string }>
 *   sessionData.durationMinutes — number
 */
const FocusGraph = (() => {

  // ── Canvas geometry ─────────────────────────────────────────────────────────

  const W = 600, H = 220;
  const PAD = { top: 24, right: 20, bottom: 20, left: 20 };
  const INNER_W = W - PAD.left - PAD.right;
  const INNER_H = H - PAD.top  - PAD.bottom;

  // ── Timing ──────────────────────────────────────────────────────────────────

  const DRAW_DURATION_MS = 1500;   // curve draws in over 1.5 s
  const HOLD_DURATION_MS = 8000;   // hold fully-drawn graph for 8 s
  const FADE_DURATION_MS =  800;   // CSS opacity transition: 0.8 s

  // Minimum samples required to bother rendering
  const MIN_SAMPLES = 3;

  // ── Internal animation state ────────────────────────────────────────────────

  let _rafId      = null;
  let _holdTimer  = null;
  let _fadeTimer  = null;

  // ── Coordinate helpers ──────────────────────────────────────────────────────

  function _xScale(t, totalSeconds) {
    return PAD.left + (t / Math.max(totalSeconds, 1)) * INNER_W;
  }

  // Inverted: level 100 → PAD.top (top of chart), level 0 → PAD.top + INNER_H
  function _yScale(level) {
    return PAD.top + INNER_H * (1 - level / 100);
  }

  // ── Public: show ─────────────────────────────────────────────────────────────

  /**
   * show(sessionData, onDone?)
   * @param {Object}    sessionData — session record from Session.getLastSessionData()
   * @param {Function}  [onDone]    — callback fired after the overlay fades out
   */
  function show(sessionData, onDone) {
    const overlay = document.getElementById('focus-graph-overlay');
    const canvas  = document.getElementById('focus-graph-canvas');

    // Graceful bail if DOM isn't ready or data is insufficient
    if (!overlay || !canvas) {
      if (onDone) onDone();
      return;
    }
    if (!sessionData || !Array.isArray(sessionData.focusTimeline) ||
        sessionData.focusTimeline.length < MIN_SAMPLES) {
      if (onDone) onDone();
      return;
    }

    // Abort any previous run
    cancel();

    // ── HiDPI canvas setup ──────────────────────────────────────────────────
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const points = sessionData.focusTimeline;
    const totalS = (sessionData.durationMinutes || 25) * 60;

    // Show overlay (CSS opacity 0→1 via .graph-visible)
    overlay.classList.remove('graph-fading');
    overlay.classList.add('graph-visible');

    // ── Animation loop ───────────────────────────────────────────────────────
    let startTime = null;

    function _frame(ts) {
      if (!startTime) startTime = ts;
      const progress = Math.min(1, (ts - startTime) / DRAW_DURATION_MS);

      // Redraw every frame
      ctx.clearRect(0, 0, W, H);
      _drawBands(ctx);
      _drawCurve(ctx, points, totalS, progress);
      _drawMilestones(ctx, sessionData.milestones || [], totalS, progress);

      if (progress < 1) {
        _rafId = requestAnimationFrame(_frame);
      } else {
        _rafId = null;
        // Hold, then fade out
        _holdTimer = setTimeout(() => {
          _holdTimer = null;
          // Adding graph-fading overrides the transition duration to 0.8 s
          overlay.classList.add('graph-fading');
          _fadeTimer = setTimeout(() => {
            _fadeTimer = null;
            overlay.classList.remove('graph-visible', 'graph-fading');
            if (onDone) onDone();
          }, FADE_DURATION_MS);
        }, HOLD_DURATION_MS);
      }
    }

    _rafId = requestAnimationFrame(_frame);
  }

  // ── Public: cancel ────────────────────────────────────────────────────────

  function cancel() {
    if (_rafId)    { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_holdTimer){ clearTimeout(_holdTimer); _holdTimer = null; }
    if (_fadeTimer){ clearTimeout(_fadeTimer); _fadeTimer = null; }
    const overlay = document.getElementById('focus-graph-overlay');
    if (overlay) overlay.classList.remove('graph-visible', 'graph-fading');
  }

  // ── Drawing helpers ───────────────────────────────────────────────────────

  /**
   * Zone bands — three subtle horizontal fills drawn before the curve.
   * They communicate the "quality zone" of each focus level without labels.
   */
  function _drawBands(ctx) {
    // Green zone: 60–100 (focused)
    ctx.fillStyle = 'rgba(80, 220, 120, 0.08)';
    ctx.fillRect(PAD.left, _yScale(100), INNER_W, _yScale(60) - _yScale(100));
    // Amber zone: 35–59 (drifting)
    ctx.fillStyle = 'rgba(255, 180, 40, 0.08)';
    ctx.fillRect(PAD.left, _yScale(60),  INNER_W, _yScale(35) - _yScale(60));
    // Red zone: 0–34 (distracted / critical)
    ctx.fillStyle = 'rgba(255, 60, 60, 0.10)';
    ctx.fillRect(PAD.left, _yScale(35),  INNER_W, _yScale(0)  - _yScale(35));
  }

  /**
   * Smooth bezier curve through all samples up to `progress` (0–1).
   * Uses midpoint control points for a natural flowing line.
   */
  function _drawCurve(ctx, points, totalS, progress) {
    if (points.length < 2) return;

    const drawCount = Math.max(2, Math.ceil(points.length * progress));
    const visible   = points.slice(0, drawCount);

    ctx.beginPath();
    ctx.moveTo(_xScale(visible[0].t, totalS), _yScale(visible[0].level));

    for (let i = 1; i < visible.length; i++) {
      const prev = visible[i - 1];
      const curr = visible[i];
      const cpx  = (_xScale(prev.t, totalS) + _xScale(curr.t, totalS)) / 2;
      ctx.bezierCurveTo(
        cpx, _yScale(prev.level),
        cpx, _yScale(curr.level),
        _xScale(curr.t, totalS), _yScale(curr.level)
      );
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();
  }

  /**
   * Milestone markers — appear as the draw animation reaches each event's
   * x-coordinate.  Distraction: amber dot + dashed drop-line.
   * Focus milestones (every 5 min): small star glyph above the chart.
   * Break markers are intentionally not drawn (the gap in the curve shows them).
   */
  function _drawMilestones(ctx, milestones, totalS, progress) {
    milestones.forEach(m => {
      // Only render markers the curve has already passed
      const mProgress = totalS > 0 ? m.t / totalS : 0;
      if (mProgress > progress) return;

      const x = _xScale(m.t, totalS);

      if (m.type === 'distraction') {
        // Dashed vertical drop-line
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 180, 40, 0.45)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, PAD.top + INNER_H);
        ctx.stroke();
        ctx.restore();
        // Amber dot at the top of the line
        ctx.beginPath();
        ctx.arc(x, PAD.top + 6, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 180, 40, 0.9)';
        ctx.fill();

      } else if (m.type.startsWith('milestone_')) {
        // Subtle star glyph
        ctx.fillStyle    = 'rgba(255, 255, 255, 0.45)';
        ctx.font         = '10px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('✦', x, PAD.top + 12);
      }
    });
  }

  // ── Public surface ────────────────────────────────────────────────────────

  return { show, cancel };

})();
