/**
 * HistoryPanel — Session history dashboard (right-side hover sidebar).
 *
 * Open/close is owned by renderer.js's _wireHistorySidebar().
 * This module handles only data rendering and pill toggling.
 *
 * Sections:
 *   1. Stat cards — today / week / month / lifetime / streaks / avg focus score
 *   2. Streak calendar — activity (16-week), month, or week view on <canvas>
 *   3. Bar chart — focused minutes, 4 view pills (daily/weekly/monthly/lifetime)
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
    _renderStatCards(history);

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

  // ── Streak calendar ───────────────────────────────────────────────────────

  function _renderCalendar(history, view) {
    if (view === 'month') { _renderCalendarMonth(history); return; }
    if (view === 'week')  { _renderCalendarWeek(history);  return; }
    _renderCalendarActivity(history);
  }

  /** 16-week dot grid (original). */
  function _renderCalendarActivity(history) {
    const canvas = document.getElementById('streak-calendar-canvas');
    if (!canvas) return;

    const WEEKS   = 16;
    const COLS    = 7;
    const ROWS    = WEEKS;
    const CELL    = 9;
    const GAP     = 2;
    const STEP    = CELL + GAP;
    const LABEL_H = 14;

    canvas.width  = COLS * STEP;
    canvas.height = ROWS * STEP + LABEL_H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font      = '8px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(155,135,255,0.35)';
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

      if (!info) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
      } else if (info.hasCompleted) {
        ctx.fillStyle = (row === ROWS - 1 && i >= DAYS - dayOfWeek - 1)
          ? 'rgba(155,135,255,0.85)'
          : 'rgba(155,135,255,0.60)';
      } else {
        ctx.fillStyle = 'rgba(155,135,255,0.18)';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, CELL, CELL, 2);
      ctx.fill();
    }
  }

  /** Current calendar month — traditional grid with week rows. */
  function _renderCalendarMonth(history) {
    const canvas = document.getElementById('streak-calendar-canvas');
    if (!canvas) return;

    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();

    // First day of month and total days
    const firstDay   = new Date(year, month, 1);
    const totalDays  = new Date(year, month + 1, 0).getDate();
    // Offset so Monday = col 0
    const startCol   = (firstDay.getDay() + 6) % 7;
    const totalCells = startCol + totalDays;
    const totalRows  = Math.ceil(totalCells / 7);

    const CELL    = 14;
    const GAP     = 3;
    const STEP    = CELL + GAP;
    const LABEL_H = 16;
    const NUM_H   = 10;

    canvas.width  = 7 * STEP;
    canvas.height = totalRows * STEP + LABEL_H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Day-of-week headers
    ctx.font      = '8px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(155,135,255,0.35)';
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
        ctx.fillStyle = 'rgba(155,135,255,0.75)';
      } else if (info && info.hasCompleted) {
        ctx.fillStyle = 'rgba(155,135,255,0.45)';
      } else if (info) {
        ctx.fillStyle = 'rgba(155,135,255,0.16)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, CELL, CELL, 3);
      ctx.fill();

      // Day number
      ctx.font      = '7px "Segoe UI", sans-serif';
      ctx.fillStyle = isToday ? 'rgba(240,230,255,0.95)' : 'rgba(155,135,255,0.45)';
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
    const dayOfWeek = (today.getDay() + 6) % 7; // 0 = Mon
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - dayOfWeek);

    const CELL   = 20;
    const GAP    = 4;
    const STEP   = CELL + GAP;
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
      const isToday   = d.getTime() === today.getTime();
      const isFuture  = d > today;
      const x = i * STEP;

      // Dot / cell
      if (isToday) {
        ctx.fillStyle = 'rgba(155,135,255,0.82)';
      } else if (!isFuture && info && info.hasCompleted) {
        ctx.fillStyle = 'rgba(155,135,255,0.50)';
      } else if (!isFuture && info) {
        ctx.fillStyle = 'rgba(155,135,255,0.18)';
      } else {
        ctx.fillStyle = isFuture ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
      }
      ctx.beginPath();
      ctx.roundRect(x, LABEL_H, CELL, CELL, 5);
      ctx.fill();

      // Date number
      ctx.font      = '8px "Segoe UI", sans-serif';
      ctx.fillStyle = isToday ? 'rgba(240,230,255,0.95)' : 'rgba(155,135,255,0.55)';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.getDate()), x + CELL / 2, LABEL_H + CELL / 2 + 3);

      // Day label below
      ctx.font      = '7px "Segoe UI", sans-serif';
      ctx.fillStyle = isToday ? 'rgba(200,185,255,0.75)' : 'rgba(155,135,255,0.30)';
      ctx.fillText(DAY_LABELS[i].charAt(0), x + CELL / 2, LABEL_H + CELL + 10);

      ctx.textAlign = 'left';
    }
  }

  // ── Bar chart ─────────────────────────────────────────────────────────────

  function _drawChart(view) {
    const canvas = document.getElementById('history-chart-canvas');
    if (!canvas) return;
    const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];

    const W = canvas.parentElement?.clientWidth || 200;
    const H = 130;
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

    const PAD   = { top: 8, right: 6, bottom: 22, left: 6 };
    const maxMs = Math.max(...bars.map(b => b.focusedMs), 1);
    const barW  = Math.max(2, (W - PAD.left - PAD.right) / bars.length - 2);
    const areaH = H - PAD.top - PAD.bottom;

    bars.forEach((bar, i) => {
      const x     = PAD.left + i * ((W - PAD.left - PAD.right) / bars.length);
      const barH  = bar.focusedMs > 0 ? Math.max(3, (bar.focusedMs / maxMs) * areaH) : 0;
      const y     = PAD.top + areaH - barH;
      const isCur = bar.isToday || bar.isCurrent;
      const alpha = isCur ? 0.82 : 0.36;

      ctx.fillStyle = `rgba(155,135,255,${alpha})`;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    });

    const labelEvery = bars.length <= 7 ? 1 : bars.length <= 14 ? 2 : bars.length <= 30 ? 5 : 4;
    ctx.font      = '7px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(155,135,255,0.40)';
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
      ctx.fillText(label, x, H - 6);
    });
    ctx.textAlign = 'left';
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  return { init, refresh };

})();
