/**
 * HistoryPanel — Session history dashboard.
 *
 * Sections:
 *   1. View pills (Daily/Weekly/Monthly/Lifetime) — controls ALL content in the panel
 *   2. Stat Cards — period-specific metrics (focused time, sessions, avg focus %, etc.)
 *   3. Chart + Graph hybrid — bars + line curve for the selected period
 *   4. Streak Row — 🔥 current streak · longest streak · avg focus %
 *   5. Streak Calendar — 16-week GitHub-style canvas OR month-mode calendar
 *   6. Recent Sessions — last 7 sessions (always visible, unchanged)
 *
 * Public API:
 *   HistoryPanel.init()    — wire pill/close/calendar events
 *   HistoryPanel.refresh() — re-render all sections with latest data
 */
const HistoryPanel = (() => {

  let _chartRafId = null;
  let _activeView = 'daily';
  let _calMode    = '16w';   // '16w' or 'month'

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    const panel = document.getElementById('history-panel');
    if (!panel) return;

    // Wire view pill clicks — each pill switches ALL content
    panel.querySelectorAll('.hgraph-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _activeView = pill.dataset.view;
        _activateView(_activeView);
      });
    });

    // Wire calendar mode buttons
    document.querySelectorAll('.hp-cal-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.hp-cal-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _calMode = btn.dataset.calMode;
        const history = _getHistory();
        _drawStreakCalendar(history);
      });
    });
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  function refresh() {
    const history = _getHistory();

    // Reset pill to daily
    const panel = document.getElementById('history-panel');
    if (panel) {
      panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
      const d = panel.querySelector('.hgraph-pill[data-view="daily"]');
      if (d) d.classList.add('active');
    }
    _activeView = 'daily';

    _renderAllViewStats(history);
    _renderStreakRow(history);
    _drawStreakCalendar(history);
    _activateView('daily');
    _renderRecentSessions(history);
  }

  // ── Activate view (show/hide panels + draw chart) ─────────────────────────

  function _activateView(view) {
    document.querySelectorAll('.hp-view').forEach(v => {
      v.classList.toggle('hp-view-active', v.dataset.viewPanel === view);
    });
    const history = _getHistory();
    _drawViewChart(view, history);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _getHistory() {
    return (typeof Session !== 'undefined') ? Session.getHistory() : [];
  }

  function _fmtSecs(totalSecs) {
    const m = Math.floor(totalSecs / 60);
    if (m <= 0) return '0m';
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h === 0) return `${rem}m`;
    if (rem === 0) return `${h}h`;
    return `${h}h ${rem}m`;
  }

  function _fmtMs(ms) { return _fmtSecs(Math.floor(ms / 1000)); }

  function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _isoDay(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function _avgFocusScore(sessions) {
    const completed = sessions.filter(s => s.outcome === 'COMPLETED');
    if (!completed.length) return null;
    const sum = completed.reduce((acc, s) => {
      const total   = (s.durationMinutes || 0) * 60;
      const focused = s.actualFocusedSeconds || 0;
      return acc + (total > 0 ? (focused / total) * 100 : 0);
    }, 0);
    return Math.round(sum / completed.length);
  }

  function _longestSession(sessions) {
    if (!sessions.length) return 0;
    return Math.max(...sessions.map(s => s.durationMinutes || 0));
  }

  function _bestDay(sessions) {
    if (!sessions.length) return null;
    const byDay = {};
    sessions.forEach(s => {
      if (!s.date) return;
      const d = new Date(s.date);
      const key = _isoDay(d);
      byDay[key] = (byDay[key] || { secs: 0, date: d });
      byDay[key].secs += s.actualFocusedSeconds || 0;
    });
    const best = Object.values(byDay).sort((a, b) => b.secs - a.secs)[0];
    if (!best || best.secs === 0) return null;
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return `${DAYS[best.date.getDay()]} ${MONTHS[best.date.getMonth()]} ${best.date.getDate()}`;
  }

  // ── 1. All View Stats ─────────────────────────────────────────────────────

  function _renderAllViewStats(history) {
    const now    = new Date();
    const today  = new Date(now); today.setHours(0,0,0,0);
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const todaySessions = history.filter(s => s.date && new Date(s.date) >= today);
    const weekSessions  = history.filter(s => s.date && new Date(s.date) >= monday);
    const monthSessions = history.filter(s => s.date && new Date(s.date) >= monthStart);

    const todaySecs  = todaySessions.reduce((a,s) => a + (s.actualFocusedSeconds||0), 0);
    const weekSecs   = weekSessions.reduce((a,s) => a + (s.actualFocusedSeconds||0), 0);
    const monthSecs  = monthSessions.reduce((a,s) => a + (s.actualFocusedSeconds||0), 0);
    const lifetimeMins = (typeof Session !== 'undefined' && Session.getTotalFocusedMinutes)
      ? Session.getTotalFocusedMinutes() : 0;

    // Daily view
    _setText('hsc-today-focused',  todaySecs > 0 ? _fmtSecs(todaySecs) : '0m');
    _setText('hsc-today-sessions', String(todaySessions.length));
    const todayAvg = _avgFocusScore(todaySessions);
    _setText('hsc-today-avg',      todayAvg !== null ? `${todayAvg}%` : '—');
    const todayLongest = _longestSession(todaySessions);
    _setText('hsc-today-longest',  todayLongest > 0 ? `${todayLongest}m` : '—');

    // Weekly view
    _setText('hsc-week-focused',   weekSecs > 0 ? _fmtSecs(weekSecs) : '0m');
    _setText('hsc-week-sessions',  String(weekSessions.length));
    const weekAvg = _avgFocusScore(weekSessions);
    _setText('hsc-week-avg',       weekAvg !== null ? `${weekAvg}%` : '—');
    const weekBest = _bestDay(weekSessions);
    _setText('hsc-week-best-day',  weekBest || '—');

    // Monthly view
    _setText('hsc-month-focused',  monthSecs > 0 ? _fmtSecs(monthSecs) : '0m');
    _setText('hsc-month-sessions', String(monthSessions.length));
    const monthAvg = _avgFocusScore(monthSessions);
    _setText('hsc-month-avg',      monthAvg !== null ? `${monthAvg}%` : '—');
    const monthBest = _bestDay(monthSessions);
    _setText('hsc-month-best',     monthBest || '—');

    // Lifetime view
    _setText('hsc-lifetime-focused',  _fmtSecs(lifetimeMins * 60));
    _setText('hsc-lifetime-sessions', String(history.length));
    const lifetimeBest = _bestDay(history);
    _setText('hsc-lifetime-best-day', lifetimeBest || '—');
    const longestStreak = (typeof Session !== 'undefined' && Session.computeLongestStreak)
      ? Session.computeLongestStreak() : 0;
    _setText('hsc-lifetime-streak', longestStreak > 0 ? `${longestStreak}d` : '—');

    // Personal bests (lifetime view)
    _setText('hsb-this-month', monthSecs > 0 ? _fmtSecs(monthSecs) : '—');
    const bestWeekMs  = (typeof HistoryStats !== 'undefined') ? HistoryStats.getMaxWeekFocusMs(history)  : 0;
    const bestMonthMs = (typeof HistoryStats !== 'undefined') ? HistoryStats.getMaxMonthFocusMs(history) : 0;
    _setText('hsb-best-week',  bestWeekMs  > 0 ? _fmtMs(bestWeekMs)  : '—');
    _setText('hsb-best-month', bestMonthMs > 0 ? _fmtMs(bestMonthMs) : '—');
  }

  // ── 2. Streak Row ────────────────────────────────────────────────────────

  function _renderStreakRow(history) {
    const current = (typeof Session !== 'undefined' && Session.computeDayStreak)
      ? Session.computeDayStreak() : 0;
    const longest = (typeof Session !== 'undefined' && Session.computeLongestStreak)
      ? Session.computeLongestStreak() : 0;

    const completed = history.filter(s => s.outcome === 'COMPLETED');
    let avgScore = null;
    if (completed.length > 0) {
      const sum = completed.reduce((acc, s) => {
        const total   = (s.durationMinutes || 0) * 60;
        const focused = s.actualFocusedSeconds || 0;
        return acc + (total > 0 ? (focused / total) * 100 : 0);
      }, 0);
      avgScore = Math.round(sum / completed.length);
    }

    _setText('hsr-current-streak', current > 0 ? `${current}d` : '—');
    _setText('hsr-longest-streak', longest > 0 ? `${longest}d` : '—');
    _setText('hsr-avg-score',      avgScore !== null ? `${avgScore}%` : '—');

    // Fire emojis — show up to 5 fires for current streak
    const firesEl = document.getElementById('hsr-fires');
    if (firesEl) {
      const fireCount = Math.min(5, current);
      firesEl.textContent = fireCount > 0 ? '🔥'.repeat(fireCount) : '';
      firesEl.title = current > 0 ? `${current}-day streak!` : 'No active streak';
    }

    // Dim fires for longest streak (max 5)
    const firesLongestEl = document.getElementById('hsr-fires-longest');
    if (firesLongestEl) {
      const lFireCount = Math.min(5, longest);
      firesLongestEl.textContent = lFireCount > 0 ? '🔥'.repeat(lFireCount) : '';
    }
  }

  // ── 3. Streak Calendar ────────────────────────────────────────────────────

  function _drawStreakCalendar(history) {
    if (_calMode === 'month') {
      _drawMonthCalendar(history);
    } else {
      _drawGithubCalendar(history);
    }
  }

  /**
   * GitHub-style contributions calendar:
   *   Columns = weeks (left=oldest, right=current week)
   *   Rows    = days  (top=Monday, bottom=Sunday)
   *   Month labels float above columns.
   */
  function _drawGithubCalendar(history) {
    // Show/hide correct calendar mode
    const githubWrap = document.getElementById('hp-cal-wrap-github');
    const monthWrap  = document.getElementById('hp-cal-wrap-month');
    if (githubWrap) githubWrap.style.display = '';
    if (monthWrap)  monthWrap.style.display  = 'none';

    const canvas = document.getElementById('hp-streak-canvas');
    if (!canvas) return;

    const WEEKS = 16;
    const DAYS  = 7;
    const GAP   = 2;

    // Compute cell size to fill the canvas wrapper width
    const wrapW = (canvas.parentElement?.clientWidth || 240);
    const CELL  = Math.max(8, Math.floor((wrapW - (WEEKS - 1) * GAP) / WEEKS));
    const UNIT  = CELL + GAP;

    const W = WEEKS * UNIT - GAP;
    const H = DAYS  * UNIT - GAP;

    canvas.width        = W * 2;
    canvas.height       = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    // Sync day-label column heights to match the canvas cell size
    const dayColEl = document.getElementById('hp-cal-day-col');
    if (dayColEl) {
      Array.from(dayColEl.querySelectorAll('span')).forEach(span => {
        span.style.height      = CELL + 'px';
        span.style.marginBottom = GAP + 'px';
        span.style.lineHeight  = CELL + 'px';
      });
    }

    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    // Build day map: isoDay → { hasCompleted, hasAttempted }
    const dayMap = new Map();
    history.forEach(s => {
      if (!s.date) return;
      const d   = new Date(s.date);
      const key = _isoDay(d);
      if (!dayMap.has(key)) dayMap.set(key, { hasCompleted: false, hasAttempted: false });
      const e = dayMap.get(key);
      if (s.outcome === 'COMPLETED') e.hasCompleted = true;
      else if (s.outcome === 'FAILED' || s.outcome === 'ABANDONED') e.hasAttempted = true;
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayDow = (now.getDay() + 6) % 7; // 0=Mon…6=Sun

    // Sunday of current week (end of week for boundary check)
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - todayDow);

    for (let col = 0; col < WEEKS; col++) {
      // col 0 = oldest week (left), col WEEKS-1 = current week (right)
      const weekOffset = WEEKS - 1 - col;
      for (let row = 0; row < DAYS; row++) {
        const d = new Date(thisMonday);
        d.setDate(thisMonday.getDate() - weekOffset * 7 + row);

        const isFuture   = d > now;
        const isCurrent  = weekOffset === 0;
        const key        = _isoDay(d);
        const info       = dayMap.get(key);

        const x = col * UNIT;
        const y = row * UNIT;

        let fillColor;
        if (isFuture) {
          fillColor = 'rgba(255,255,255,0.02)';
        } else if (!info) {
          fillColor = 'rgba(255,255,255,0.05)';
        } else if (info.hasCompleted) {
          fillColor = isCurrent
            ? 'rgba(155,135,255,0.95)'
            : 'rgba(139,118,255,0.65)';
        } else {
          fillColor = 'rgba(139,118,255,0.22)';
        }

        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.roundRect(x, y, CELL, CELL, 2);
        ctx.fill();

        // Highlight today with a subtle outline
        if (d.getTime() === now.getTime()) {
          ctx.strokeStyle = 'rgba(210,195,255,0.80)';
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.roundRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1, 2);
          ctx.stroke();
        }
      }
    }

    // Draw month labels above columns
    _drawCalendarMonthLabels(thisMonday, WEEKS, CELL, UNIT, GAP);
  }

  function _drawCalendarMonthLabels(thisMonday, WEEKS, CELL, UNIT, GAP) {
    const labelsEl = document.getElementById('hp-cal-months');
    if (!labelsEl) return;

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    labelsEl.innerHTML = '';
    labelsEl.style.position = 'relative';

    const seen = new Set();
    for (let col = 0; col < WEEKS; col++) {
      const weekOffset = WEEKS - 1 - col;
      const weekStart  = new Date(thisMonday);
      weekStart.setDate(thisMonday.getDate() - weekOffset * 7);
      const monthKey = `${weekStart.getFullYear()}-${weekStart.getMonth()}`;
      if (!seen.has(monthKey)) {
        seen.add(monthKey);
        const label = document.createElement('span');
        label.textContent = MONTH_NAMES[weekStart.getMonth()];
        label.style.cssText = `
          position:absolute;
          left:${col * UNIT}px;
          font-size:7.5px;
          font-weight:700;
          letter-spacing:0.04em;
          text-transform:uppercase;
          color:rgba(200,185,255,0.50);
          white-space:nowrap;
        `;
        labelsEl.appendChild(label);
      }
    }
  }

  /**
   * Month-mode: traditional calendar grid for the current month.
   */
  function _drawMonthCalendar(history) {
    const githubWrap = document.getElementById('hp-cal-wrap-github');
    const monthWrap  = document.getElementById('hp-cal-wrap-month');
    if (githubWrap) githubWrap.style.display = 'none';
    if (monthWrap)  monthWrap.style.display  = '';

    const container = document.getElementById('hp-cal-month-grid-container');
    if (!container) return;

    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const MONTH_NAMES = ['January','February','March','April','May','June',
                          'July','August','September','October','November','December'];
    const DAY_NAMES   = ['Mo','Tu','We','Th','Fr','Sa','Su'];

    // Build day map
    const dayMap = new Map();
    history.forEach(s => {
      if (!s.date) return;
      const d = new Date(s.date);
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      const day = d.getDate();
      if (!dayMap.has(day)) dayMap.set(day, { hasCompleted: false, hasAttempted: false });
      const e = dayMap.get(day);
      if (s.outcome === 'COMPLETED') e.hasCompleted = true;
      else if (s.outcome === 'FAILED' || s.outcome === 'ABANDONED') e.hasAttempted = true;
    });

    // First day of month in Mon-based weekday (0=Mon)
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;

    let html = `<div style="text-align:center;font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:rgba(200,185,255,0.60);margin-bottom:6px;">${MONTH_NAMES[month]} ${year}</div>`;
    html += `<table class="hp-cal-month-grid"><thead><tr>`;
    DAY_NAMES.forEach(d => { html += `<th>${d}</th>`; });
    html += `</tr></thead><tbody><tr>`;

    // Empty cells before first day
    for (let e = 0; e < firstDow; e++) html += `<td></td>`;

    let col = firstDow;
    for (let day = 1; day <= daysInMonth; day++) {
      if (col > 0 && col % 7 === 0) html += `</tr><tr>`;
      const info = dayMap.get(day);
      const isFuture = day > today;
      const isToday  = day === today;
      let cls = 'hp-cal-day-cell';
      if (isFuture)            cls += ' hp-day-future';
      else if (!info)          cls += ' hp-day-empty';
      else if (info.hasCompleted) cls += ' hp-day-completed';
      else                     cls += ' hp-day-attempted';
      if (isToday)             cls += ' hp-day-today';
      html += `<td><div class="${cls}" title="${isToday ? 'Today' : `${MONTH_NAMES[month]} ${day}`}">${day}</div></td>`;
      col++;
    }
    // Fill remainder of last row
    while (col % 7 !== 0) { html += `<td></td>`; col++; }
    html += `</tr></tbody></table>`;
    container.innerHTML = html;
  }

  // ── 4. Chart + Graph hybrid ───────────────────────────────────────────────

  const CHART_CANVAS = {
    daily:    'hp-chart-daily',
    weekly:   'hp-chart-weekly',
    monthly:  'hp-chart-monthly',
    lifetime: 'hp-chart-lifetime',
  };

  function _drawViewChart(view, history) {
    const canvasId = CHART_CANVAS[view];
    if (!canvasId) return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (_chartRafId !== null) {
      cancelAnimationFrame(_chartRafId);
      _chartRafId = null;
    }

    let bars;
    let xLabelMode;
    if (view === 'daily') {
      bars = _buildHourlyBars(history);
      xLabelMode = 'hour';
    } else if (view === 'weekly') {
      bars = _buildThisWeekBars(history);
      xLabelMode = 'weekday';
    } else if (view === 'monthly') {
      bars = _buildThisMonthBars(history);
      xLabelMode = 'date';
    } else {
      bars = (typeof HistoryStats !== 'undefined')
        ? HistoryStats.buildLifetimeBars(history)
        : [];
      xLabelMode = 'month';
    }

    const W = (canvas.parentElement?.clientWidth || 360);
    const H = 120;
    canvas.width        = W * 2;
    canvas.height       = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    const PAD    = { top: 12, right: 8, bottom: 24, left: 8 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top  - PAD.bottom;

    if (!bars || !bars.length || bars.every(b => b.focusedMs === 0)) {
      ctx.clearRect(0, 0, W, H);
      _drawChartBg(ctx, W, H, PAD, innerW, innerH);
      ctx.font      = '9px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(139,118,255,0.30)';
      ctx.textAlign = 'center';
      ctx.fillText('No sessions yet for this period', W / 2, H / 2 + 3);
      ctx.textAlign = 'left';
      return;
    }

    const n     = bars.length;
    const maxMs = Math.max(...bars.map(b => b.focusedMs), 1);
    const barW  = Math.max(3, Math.floor((innerW / n) * 0.72));
    const gap   = innerW / n;

    // Label frequency: show label every N bars to avoid crowding
    const labelEvery = n <= 7 ? 1 : n <= 12 ? 1 : n <= 24 ? 4 : n <= 31 ? 5 : 3;

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const DURATION = 550;
    let   startTs  = null;

    function _frame(ts) {
      if (!startTs) startTs = ts;
      const raw   = Math.min(1, (ts - startTs) / DURATION);
      const eased = 1 - Math.pow(1 - raw, 3); // cubic ease-out

      ctx.clearRect(0, 0, W, H);
      _drawChartBg(ctx, W, H, PAD, innerW, innerH);

      // Collect bar center points for the line overlay
      const pts = [];

      bars.forEach((bar, i) => {
        const isCur     = bar.isToday || bar.isCurrent;
        const isFuture  = bar.isFuture;
        const heightPx  = isFuture ? 0 : (bar.focusedMs / maxMs) * innerH * eased;
        const cx        = PAD.left + i * gap + gap / 2;   // center of bar
        const x         = cx - barW / 2;
        const y         = PAD.top + innerH - heightPx;

        // Bar gradient — current period bright, future faded, rest normal
        if (!isFuture && bar.focusedMs > 0) {
          const grad = ctx.createLinearGradient(0, y, 0, PAD.top + innerH);
          if (isCur) {
            grad.addColorStop(0, 'rgba(195,175,255,0.95)');
            grad.addColorStop(1, 'rgba(139,118,255,0.75)');
          } else {
            grad.addColorStop(0, 'rgba(155,135,255,0.55)');
            grad.addColorStop(1, 'rgba(120,100,220,0.35)');
          }
          ctx.fillStyle = grad;
          ctx.shadowColor = isCur ? 'rgba(155,135,255,0.55)' : 'transparent';
          ctx.shadowBlur  = isCur ? 8 : 0;
        } else if (isFuture) {
          ctx.fillStyle  = 'rgba(255,255,255,0.04)';
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle  = 'rgba(255,255,255,0.05)';
          ctx.shadowBlur = 0;
        }

        if (heightPx > 0) {
          ctx.beginPath();
          ctx.roundRect(x, y, barW, heightPx, [3, 3, 0, 0]);
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // Collect point for line (only non-future bars with data)
        if (!isFuture) {
          pts.push({
            x: cx,
            y: PAD.top + innerH - heightPx,
            hasData: bar.focusedMs > 0,
          });
        }

        // X axis labels
        if (i % labelEvery === 0) {
          let label = '';
          if (xLabelMode === 'hour') {
            const h = bar.label;
            if (h === 0) label = '12am';
            else if (h < 12) label = `${h}am`;
            else if (h === 12) label = '12pm';
            else label = `${h - 12}pm`;
          } else if (xLabelMode === 'weekday') {
            label = bar.isToday ? 'Today' : bar.displayLabel || String(bar.label);
          } else if (xLabelMode === 'date') {
            label = String(bar.label);
          } else {
            const d = bar.label;
            label = MONTH_NAMES[d.getMonth()];
          }

          ctx.font      = '6.5px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = isCur ? 'rgba(210,195,255,0.92)'
                        : isFuture ? 'rgba(139,118,255,0.18)'
                        : 'rgba(139,118,255,0.52)';
          ctx.fillText(label, cx, H - 7);
          ctx.textAlign = 'left';
        }
      });

      // Draw line/curve overlay connecting bar tops (only when animation is ≥50% done)
      if (eased > 0.3 && pts.length >= 2) {
        const lineAlpha = Math.min(1, (eased - 0.3) / 0.7);
        _drawLineOverlay(ctx, pts, lineAlpha, PAD, innerH);
      }

      if (raw < 1) {
        _chartRafId = requestAnimationFrame(_frame);
      } else {
        _chartRafId = null;
      }
    }

    _chartRafId = requestAnimationFrame(_frame);
  }

  function _drawLineOverlay(ctx, pts, alpha, PAD, innerH) {
    if (pts.length < 2) return;

    // Draw bezier curve through bar tops
    ctx.save();
    ctx.strokeStyle = `rgba(200,185,255,${(0.60 * alpha).toFixed(2)})`;
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur  = pts[i];
      const cpX  = (prev.x + cur.x) / 2;
      ctx.bezierCurveTo(cpX, prev.y, cpX, cur.y, cur.x, cur.y);
    }
    ctx.stroke();

    // Draw dots at each data point
    pts.forEach(p => {
      if (p.hasData) {
        ctx.fillStyle = `rgba(210,195,255,${(0.85 * alpha).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.restore();
  }

  function _drawChartBg(ctx, W, H, PAD, innerW, innerH) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.roundRect(PAD.left, PAD.top, innerW, innerH, 6);
    ctx.fill();

    // Faint horizontal guide lines
    ctx.strokeStyle = 'rgba(139,118,255,0.07)';
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([3, 5]);
    [0.25, 0.50, 0.75].forEach(frac => {
      const y = PAD.top + innerH * (1 - frac);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + innerW, y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // ── Chart data builders ───────────────────────────────────────────────────

  /** Today broken into 24 hours (0–23). Skips empty hours before first session. */
  function _buildHourlyBars(history) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const currentHour = new Date().getHours();
    const bars = [];
    for (let h = 0; h < 24; h++) {
      const start = new Date(now); start.setHours(h, 0, 0, 0);
      const end   = new Date(now); end.setHours(h, 59, 59, 999);
      const slice = history.filter(s => {
        if (!s.date) return false;
        const t = new Date(s.date).getTime();
        return t >= start.getTime() && t <= end.getTime();
      });
      bars.push({
        label:        h,
        focusedMs:    slice.reduce((a,s) => a + (s.actualFocusedSeconds||0)*1000, 0),
        sessionCount: slice.length,
        isToday:      h === currentHour,
        isFuture:     h > currentHour,
      });
    }
    return bars;
  }

  /** This week Mon–Sun (today highlighted, future days greyed out). */
  function _buildThisWeekBars(history) {
    const DAY_NAMES   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const now         = new Date();
    const todayDow    = (now.getDay() + 6) % 7; // 0=Mon
    const monday      = new Date(now);
    monday.setDate(now.getDate() - todayDow);
    monday.setHours(0, 0, 0, 0);

    return DAY_NAMES.map((name, d) => {
      const day    = new Date(monday); day.setDate(monday.getDate() + d);
      const dayEnd = new Date(day);    dayEnd.setHours(23, 59, 59, 999);
      const isFuture = d > todayDow;
      const slice = isFuture ? [] : history.filter(s => {
        if (!s.date) return false;
        const t = new Date(s.date).getTime();
        return t >= day.getTime() && t <= dayEnd.getTime();
      });
      return {
        label:        name,
        displayLabel: name,
        focusedMs:    slice.reduce((a,s) => a + (s.actualFocusedSeconds||0)*1000, 0),
        sessionCount: slice.length,
        isToday:      d === todayDow,
        isFuture,
      };
    });
  }

  /** Current month day-by-day (future days greyed out). */
  function _buildThisMonthBars(history) {
    const now    = new Date();
    const year   = now.getFullYear();
    const month  = now.getMonth();
    const today  = now.getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const bars = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const day    = new Date(year, month, d, 0, 0, 0, 0);
      const dayEnd = new Date(year, month, d, 23, 59, 59, 999);
      const isFuture = d > today;
      const slice = isFuture ? [] : history.filter(s => {
        if (!s.date) return false;
        const t = new Date(s.date).getTime();
        return t >= day.getTime() && t <= dayEnd.getTime();
      });
      bars.push({
        label:        d,
        focusedMs:    slice.reduce((a,s) => a + (s.actualFocusedSeconds||0)*1000, 0),
        sessionCount: slice.length,
        isToday:      d === today,
        isFuture,
      });
    }
    return bars;
  }

  // ── 5. Recent Sessions (last 7) ──────────────────────────────────────────

  function _renderRecentSessions(history) {
    const container = document.getElementById('hp-recent-list');
    if (!container) return;

    const recent = history.slice(0, 7);

    if (!recent.length) {
      container.innerHTML = '<div class="hp-recent-empty">✨ No sessions yet — start your first one!</div>';
      return;
    }

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    container.innerHTML = recent.map((s, idx) => {
      const outcome = String(s.outcome || 'ABANDONED').toUpperCase();

      // Date: "Mon Apr 12" format
      const dateStr = (() => {
        if (!s.date) return '—';
        const d = new Date(s.date);
        if (!isFinite(d.getTime())) return '—';
        const isToday = new Date(d).setHours(0,0,0,0) === new Date().setHours(0,0,0,0);
        if (isToday) return 'Today';
        return `${DAY_NAMES[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
      })();

      // Duration
      const durMins = Math.max(0, parseInt(s.durationMinutes, 10) || 0);

      // Focus score
      const scoreNum = (() => {
        const total   = durMins * 60;
        const focused = Math.max(0, parseInt(s.actualFocusedSeconds, 10) || 0);
        return total > 0 ? Math.round((focused / total) * 100) : 0;
      })();

      // Focus rating
      const rating = scoreNum >= 90 ? 'A+' : scoreNum >= 80 ? 'A' : scoreNum >= 70 ? 'B'
                   : scoreNum >= 60 ? 'C'  : scoreNum >= 40 ? 'D' : scoreNum > 0 ? 'F' : '';
      const ratingColor = scoreNum >= 80 ? 'rgba(52,211,153,0.90)'
                        : scoreNum >= 60 ? 'rgba(167,139,250,0.90)'
                        : scoreNum >= 40 ? 'rgba(251,191,36,0.90)'
                        : scoreNum > 0   ? 'rgba(248,113,113,0.88)' : 'rgba(255,255,255,0.20)';

      // Goal display
      const goalStr = (() => {
        if (!s.goalText) return '';
        const trunc = s.goalText.length > 36 ? s.goalText.slice(0, 36) + '…' : s.goalText;
        if (s.goalAchieved === true)  return `"${trunc}" ✓`;
        if (s.goalAchieved === false) return `"${trunc}" ✗`;
        return `"${trunc}"`;
      })();

      // Category emoji
      const CATEGORY_EMOJI = { study: '📚', work: '💼', creative: '🎨', reading: '📖', other: '⚙️' };
      const catEmoji = s.category ? (CATEGORY_EMOJI[s.category] || '') : '';

      // Outcome
      const outCls   = outcome === 'COMPLETED' ? 'hp-ri-completed'
                     : outcome === 'FAILED'    ? 'hp-ri-failed'
                     : 'hp-ri-abandoned';
      const outLabel = outcome === 'COMPLETED' ? ''
                     : outcome === 'FAILED'
                       ? ' · <span class="hp-ri-outcome-tag hp-ri-failed-tag" title="Session ended due to distraction">failed</span>'
                       : ' · <span class="hp-ri-outcome-tag hp-ri-abandoned-tag" title="Session was ended early">abandoned</span>';

      return `
        <div class="hp-recent-row ${outCls}" style="animation-delay:${idx * 35}ms" title="${outcome === 'COMPLETED' ? 'Completed session' : outcome === 'FAILED' ? 'Session failed (too many distractions)' : 'Session abandoned early'}">
          <div class="hp-rr-left">
            ${catEmoji ? `<span class="hp-rr-cat" title="${_esc(s.category || '')}">${catEmoji}</span>` : ''}
            <span class="hp-rr-date">${_esc(dateStr)}</span>
            <span class="hp-rr-sep">·</span>
            <span class="hp-rr-dur" title="Session duration">${durMins}m</span>
            ${scoreNum > 0 ? `<span class="hp-rr-sep">·</span><span class="hp-rr-score" title="Focus score: ${scoreNum}% of session time spent focused">${scoreNum}%</span>` : ''}
            ${outLabel}
          </div>
          <div class="hp-rr-right">
            ${goalStr ? `<span class="hp-rr-goal" title="Session goal">${_esc(goalStr)}</span>` : ''}
            ${rating ? `<span class="hp-rr-rating" style="color:${ratingColor}" title="Focus grade (A+ = excellent, F = poor)">${rating}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  return { init, refresh };

})();
