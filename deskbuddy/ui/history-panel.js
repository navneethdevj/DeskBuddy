/**
 * HistoryPanel — Session history dashboard.
 *
 * Sections:
 *   1. Stat cards: today / week / lifetime / streaks + avg focus score
 *   2. Streak calendar: 16-week dot grid on canvas
 *   3. Chart: bar chart of focused minutes, 4 views (daily/weekly/monthly/lifetime)
 *
 * Public API:
 *   HistoryPanel.init()     — wire buttons + panel open/close
 *   HistoryPanel.refresh()  — re-render with latest history data
 */
const HistoryPanel = (() => {

  let _open = false;

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    const btn   = document.getElementById('history-btn');
    const panel = document.getElementById('history-panel');
    const close = document.getElementById('history-close-btn');

    if (!btn || !panel) return;

    btn.addEventListener('click', () => {
      if (_open) {
        _close();
      } else {
        // Close settings panel if open
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel?.classList.contains('settings-open')) {
          document.getElementById('settings-gear-btn')?.click();
        }
        _open = true;
        panel.classList.add('history-open');
        refresh();
      }
    });

    if (close) close.addEventListener('click', _close);

    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') _close();
    });

    // View toggle pills
    panel.querySelectorAll('.hgraph-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _drawChart(pill.dataset.view);
      });
    });
  }

  function _close() {
    _open = false;
    const panel = document.getElementById('history-panel');
    if (panel) panel.classList.remove('history-open');
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  function refresh() {
    if (!_open) return;
    const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];
    _renderStatCards(history);
    _renderCalendar(history);
    // Reset pill active state to 'daily' and redraw
    const panel = document.getElementById('history-panel');
    if (panel) {
      panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
      const dailyPill = panel.querySelector('.hgraph-pill[data-view="daily"]');
      if (dailyPill) dailyPill.classList.add('active');
    }
    _drawChart('daily');
  }

  // ── Stat cards ────────────────────────────────────────────────────────────

  function _renderStatCards(history) {
    const todaySessions = HistoryStats.getSessionsForToday(history);
    const weekSessions  = HistoryStats.getSessionsForWeek(history);

    // Focused time
    _setText('hstat-today-focused',    HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(todaySessions)));
    _setText('hstat-today-sessions',   String(todaySessions.length));
    _setText('hstat-week-focused',     HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(weekSessions)));
    _setText('hstat-lifetime-focused', HistoryStats.formatFocusTime(
      (typeof Session !== 'undefined' ? Session.getTotalFocusedMinutes() : 0) * 60 * 1000
    ));

    // Streaks
    const streak  = (typeof Session !== 'undefined' && Session.computeDayStreak)    ? Session.computeDayStreak()    : 0;
    const longest = (typeof Session !== 'undefined' && Session.computeLongestStreak) ? Session.computeLongestStreak() : 0;
    _setText('hstat-streak-current', `${streak}`);
    _setText('hstat-streak-longest', `${longest}`);

    // Average focus score (ratio of actual focused seconds to total session seconds)
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

  function _renderCalendar(history) {
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

    // Day labels (Mon–Sun)
    ctx.font      = '8px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(155,135,255,0.35)';
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d, i) => {
      ctx.fillText(d, i * STEP + 2, 10);
    });

    // Build day map
    const dayMap = HistoryStats.buildCalendarData(history, WEEKS);

    // Calculate the Monday that starts the grid (16 weeks ago)
    const today     = new Date(); today.setHours(0, 0, 0, 0);
    const dayOfWeek = (today.getDay() + 6) % 7; // 0=Mon
    const DAYS      = COLS * ROWS;
    const gridStart = new Date(today);
    gridStart.setDate(today.getDate() - (DAYS - 1 + dayOfWeek));

    for (let i = 0; i < DAYS; i++) {
      const d   = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x   = col * STEP;
      const y   = row * STEP + LABEL_H;

      if (d > today) continue; // future cells are invisible

      const key  = d.toDateString();
      const info = dayMap.get(key);

      if (!info) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
      } else if (info.hasCompleted) {
        ctx.fillStyle = (row === ROWS - 1 && i >= DAYS - dayOfWeek - 1)
          ? 'rgba(155,135,255,0.85)' // current week — brighter
          : 'rgba(155,135,255,0.60)';
      } else {
        ctx.fillStyle = 'rgba(155,135,255,0.18)';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, CELL, CELL, 2);
      ctx.fill();
    }
  }

  // ── Bar chart ─────────────────────────────────────────────────────────────

  function _drawChart(view) {
    const canvas = document.getElementById('history-chart-canvas');
    if (!canvas) return;
    const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];

    const W = canvas.parentElement?.clientWidth || 300;
    const H = 160;
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

    const PAD   = { top: 10, right: 8, bottom: 28, left: 8 };
    const maxMs = Math.max(...bars.map(b => b.focusedMs), 1);
    const barW  = Math.max(2, (W - PAD.left - PAD.right) / bars.length - 2);
    const areaH = H - PAD.top - PAD.bottom;

    bars.forEach((bar, i) => {
      const x     = PAD.left + i * ((W - PAD.left - PAD.right) / bars.length);
      const barH  = bar.focusedMs > 0 ? Math.max(3, (bar.focusedMs / maxMs) * areaH) : 0;
      const y     = PAD.top + areaH - barH;
      const isCur = bar.isToday || bar.isCurrent;
      const alpha = isCur ? 0.80 : 0.38;

      ctx.fillStyle = `rgba(155,135,255,${alpha})`;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    });

    // X-axis labels — only every Nth bar to prevent crowding
    const labelEvery = bars.length <= 7 ? 1 : bars.length <= 14 ? 2 : bars.length <= 30 ? 5 : 4;
    ctx.font      = '8px "Segoe UI", sans-serif';
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
      ctx.fillText(label, x, H - 8);
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
