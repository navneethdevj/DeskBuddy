/**
 * Analytics — Post-session focus report.
 *
 * Renders a Canvas 2D focus-timeline chart and session statistics immediately
 * after a session ends (COMPLETED or FAILED). Also shows aggregated historical
 * summaries for Today / This Week / This Month from Session.getHistory().
 *
 * The timeline data (focusTimeline, milestones) is recorded by session.js at
 * 5-second intervals and attached to the session object that was just saved.
 *
 * Public API:
 *   Analytics.init()         — wire DOM event handlers once at boot
 *   Analytics.show(session)  — display the report for a given session object
 *   Analytics.hide()         — dismiss the panel
 */
const Analytics = (() => {

  // ── State colour palette (matches existing DeskBuddy visual language) ──────

  const _FILL = {
    FOCUSED:    'rgba( 95, 195, 145, 0.52)',
    DRIFTING:   'rgba(255, 180,  55, 0.52)',
    DISTRACTED: 'rgba(255,  80,  72, 0.52)',
    CRITICAL:   'rgba(255,  38,  38, 0.62)',
    FAILED:     'rgba(130, 130, 150, 0.32)',
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function _el(id) { return document.getElementById(id); }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Safely stringify any value for injection into innerHTML. */
  function _safe(v) { return _esc(String(v)); }

  function _fmtStreak(secs) {
    const m = Math.floor(secs / 60);
    const s = String(Math.round(secs % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Canvas chart ─────────────────────────────────────────────────────────────

  function _renderChart(session) {
    const canvas = _el('analytics-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const timeline   = session.focusTimeline || [];
    const milestones = session.milestones    || [];

    // HiDPI / retina support
    const dpr  = window.devicePixelRatio || 1;
    const W    = canvas.offsetWidth  || 320;
    const H    = canvas.offsetHeight || 110;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.scale(dpr, dpr);

    // Layout margins
    const PAD_L = 26, PAD_R = 8, PAD_T = 10, PAD_B = 22;
    const cW    = W - PAD_L - PAD_R;
    const cH    = H - PAD_T - PAD_B;

    ctx.clearRect(0, 0, W, H);

    // ── Horizontal grid lines ────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth   = 0.5;
    [0, 25, 50, 75, 100].forEach(pct => {
      const y = PAD_T + cH * (1 - pct / 100);
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + cW, y); ctx.stroke();
    });

    // ── Y-axis labels ────────────────────────────────────────────────────────
    ctx.fillStyle    = 'rgba(255,255,255,0.20)';
    ctx.font         = '8px system-ui, sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    [0, 50, 100].forEach(pct => {
      ctx.fillText(pct + '%', PAD_L - 3, PAD_T + cH * (1 - pct / 100));
    });

    // ── Empty state ──────────────────────────────────────────────────────────
    if (timeline.length === 0) {
      ctx.strokeStyle  = 'rgba(155, 135, 255, 0.22)';
      ctx.lineWidth    = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, PAD_T + cH * 0.5);
      ctx.lineTo(PAD_L + cW, PAD_T + cH * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle    = 'rgba(255,255,255,0.18)';
      ctx.font         = '9px system-ui, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('no timeline data', PAD_L + cW / 2, PAD_T + cH / 2 + 14);
      return;
    }

    const totalSecs = (session.durationMinutes || 25) * 60;
    const xScale    = cW / Math.max(totalSecs, 1);

    // ── State-coloured filled bars (one per sample, width = gap to next) ────
    for (let i = 0; i < timeline.length; i++) {
      const s  = timeline[i];
      const x0 = PAD_L + s.t * xScale;
      const x1 = i + 1 < timeline.length
        ? PAD_L + timeline[i + 1].t * xScale
        : PAD_L + cW;
      const barW = Math.max(0.8, x1 - x0);
      const y0   = PAD_T + cH * (1 - s.level / 100);
      ctx.fillStyle = _FILL[s.state] || _FILL.FOCUSED;
      ctx.fillRect(x0, y0, barW, PAD_T + cH - y0);
    }

    // ── Focus-level line ─────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(195, 215, 255, 0.85)';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    timeline.forEach((s, i) => {
      const x = PAD_L + s.t * xScale;
      const y = PAD_T + cH * (1 - s.level / 100);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // ── Milestone markers ────────────────────────────────────────────────────
    milestones.forEach(m => {
      const x = PAD_L + m.t * xScale;
      if (m.type === 'distraction') {
        // Red dot below the chart baseline
        ctx.fillStyle = 'rgba(255, 70, 70, 0.72)';
        ctx.beginPath();
        ctx.arc(x, PAD_T + cH + 9, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (m.type.startsWith('milestone_')) {
        // Dashed vertical line + minute label above
        ctx.strokeStyle = 'rgba(175, 150, 255, 0.42)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + cH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle    = 'rgba(175, 150, 255, 0.65)';
        ctx.font         = '7px system-ui, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(m.type.replace('milestone_', '').replace('m', "'"), x, PAD_T - 1);
      } else if (m.type === 'break_start') {
        // Green dashed vertical line
        ctx.strokeStyle = 'rgba(80, 215, 165, 0.38)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + cH); ctx.stroke();
        ctx.setLineDash([]);
      }
      // break_end intentionally not drawn (the resumption of colour shows it)
    });

    // ── X-axis time labels ───────────────────────────────────────────────────
    ctx.fillStyle    = 'rgba(255,255,255,0.22)';
    ctx.font         = '8px system-ui, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const totalMins = Math.floor(totalSecs / 60);
    const step      = Math.max(1, Math.ceil(totalMins / 4));
    for (let m = 0; m <= totalMins; m += step) {
      ctx.fillText(m + 'm', PAD_L + m * 60 * xScale, PAD_T + cH + 12);
    }
    // Always show the final label
    if (totalMins % step !== 0) {
      ctx.textAlign = 'right';
      ctx.fillText(totalMins + 'm', PAD_L + cW, PAD_T + cH + 12);
    }
  }

  // ── Session stats section ─────────────────────────────────────────────────

  function _renderStats(session) {
    const el = _el('analytics-stats');
    if (!el) return;

    const durSecs    = (session.durationMinutes || 0) * 60;
    const focSecs    = session.actualFocusedSeconds || 0;
    const focPct     = durSecs > 0 ? Math.round(focSecs / durSecs * 100) : 0;
    const streak     = session.longestFocusStreakSeconds || 0;
    const distr      = session.distractionCount || 0;
    const goal       = session.goalText;
    const achieved   = session.goalAchieved;

    const goalHtml = goal
      ? `<div class="ast-goal">${_esc(goal)}${
          achieved === true  ? ' <span class="ast-goal-yes">✓</span>'
        : achieved === false ? ' <span class="ast-goal-no">✗</span>'
        : ''
        }</div>`
      : '';

    el.innerHTML = `
      <div class="ast-row">
        <div class="ast-stat">
          <div class="ast-val">${_safe(focPct)}<span class="ast-unit">%</span></div>
          <div class="ast-lbl">focused</div>
        </div>
        <div class="ast-stat">
          <div class="ast-val">${_safe(_fmtStreak(streak))}</div>
          <div class="ast-lbl">best streak</div>
        </div>
        <div class="ast-stat">
          <div class="ast-val">${_safe(distr)}</div>
          <div class="ast-lbl">distractions</div>
        </div>
      </div>
      ${goalHtml}
    `;
  }

  // ── Historical summary ────────────────────────────────────────────────────

  function _renderHistory(period) {
    const el = _el('analytics-history');
    if (!el) return;

    const history = window.Session ? Session.getHistory() : [];
    const now     = new Date();

    const inPeriod = history.filter(s => {
      if (!s.date) return false;
      const d = new Date(s.date);
      if (period === 'today') return d.toDateString() === now.toDateString();
      if (period === 'week') {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 6);
        cutoff.setHours(0, 0, 0, 0);
        return d >= cutoff;
      }
      if (period === 'month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }
      return false;
    });

    if (inPeriod.length === 0) {
      el.innerHTML = '<div class="ahist-empty">no sessions in this period</div>';
      return;
    }

    const count      = inPeriod.length;
    const completed  = inPeriod.filter(s => s.outcome === 'COMPLETED').length;
    const focMins    = Math.round(
      inPeriod.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0) / 60
    );
    const avgPct     = Math.round(
      inPeriod.reduce((a, s) => {
        const dur = (s.durationMinutes || 0) * 60;
        return a + (dur > 0 ? (s.actualFocusedSeconds || 0) / dur : 0);
      }, 0) / count * 100
    );
    const bestSecs   = Math.max(...inPeriod.map(s => s.longestFocusStreakSeconds || 0));
    const totalDistr = inPeriod.reduce((a, s) => a + (s.distractionCount || 0), 0);

    const miniChart = period === 'week' ? _buildWeekChart(inPeriod, now) : '';

    el.innerHTML = `
      ${miniChart}
      <div class="ahist-grid">
        <div class="ahist-item">
          <div class="ahist-val">${_safe(count)}</div>
          <div class="ahist-lbl">sessions</div>
        </div>
        <div class="ahist-item">
          <div class="ahist-val">${_safe(completed)}<span class="ahist-unit">/${_safe(count)}</span></div>
          <div class="ahist-lbl">completed</div>
        </div>
        <div class="ahist-item">
          <div class="ahist-val">${_safe(focMins)}<span class="ahist-unit">m</span></div>
          <div class="ahist-lbl">focused</div>
        </div>
        <div class="ahist-item">
          <div class="ahist-val">${_safe(avgPct)}<span class="ahist-unit">%</span></div>
          <div class="ahist-lbl">avg focus</div>
        </div>
        <div class="ahist-item">
          <div class="ahist-val">${_safe(_fmtStreak(bestSecs))}</div>
          <div class="ahist-lbl">best streak</div>
        </div>
        <div class="ahist-item">
          <div class="ahist-val">${_safe(totalDistr)}</div>
          <div class="ahist-lbl">distractions</div>
        </div>
      </div>
    `;
  }

  // ── Weekly mini bar chart ─────────────────────────────────────────────────

  function _buildWeekChart(sessions, now) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const key     = d.toDateString();
      const daily   = sessions.filter(s => new Date(s.date).toDateString() === key);
      const focMins = Math.round(daily.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0) / 60);
      const lbl     = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()];
      days.push({ focMins, lbl, isToday: i === 0 });
    }
    const maxMins = Math.max(...days.map(d => d.focMins), 1);
    const bars = days.map(({ focMins, lbl, isToday }) => {
      const pct = Math.max(focMins > 0 ? 6 : 0, Math.round(focMins / maxMins * 100));
      return `<div class="ahist-bar-col">
        <div class="ahist-bar-wrap">
          <div class="ahist-bar${isToday ? ' ahist-bar-today' : ''}" style="height:${pct}%"></div>
        </div>
        <div class="ahist-bar-lbl${isToday ? ' ahist-bar-today-lbl' : ''}">${lbl}</div>
      </div>`;
    }).join('');
    return `<div class="ahist-week-chart">${bars}</div>`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init() {
    const panel    = _el('analytics-panel');
    const closeBtn = _el('analytics-close-btn');
    if (!panel) return;

    if (closeBtn) closeBtn.addEventListener('click', hide);
    panel.addEventListener('click', e => { if (e.target === panel) hide(); });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); hide(); }
    });

    panel.querySelectorAll('.atab').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.atab').forEach(b => b.classList.remove('atab-active'));
        btn.classList.add('atab-active');
        _renderHistory(btn.dataset.period);
      });
    });
  }

  function show(session) {
    const panel = _el('analytics-panel');
    if (!panel) return;

    // Reset tabs to Today
    panel.querySelectorAll('.atab').forEach(btn => {
      btn.classList.toggle('atab-active', btn.dataset.period === 'today');
    });

    _renderChart(session);
    _renderStats(session);
    _renderHistory('today');

    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('analytics-visible');

    // Focus close button for keyboard accessibility
    const closeBtn = _el('analytics-close-btn');
    if (closeBtn) setTimeout(() => closeBtn.focus(), 80);
  }

  function hide() {
    const panel = _el('analytics-panel');
    if (!panel) return;
    panel.classList.remove('analytics-visible');
    panel.setAttribute('aria-hidden', 'true');
  }

  return { init, show, hide };

})();
