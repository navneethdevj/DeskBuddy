/**
 * HistoryPanel — Session history dashboard (right-side hover sidebar).
 *
 * Open/close is owned by renderer.js's _wireHistorySidebar().
 * This module handles only data rendering and pill toggling.
 *
 * Sections:
 *   1. Today hero — big focused time + session chips
 *   2. Quick stats 2×2 — week / month / streak / lifetime
 *   3. Activity calendar — 16w / month / week views on <canvas>
 *   4. Focus time bar chart — daily/weekly/monthly/lifetime pills
 *   5. Recent sessions — last 7 sessions as a styled list
 *
 * Public API:
 *   HistoryPanel.init()     — wire chart-pill and cal-pill click events
 *   HistoryPanel.refresh()  — re-render all sections with latest history data
 */
const HistoryPanel = (() => {

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    const panel = document.getElementById('history-panel');
    if (!panel) return;

    // Focus chart view toggle pills
    panel.querySelectorAll('.hgraph-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _drawChart(pill.dataset.view);
      });
    });

    // Calendar view toggle pills
    panel.querySelectorAll('.hcal-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        panel.querySelectorAll('.hcal-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];
        _renderCalendar(history, pill.dataset.calview);
      });
    });
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  function refresh() {
    const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];

    _renderHeroDate();
    _renderStatCards(history);
    _renderRecentSessions(history);

    // Reset calendar pill to 'activity'
    const panel = document.getElementById('history-panel');
    if (panel) {
      panel.querySelectorAll('.hcal-pill').forEach(p => p.classList.remove('active'));
      const actPill = panel.querySelector('.hcal-pill[data-calview="activity"]');
      if (actPill) actPill.classList.add('active');
    }
    _renderCalendar(history, 'activity');

    // Reset active pill to 'daily'
    if (panel) {
      panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
      const dailyPill = panel.querySelector('.hgraph-pill[data-view="daily"]');
      if (dailyPill) dailyPill.classList.add('active');
    }
    _drawChart('daily');
  }

  // ── Hero date label ───────────────────────────────────────────────────────

  function _renderHeroDate() {
    const el = document.getElementById('hp-hero-date');
    if (!el) return;
    const now = new Date();
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    el.textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()}`;
  }

  // ── Stat cards ────────────────────────────────────────────────────────────

  function _renderStatCards(history) {
    const todaySessions  = HistoryStats.getSessionsForToday(history);
    const weekSessions   = HistoryStats.getSessionsForWeek(history);
    const monthSessions  = HistoryStats.getSessionsForMonth(history);

    // Today
    _setText('hstat-today-focused',  HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(todaySessions)));
    _setText('hstat-today-sessions', String(todaySessions.length));

    // This week
    _setText('hstat-week-focused',   HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(weekSessions)));
    _setText('hstat-week-sessions',  String(weekSessions.length));

    const streak = (typeof Session !== 'undefined' && Session.computeDayStreak) ? Session.computeDayStreak() : 0;
    _setText('hstat-week-streak', String(streak));

    // This month
    _setText('hstat-month-focused',   HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(monthSessions)));
    _setText('hstat-month-sessions',  String(monthSessions.length));

    // Lifetime
    _setText('hstat-lifetime-focused', HistoryStats.formatFocusTime(
      (typeof Session !== 'undefined' ? Session.getTotalFocusedMinutes() : 0) * 60 * 1000
    ));

    const longest = (typeof Session !== 'undefined' && Session.computeLongestStreak) ? Session.computeLongestStreak() : 0;
    _setText('hstat-streak-current', `${streak}`);
    _setText('hstat-streak-longest', `${longest}`);

    const completedSessions = history.filter(s => s.outcome === 'COMPLETED');
    if (completedSessions.length > 0) {
      const avgScore = Math.round(
        completedSessions.reduce((sum, s) => {
          const total   = (s.durationMinutes || 0) * 60;
          const focused = s.actualFocusedSeconds || 0;
          return sum + (total > 0 ? (focused / total) * 100 : 0);
        }, 0) / completedSessions.length
      );
      _setText('hstat-focus-score-avg', `${avgScore}%`);
    } else {
      _setText('hstat-focus-score-avg', '—');
    }
  }

  // ── Recent sessions list ──────────────────────────────────────────────────

  function _renderRecentSessions(history) {
    const container = document.getElementById('hp-recent-list');
    if (!container) return;

    const recent = history.slice(0, 7);

    if (!recent.length) {
      container.innerHTML = '<div class="hp-recent-empty">no sessions yet</div>';
      return;
    }

    // Known outcome values — anything else is treated as abandoned
    const KNOWN_OUTCOMES = new Set(['completed', 'failed', 'abandoned']);

    container.innerHTML = recent.map(s => {
      const rawOutcome = String(s.outcome || 'ABANDONED').toLowerCase();
      const outcome    = KNOWN_OUTCOMES.has(rawOutcome) ? rawOutcome : 'abandoned';
      const icon       = outcome === 'completed' ? '✓' : outcome === 'failed' ? '✕' : '~';
      const badgeTxt   = outcome === 'completed' ? 'done' : outcome === 'failed' ? 'failed' : 'quit';
      const durMins    = Math.max(0, parseInt(s.durationMinutes, 10) || 0);
      const durLabel   = durMins >= 60
        ? `${Math.floor(durMins / 60)}h ${durMins % 60 > 0 ? (durMins % 60) + 'm' : ''}`.trim()
        : `${durMins}m`;

      const score = (() => {
        if (outcome !== 'completed') return '';
        const total   = durMins * 60;
        const focused = Math.max(0, parseInt(s.actualFocusedSeconds, 10) || 0);
        return total > 0 ? `${Math.round((focused / total) * 100)}%` : '';
      })();

      const timeAgo = (() => {
        if (!s.date) return '';
        const t = new Date(s.date).getTime();
        if (!isFinite(t)) return '';
        const diff = Date.now() - t;
        const mins  = Math.floor(diff / 60000);
        if (mins < 60)          return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24)           return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days === 1)         return 'yesterday';
        if (days < 7)           return `${days}d ago`;
        const wks = Math.floor(days / 7);
        return `${wks}w ago`;
      })();

      return `
        <div class="hp-recent-item">
          <div class="hp-ri-outcome hp-ri-outcome-${outcome}">${icon}</div>
          <div class="hp-ri-info">
            <div class="hp-ri-top">
              <span class="hp-ri-duration">${_esc(durLabel)}</span>
              <span class="hp-ri-badge hp-ri-badge-${outcome}">${badgeTxt}</span>
            </div>
            <div class="hp-ri-sub">${_esc(timeAgo)}</div>
          </div>
          ${score ? `<div class="hp-ri-score">${_esc(score)}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ── Streak calendar ───────────────────────────────────────────────────────

  function _renderCalendar(history, view) {
    if (view === 'month') { _renderCalendarMonth(history); return; }
    if (view === 'week')  { _renderCalendarWeek(history);  return; }
    _renderCalendarActivity(history);
  }

  /** 16-week dot grid. */
  function _renderCalendarActivity(history) {
    const canvas = document.getElementById('streak-calendar-canvas');
    if (!canvas) return;

    const WEEKS   = 16;
    const COLS    = 7;
    const ROWS    = WEEKS;
    const CELL    = 11;
    const GAP     = 2;
    const STEP    = CELL + GAP;
    const LABEL_H = 14;

    canvas.width  = COLS * STEP;
    canvas.height = ROWS * STEP + LABEL_H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font      = '8px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(139,118,255,0.32)';
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d, i) => {
      ctx.fillText(d, i * STEP + 2, 10);
    });

    const dayMap    = HistoryStats.buildCalendarData(history, WEEKS);
    const today     = new Date(); today.setHours(0, 0, 0, 0);
    const dayOfWeek = (today.getDay() + 6) % 7;
    const DAYS      = COLS * ROWS;
    const gridStart = new Date(today);
    gridStart.setDate(today.getDate() - (DAYS - 1 + dayOfWeek));

    for (let i = 0; i < DAYS; i++) {
      const d   = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x   = col * STEP;
      const y   = row * STEP + LABEL_H;

      if (d > today) continue;

      const key  = d.toDateString();
      const info = dayMap.get(key);

      const isRecent = (row === ROWS - 1 && i >= DAYS - dayOfWeek - 1);

      if (!info) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
      } else if (info.hasCompleted) {
        ctx.fillStyle = isRecent
          ? 'rgba(139,118,255,0.90)'
          : 'rgba(139,118,255,0.62)';
      } else {
        ctx.fillStyle = 'rgba(139,118,255,0.20)';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, CELL, CELL, 2.5);
      ctx.fill();

      // Glow on completed cells
      if (info && info.hasCompleted) {
        ctx.shadowColor = 'rgba(139,118,255,0.55)';
        ctx.shadowBlur  = 4;
        ctx.beginPath();
        ctx.roundRect(x, y, CELL, CELL, 2.5);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  /** Current calendar month — traditional grid with week rows. */
  function _renderCalendarMonth(history) {
    const canvas = document.getElementById('streak-calendar-canvas');
    if (!canvas) return;

    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();

    const firstDay   = new Date(year, month, 1);
    const totalDays  = new Date(year, month + 1, 0).getDate();
    const startCol   = (firstDay.getDay() + 6) % 7;
    const totalCells = startCol + totalDays;
    const totalRows  = Math.ceil(totalCells / 7);

    const CELL    = 15;
    const GAP     = 3;
    const STEP    = CELL + GAP;
    const LABEL_H = 16;

    canvas.width  = 7 * STEP;
    canvas.height = totalRows * STEP + LABEL_H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font      = '8px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(139,118,255,0.32)';
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d, i) => {
      ctx.fillText(d, i * STEP + (CELL / 2) - 3, 11);
    });

    const dayMap = HistoryStats.buildCalendarData(history, 5);
    const today  = new Date(); today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= totalDays; day++) {
      const cellIdx = startCol + day - 1;
      const col     = cellIdx % 7;
      const row     = Math.floor(cellIdx / 7);
      const x       = col * STEP;
      const y       = row * STEP + LABEL_H;

      const d   = new Date(year, month, day);
      const key = d.toDateString();
      const info = dayMap.get(key);
      const isToday = d.getTime() === today.getTime();

      if (isToday) {
        ctx.fillStyle = 'rgba(139,118,255,0.80)';
      } else if (info && info.hasCompleted) {
        ctx.fillStyle = 'rgba(139,118,255,0.50)';
      } else if (info) {
        ctx.fillStyle = 'rgba(139,118,255,0.18)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, CELL, CELL, 3);
      ctx.fill();

      ctx.font      = '7px "Segoe UI", sans-serif';
      ctx.fillStyle = isToday ? 'rgba(240,230,255,0.98)' : 'rgba(155,135,255,0.48)';
      ctx.textAlign = 'center';
      ctx.fillText(String(day), x + CELL / 2, y + CELL / 2 + 2.5);
      ctx.textAlign = 'left';
    }
  }

  /** Current week — 7 larger cells Mon–Sun with dates. */
  function _renderCalendarWeek(history) {
    const canvas = document.getElementById('streak-calendar-canvas');
    if (!canvas) return;

    const now       = new Date();
    const today     = new Date(now); today.setHours(0, 0, 0, 0);
    const dayOfWeek = (today.getDay() + 6) % 7;
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - dayOfWeek);

    const CELL    = 22;
    const GAP     = 4;
    const STEP    = CELL + GAP;
    const LABEL_H = 14;

    canvas.width  = 7 * STEP - GAP;
    canvas.height = CELL + LABEL_H + 18;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayMap = HistoryStats.buildCalendarData(history, 1);

    for (let i = 0; i < 7; i++) {
      const d   = new Date(weekStart); d.setDate(weekStart.getDate() + i);
      const key = d.toDateString();
      const info = dayMap.get(key);
      const isToday  = d.getTime() === today.getTime();
      const isFuture = d > today;
      const x = i * STEP;

      if (isToday) {
        ctx.fillStyle = 'rgba(139,118,255,0.85)';
        ctx.shadowColor = 'rgba(139,118,255,0.55)';
        ctx.shadowBlur  = 8;
      } else if (!isFuture && info && info.hasCompleted) {
        ctx.fillStyle = 'rgba(139,118,255,0.52)';
        ctx.shadowBlur = 0;
      } else if (!isFuture && info) {
        ctx.fillStyle = 'rgba(139,118,255,0.20)';
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = isFuture ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)';
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.roundRect(x, LABEL_H, CELL, CELL, 6);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font      = '8.5px "Segoe UI", sans-serif';
      ctx.fillStyle = isToday ? 'rgba(240,230,255,0.98)' : 'rgba(155,135,255,0.58)';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.getDate()), x + CELL / 2, LABEL_H + CELL / 2 + 3);

      ctx.font      = '7px "Segoe UI", sans-serif';
      ctx.fillStyle = isToday ? 'rgba(200,185,255,0.78)' : 'rgba(139,118,255,0.32)';
      ctx.fillText(DAY_LABELS[i].charAt(0), x + CELL / 2, LABEL_H + CELL + 11);

      ctx.textAlign = 'left';
    }
  }

  // ── Bar chart ─────────────────────────────────────────────────────────────

  function _drawChart(view) {
    const canvas = document.getElementById('history-chart-canvas');
    if (!canvas) return;
    const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];

    const W = canvas.parentElement?.clientWidth || 220;
    const H = 120;
    canvas.width        = W * 2;
    canvas.height       = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, W, H);

    let bars;
    if      (view === 'daily')   bars = HistoryStats.buildDailyBars(history, 30);
    else if (view === 'weekly')  bars = HistoryStats.buildWeeklyBars(history, 12);
    else if (view === 'monthly') bars = HistoryStats.buildMonthlyBars(history, 12);
    else                         bars = HistoryStats.buildLifetimeBars(history);

    if (!bars.length) return;

    const PAD   = { top: 10, right: 8, bottom: 22, left: 8 };
    const maxMs = Math.max(...bars.map(b => b.focusedMs), 1);
    const barW  = Math.max(2, (W - PAD.left - PAD.right) / bars.length - 2);
    const areaH = H - PAD.top - PAD.bottom;

    // Subtle horizontal reference line at 75%
    const refY = PAD.top + areaH * 0.25;
    ctx.strokeStyle = 'rgba(139,118,255,0.07)';
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, refY);
    ctx.lineTo(W - PAD.right, refY);
    ctx.stroke();
    ctx.setLineDash([]);

    bars.forEach((bar, i) => {
      const x     = PAD.left + i * ((W - PAD.left - PAD.right) / bars.length);
      const barH  = bar.focusedMs > 0 ? Math.max(3, (bar.focusedMs / maxMs) * areaH) : 0;
      const y     = PAD.top + areaH - barH;
      const isCur = bar.isToday || bar.isCurrent;

      if (barH > 0) {
        // Gradient fill
        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        if (isCur) {
          grad.addColorStop(0, 'rgba(139,118,255,0.95)');
          grad.addColorStop(1, 'rgba(88,60,200,0.45)');
        } else {
          grad.addColorStop(0, 'rgba(139,118,255,0.55)');
          grad.addColorStop(1, 'rgba(88,60,200,0.18)');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [2, 2, 0, 0]);
        ctx.fill();

        // Top glow on current bar
        if (isCur) {
          ctx.shadowColor = 'rgba(139,118,255,0.60)';
          ctx.shadowBlur  = 6;
          ctx.fillStyle   = 'rgba(139,118,255,0.90)';
          ctx.beginPath();
          ctx.roundRect(x, y, barW, Math.min(4, barH), [2, 2, 0, 0]);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    });

    const labelEvery = bars.length <= 7 ? 1 : bars.length <= 14 ? 2 : bars.length <= 30 ? 5 : 4;
    ctx.font      = '7px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(139,118,255,0.40)';
    ctx.textAlign = 'center';

    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    bars.forEach((bar, i) => {
      if (i % labelEvery !== 0) return;
      const x = PAD.left + i * ((W - PAD.left - PAD.right) / bars.length) + barW / 2;
      const d = bar.label;
      let label;
      if      (view === 'daily')  label = String(d.getDate());
      else if (view === 'weekly') label = `${d.getDate()}/${d.getMonth() + 1}`;
      else                        label = MONTH_NAMES[d.getMonth()];

      // Highlight current bar label
      const isCur = bar.isToday || bar.isCurrent;
      ctx.fillStyle = isCur ? 'rgba(200,185,255,0.75)' : 'rgba(139,118,255,0.38)';
      ctx.fillText(label, x, H - 6);
    });
    ctx.textAlign = 'left';
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

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

  return { init, refresh };

})();
