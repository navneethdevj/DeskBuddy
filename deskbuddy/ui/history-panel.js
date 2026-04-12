/**
 * HistoryPanel — Session history dashboard.
 *
 * Sections (V2 spec):
 *   1. Stat Cards       — 2×2 grid (today focused, today sessions, week, lifetime)
 *   2. Streak Row       — 🔥 current streak · longest streak · avg focus %
 *   3. Streak Calendar  — 16 weeks × 7 days canvas dot grid
 *   4. Bar Chart        — canvas bar chart, 4 view pills (daily/weekly/monthly/lifetime)
 *   5. Recent Sessions  — last 7 sessions, spec format
 *
 * Public API:
 *   HistoryPanel.init()    — wire pill/close events
 *   HistoryPanel.refresh() — re-render all sections with latest data
 */
const HistoryPanel = (() => {

  // Active requestAnimationFrame handle
  let _chartRafId = null;
  let _activeView = 'daily';

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    // Chart view pills
    const panel = document.getElementById('history-panel');
    if (!panel) return;

    panel.querySelectorAll('.hgraph-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _activeView = pill.dataset.view;
        const history = _getHistory();
        _drawBarChart(_activeView, history);
      });
    });
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  function refresh() {
    const history = _getHistory();

    // Reset pill
    const panel = document.getElementById('history-panel');
    if (panel) {
      panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
      const d = panel.querySelector('.hgraph-pill[data-view="daily"]');
      if (d) d.classList.add('active');
    }
    _activeView = 'daily';

    _renderStatCards(history);
    _renderStreakRow(history);
    _drawStreakCalendar(history);
    _drawBarChart('daily', history);
    _renderRecentSessions(history);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _getHistory() {
    return (typeof Session !== 'undefined') ? Session.getHistory() : [];
  }

  /** Format total seconds → "1h 42m", "25m", "2h". Never decimals. */
  function _fmtSecs(totalSecs) {
    const m = Math.floor(totalSecs / 60);
    if (m <= 0) return '0m';
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h === 0) return `${rem}m`;
    if (rem === 0) return `${h}h`;
    return `${h}h ${rem}m`;
  }

  function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _isoDay(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  // ── 1. Stat Cards ────────────────────────────────────────────────────────

  function _renderStatCards(history) {
    const now   = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);

    // Sessions for today
    const todaySessions = history.filter(s => s.date && new Date(s.date) >= today);
    const todaySecs     = todaySessions.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0);

    // Sessions since Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekSessions = history.filter(s => s.date && new Date(s.date) >= monday);
    const weekSecs     = weekSessions.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0);

    // Lifetime (completed only, via Session if available)
    const lifetimeMins = (typeof Session !== 'undefined' && Session.getTotalFocusedMinutes)
      ? Session.getTotalFocusedMinutes() : 0;
    const lifetimeSecs = lifetimeMins * 60;

    _setText('hsc-today-focused',    _fmtSecs(todaySecs));
    _setText('hsc-today-sessions',   String(todaySessions.length));
    _setText('hsc-week-focused',     _fmtSecs(weekSecs));
    _setText('hsc-lifetime-focused', _fmtSecs(lifetimeSecs));
  }

  // ── 2. Streak Row ────────────────────────────────────────────────────────

  function _renderStreakRow(history) {
    const current = (typeof Session !== 'undefined' && Session.computeDayStreak)
      ? Session.computeDayStreak() : 0;
    const longest = (typeof Session !== 'undefined' && Session.computeLongestStreak)
      ? Session.computeLongestStreak() : 0;

    // Avg focus score for all COMPLETED sessions
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
  }

  // ── 3. Streak Calendar (canvas 7 columns × 16 rows dot grid) ────────────

  function _drawStreakCalendar(history) {
    const canvas = document.getElementById('hp-streak-canvas');
    if (!canvas) return;

    const WEEKS   = 16;
    const DAYS    = 7;
    const CELL    = 11;  // px per cell
    const GAP     = 2;   // px gap between cells
    const UNIT    = CELL + GAP;

    // 7 columns (M–Su), 16 rows (oldest week on top, current week on bottom)
    const W = DAYS  * UNIT - GAP;
    const H = WEEKS * UNIT - GAP;

    canvas.width        = W * 2;
    canvas.height       = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

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
      if (s.outcome === 'COMPLETED')                               e.hasCompleted = true;
      else if (s.outcome === 'FAILED' || s.outcome === 'ABANDONED') e.hasAttempted = true;
    });

    const now   = new Date();
    now.setHours(0, 0, 0, 0);
    const todayDow = (now.getDay() + 6) % 7; // 0=Mon … 6=Sun

    // Monday of current week
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - todayDow);

    for (let row = 0; row < WEEKS; row++) {
      // row 0 = oldest week, row WEEKS-1 = current week
      const weekOffset = WEEKS - 1 - row; // how many weeks back
      for (let col = 0; col < DAYS; col++) {
        const d = new Date(thisMonday);
        d.setDate(thisMonday.getDate() - weekOffset * 7 + col);

        const isFuture    = d > now;
        const isThisWeek  = weekOffset === 0;
        const key         = _isoDay(d);
        const info        = dayMap.get(key);

        const x = col * UNIT;
        const y = row * UNIT;

        let fillColor;
        if (isFuture) {
          fillColor = 'rgba(255,255,255,0.03)';
        } else if (!info) {
          fillColor = 'rgba(255,255,255,0.05)';
        } else if (info.hasCompleted) {
          fillColor = isThisWeek
            ? 'rgba(155,135,255,0.90)'
            : 'rgba(139,118,255,0.60)';
        } else {
          // attempted only (FAILED or ABANDONED)
          fillColor = 'rgba(139,118,255,0.22)';
        }

        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.roundRect(x, y, CELL, CELL, 2);
        ctx.fill();
      }
    }
  }

  // ── 4. Bar Chart (canvas, 4 views) ───────────────────────────────────────

  function _drawBarChart(view, history) {
    const canvas = document.getElementById('history-chart-canvas');
    if (!canvas) return;

    if (_chartRafId !== null) {
      cancelAnimationFrame(_chartRafId);
      _chartRafId = null;
    }

    let bars;
    if      (view === 'daily')   bars = HistoryStats.buildDailyBars(history, 30);
    else if (view === 'weekly')  bars = HistoryStats.buildWeeklyBars(history, 12);
    else if (view === 'monthly') bars = HistoryStats.buildMonthlyBars(history, 12);
    else                         bars = HistoryStats.buildLifetimeBars(history);

    const W = (canvas.parentElement?.clientWidth || 280);
    const H = 110;
    canvas.width        = W * 2;
    canvas.height       = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    const PAD    = { top: 10, right: 6, bottom: 22, left: 6 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top  - PAD.bottom;

    // Empty state
    if (!bars || !bars.length || bars.every(b => b.focusedMs === 0)) {
      ctx.clearRect(0, 0, W, H);
      _barDrawBg(ctx, W, H, PAD, innerW, innerH);
      ctx.font      = '8px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(139,118,255,0.25)';
      ctx.textAlign = 'center';
      ctx.fillText('no data yet', W / 2, H / 2 + 3);
      ctx.textAlign = 'left';
      return;
    }

    const n      = bars.length;
    const maxMs  = Math.max(...bars.map(b => b.focusedMs), 1);
    const barW   = Math.max(2, (innerW / n) - 2);
    const every  = n <= 7 ? 1 : n <= 14 ? 2 : n <= 30 ? 5 : 4;

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const DURATION  = 600;
    let   startTs   = null;

    function _frame(ts) {
      if (!startTs) startTs = ts;
      const raw   = Math.min(1, (ts - startTs) / DURATION);
      const eased = 1 - Math.pow(1 - raw, 3);

      ctx.clearRect(0, 0, W, H);
      _barDrawBg(ctx, W, H, PAD, innerW, innerH);

      bars.forEach((bar, i) => {
        const isCur   = bar.isToday || bar.isCurrent;
        const heightPx = (bar.focusedMs / maxMs) * innerH * eased;
        const x       = PAD.left + i * (innerW / n) + (innerW / n - barW) / 2;
        const y       = PAD.top + innerH - heightPx;

        // Bar fill — current period bright, rest ~40% opacity
        if (isCur) {
          const grad = ctx.createLinearGradient(0, y, 0, PAD.top + innerH);
          grad.addColorStop(0,   'rgba(185,165,255,0.95)');
          grad.addColorStop(1,   'rgba(139,118,255,0.70)');
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = 'rgba(155,135,255,0.38)';
        }

        ctx.shadowColor = isCur ? 'rgba(155,135,255,0.55)' : 'transparent';
        ctx.shadowBlur  = isCur ? 6 : 0;

        ctx.beginPath();
        ctx.roundRect(x, y, barW, heightPx, [2, 2, 0, 0]);
        ctx.fill();
        ctx.shadowBlur = 0;

        // X axis label
        if (i % every === 0 && bar.focusedMs >= 0) {
          const d = bar.label;
          let label;
          if      (view === 'daily')   label = String(d.getDate());
          else if (view === 'weekly')  label = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
          else                         label = MONTH_NAMES[d.getMonth()];

          ctx.font      = '6.5px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = isCur ? 'rgba(210,195,255,0.90)' : 'rgba(139,118,255,0.45)';
          ctx.fillText(label, x + barW / 2, H - 6);
          ctx.textAlign = 'left';
        }
      });

      if (raw < 1) {
        _chartRafId = requestAnimationFrame(_frame);
      } else {
        _chartRafId = null;
      }
    }

    _chartRafId = requestAnimationFrame(_frame);
  }

  function _barDrawBg(ctx, W, H, PAD, innerW, innerH) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.roundRect(PAD.left, PAD.top, innerW, innerH, 5);
    ctx.fill();

    ctx.strokeStyle = 'rgba(139,118,255,0.07)';
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([3, 4]);
    [0.33, 0.66].forEach(frac => {
      const y = PAD.top + innerH * (1 - frac);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + innerW, y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
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

    container.innerHTML = recent.map((s, idx) => {
      const outcome = String(s.outcome || 'ABANDONED').toUpperCase();

      // Date: "Apr 12" format
      const dateStr = (() => {
        if (!s.date) return '—';
        const d = new Date(s.date);
        if (!isFinite(d.getTime())) return '—';
        return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
      })();

      // Duration
      const durMins = Math.max(0, parseInt(s.durationMinutes, 10) || 0);

      // Focus score
      const scoreNum = (() => {
        const total   = durMins * 60;
        const focused = Math.max(0, parseInt(s.actualFocusedSeconds, 10) || 0);
        return total > 0 ? Math.round((focused / total) * 100) : 0;
      })();

      // Focus rating A+/A/B/C/D/F
      const rating = scoreNum >= 90 ? 'A+' : scoreNum >= 80 ? 'A' : scoreNum >= 70 ? 'B'
                   : scoreNum >= 60 ? 'C'  : scoreNum >= 40 ? 'D' : scoreNum > 0 ? 'F' : '';
      const ratingColor = scoreNum >= 80 ? 'rgba(52,211,153,0.90)'
                        : scoreNum >= 60 ? 'rgba(167,139,250,0.90)'
                        : scoreNum >= 40 ? 'rgba(251,191,36,0.90)'
                        : scoreNum > 0   ? 'rgba(248,113,113,0.88)' : 'rgba(255,255,255,0.20)';

      // Goal display: truncate at 32 chars + answered indicator
      const goalStr = (() => {
        if (!s.goalText) return '—';
        const trunc = s.goalText.length > 32 ? s.goalText.slice(0, 32) + '…' : s.goalText;
        if (s.goalAchieved === true)  return `"${trunc}" ✓`;
        if (s.goalAchieved === false) return `"${trunc}" ✗`;
        return `"${trunc}"`;
      })();

      // Outcome colour class
      const outCls = outcome === 'COMPLETED' ? 'hp-ri-completed'
                   : outcome === 'FAILED'    ? 'hp-ri-failed'
                   : 'hp-ri-abandoned';

      // Outcome label (for abandoned and failed rows)
      const outLabel = outcome === 'COMPLETED' ? ''
                     : outcome === 'FAILED'    ? ' · <span class="hp-ri-outcome-tag hp-ri-failed-tag">FAILED</span>'
                     : ' · <span class="hp-ri-outcome-tag hp-ri-abandoned-tag">ABANDONED</span>';

      return `
        <div class="hp-recent-row ${outCls}" style="animation-delay:${idx * 35}ms">
          <div class="hp-rr-left">
            <span class="hp-rr-date">${_esc(dateStr)}</span>
            <span class="hp-rr-sep">·</span>
            <span class="hp-rr-dur">${durMins}m</span>
            ${scoreNum > 0 ? `<span class="hp-rr-sep">·</span><span class="hp-rr-score">${scoreNum}%</span>` : ''}
            ${outLabel}
          </div>
          <div class="hp-rr-right">
            <span class="hp-rr-goal">${_esc(goalStr)}</span>
            ${rating ? `<span class="hp-rr-rating" style="color:${ratingColor}">${rating}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  return { init, refresh };

})();
