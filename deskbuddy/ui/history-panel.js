/**
 * HistoryPanel — Session history dashboard (left-side hover sidebar).
 *
 * Open/close is owned by renderer.js's _wireHistorySidebar().
 *
 * Sections:
 *   1. Header
 *   2. Period tabs — Day / Week / Month / All Time
 *   3. Hero stat — big focused-time for the selected period
 *   4. Stats row — Today / Week / Month / All Time totals
 *   5. Streak calendar — HTML month-grid calendar with nav
 *   6. Focus graph — animated bezier line, pill-switchable
 *   7. Recent sessions list
 *
 * Public API:
 *   HistoryPanel.init()     — wire events
 *   HistoryPanel.refresh()  — re-render all sections with latest history data
 */
const HistoryPanel = (() => {

  // ── Constants ─────────────────────────────────────────────────────────────

  const GOAL_MS = 120 * 60 * 1000; // 2-hour daily focus goal

  // Active requestAnimationFrame handle for the line graph animation
  let _chartRafId = null;

  // Calendar navigation state — which month is visible
  let _calYear  = new Date().getFullYear();
  let _calMonth = new Date().getMonth();   // 0-based

  // Which period tab is active
  let _activePeriod = 'daily';

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    const panel = document.getElementById('history-panel');
    if (!panel) return;

    // Period tabs
    panel.querySelectorAll('.hp-period-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.hp-period-tab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        _activePeriod = tab.dataset.period;
        const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];
        const streak  = (typeof Session !== 'undefined' && Session.computeDayStreak) ? Session.computeDayStreak() : 0;
        _renderHero(history, streak, _activePeriod);
        _renderBreakdown(history, _activePeriod);
        _syncGraphToPeriod(_activePeriod);
      });
    });

    // Focus graph pills
    panel.querySelectorAll('.hgraph-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _updateGraphLabel(pill.dataset.view);
        _drawChart(pill.dataset.view);
      });
    });

    // Calendar navigation
    const prevBtn = document.getElementById('hp-cal-prev');
    const nextBtn = document.getElementById('hp-cal-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        _calMonth--;
        if (_calMonth < 0) { _calMonth = 11; _calYear--; }
        const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];
        _renderCalendarHTML(history);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        _calMonth++;
        if (_calMonth > 11) { _calMonth = 0; _calYear++; }
        const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];
        _renderCalendarHTML(history);
      });
    }

    // "Show more" in recent sessions
    const moreBtn = document.getElementById('hp-recent-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];
        _renderRecentSessions(history, true);
        moreBtn.style.display = 'none';
      });
    }
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  function refresh() {
    const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];
    const streak  = (typeof Session !== 'undefined' && Session.computeDayStreak) ? Session.computeDayStreak() : 0;

    // Reset calendar to current month on each open
    _calYear  = new Date().getFullYear();
    _calMonth = new Date().getMonth();

    // Reset to daily tab
    _activePeriod = 'daily';
    const panel = document.getElementById('history-panel');
    if (panel) {
      panel.querySelectorAll('.hp-period-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      const dayTab = panel.querySelector('.hp-period-tab[data-period="daily"]');
      if (dayTab) { dayTab.classList.add('active'); dayTab.setAttribute('aria-selected', 'true'); }
    }

    _renderHeroDate();
    _renderHero(history, streak, 'daily');
    _renderBreakdown(history, 'daily');
    _renderStatRow(history, streak);
    _renderCalendarHTML(history);
    _renderRecentSessions(history, false);

    // Reset graph pill to 'daily'
    if (panel) {
      panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
      const dailyPill = panel.querySelector('.hgraph-pill[data-view="daily"]');
      if (dailyPill) dailyPill.classList.add('active');
    }
    _updateGraphLabel('daily');
    _drawChart('daily');
  }

  // ── Hero date label ───────────────────────────────────────────────────────

  function _renderHeroDate() {
    const el = document.getElementById('hp-hero-date');
    if (!el) return;
    const now    = new Date();
    const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    el.textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()}`;
  }

  // ── Hero — period-aware big stat ──────────────────────────────────────────

  function _renderHero(history, streak, period) {
    const PERIOD_LABELS = { daily: 'TODAY', weekly: 'THIS WEEK', monthly: 'THIS MONTH', lifetime: 'ALL TIME' };

    // Resolve which sessions to show
    let sessions;
    if      (period === 'daily')    sessions = HistoryStats.getSessionsForToday(history);
    else if (period === 'weekly')   sessions = HistoryStats.getSessionsForWeek(history);
    else if (period === 'monthly')  sessions = HistoryStats.getSessionsForMonth(history);
    else                            sessions = history;

    const focusedMs = HistoryStats.getFocusedMs(sessions);

    // Period badge
    const badgeEl = document.getElementById('hp-hero-period-label');
    if (badgeEl) badgeEl.textContent = PERIOD_LABELS[period] || 'TODAY';

    // Big focused time
    _setText('hstat-period-focused', HistoryStats.formatFocusTime(focusedMs));
    _setText('hstat-period-sessions', String(sessions.length));

    // Avg score
    const completed = sessions.filter(s => s.outcome === 'COMPLETED');
    if (completed.length > 0) {
      const avg = Math.round(
        completed.reduce((sum, s) => {
          const total   = (s.durationMinutes || 0) * 60;
          const focused = s.actualFocusedSeconds || 0;
          return sum + (total > 0 ? (focused / total) * 100 : 0);
        }, 0) / completed.length
      );
      _setText('hstat-focus-score-avg', `${avg}%`);
    } else {
      _setText('hstat-focus-score-avg', '—');
    }

    // Best single session focus time (max actualFocusedSeconds)
    const maxFocusMs = _getMaxFocusMs(sessions);
    _setText('hstat-period-max', maxFocusMs > 0 ? HistoryStats.formatFocusTime(maxFocusMs) : '—');

    // Streak chip
    _setText('hstat-streak-current', String(streak));

    // Goal progress bar (daily only — target 2h)
    const goalWrap = document.getElementById('hp-goal-bar-wrap');
    const goalFill = document.getElementById('hp-goal-bar-fill');
    const goalLbl  = document.getElementById('hp-goal-bar-label');
    if (goalWrap) {
      if (period === 'daily') {
        goalWrap.style.display = '';
        const pct = Math.min(100, Math.round((focusedMs / GOAL_MS) * 100));
        if (goalFill) goalFill.style.width = pct + '%';
        if (goalLbl)  goalLbl.textContent  = pct >= 100 ? '🎯 daily goal reached!' : `${pct}% of 2h daily goal`;
        if (goalFill) {
          goalFill.style.background = pct >= 100
            ? 'linear-gradient(90deg, rgba(52,211,153,0.90), rgba(52,211,153,0.60))'
            : 'linear-gradient(90deg, rgba(139,118,255,0.90), rgba(88,60,200,0.60))';
        }
      } else {
        goalWrap.style.display = 'none';
      }
    }

    // Goal glow on daily
    const card = document.querySelector('.hp-hero-card');
    if (card) {
      const pct = Math.min(1, focusedMs / GOAL_MS);
      card.classList.toggle('hp-hero-goal-achieved', period === 'daily' && pct >= 1);
    }

    // Motivational message
    _renderHeroMotivation(history, streak, period);
  }

  function _renderHeroMotivation(history, streak, period) {
    const el = document.getElementById('hp-hero-motivation');
    if (!el) return;

    const today          = HistoryStats.getSessionsForToday(history);
    const todayCompleted = today.filter(s => s.outcome === 'COMPLETED');
    const todayMins      = Math.round(HistoryStats.getFocusedMs(today) / 60000);

    let msg = '';
    if      (streak >= 30)               msg = `👑 ${streak}-day streak — legendary.`;
    else if (streak >= 14)               msg = `🌟 ${streak} days strong. You're on a roll.`;
    else if (streak >= 7)                msg = `⚡ ${streak}-day streak. Keep the fire alive.`;
    else if (streak >= 3)                msg = `🔥 ${streak} days in a row. Momentum building.`;
    else if (todayCompleted.length >= 3) msg = '🎯 Three sessions today. Excellent focus.';
    else if (todayMins >= 90)            msg = '💪 90+ minutes focused today. Great work.';
    else if (todayCompleted.length >= 1) msg = '✅ Session done. Keep stacking.';
    else                                 msg = '✨ Ready when you are.';

    el.textContent = msg;
  }

  // ── Stats row (Today / Week / Month / All Time) ────────────────────────────

  function _renderStatRow(history, streak) {
    const today   = HistoryStats.getSessionsForToday(history);
    const week    = HistoryStats.getSessionsForWeek(history);
    const month   = HistoryStats.getSessionsForMonth(history);

    _setText('hstat-today-focused',    HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(today)));
    _setText('hstat-today-sessions',   String(today.length));
    _setText('hstat-today-max',        _fmtMax(_getMaxFocusMs(today)));

    _setText('hstat-week-focused',     HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(week)));
    _setText('hstat-week-sessions',    String(week.length));
    _setText('hstat-week-max',         _fmtMax(_getMaxFocusMs(week)));

    _setText('hstat-month-focused',    HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(month)));
    _setText('hstat-month-sessions',   String(month.length));
    _setText('hstat-month-max',        _fmtMax(_getMaxFocusMs(month)));

    const lifetimeMs = (typeof Session !== 'undefined' ? Session.getTotalFocusedMinutes() : 0) * 60 * 1000;
    _setText('hstat-lifetime-focused', HistoryStats.formatFocusTime(lifetimeMs));
    _setText('hstat-lifetime-sessions', String(history.length));
    _setText('hstat-lifetime-max',     _fmtMax(_getMaxFocusMs(history)));

    // Keep hidden compatibility IDs
    const longest = (typeof Session !== 'undefined' && Session.computeLongestStreak) ? Session.computeLongestStreak() : 0;
    _setText('hstat-streak-longest', String(longest));
    _setText('hstat-week-streak', String(streak));
  }

  /** Returns max actualFocusedSeconds * 1000 across completed sessions, else 0. */
  function _getMaxFocusMs(sessions) {
    let max = 0;
    sessions.forEach(s => {
      if (s.outcome !== 'COMPLETED') return;
      const ms = (s.actualFocusedSeconds || 0) * 1000;
      if (ms > max) max = ms;
    });
    return max;
  }

  function _fmtMax(ms) {
    return ms > 0 ? HistoryStats.formatFocusTime(ms) : '—';
  }

  // ── Outcome breakdown (completed / failed / abandoned / rate) ────────────

  function _renderBreakdown(history, period) {
    let sessions;
    if      (period === 'daily')   sessions = HistoryStats.getSessionsForToday(history);
    else if (period === 'weekly')  sessions = HistoryStats.getSessionsForWeek(history);
    else if (period === 'monthly') sessions = HistoryStats.getSessionsForMonth(history);
    else                           sessions = history;

    const completed = sessions.filter(s => s.outcome === 'COMPLETED').length;
    const failed    = sessions.filter(s => s.outcome === 'FAILED').length;
    const abandoned = sessions.filter(s => s.outcome === 'ABANDONED').length;
    const total     = sessions.length;
    const rate      = total > 0 ? Math.round((completed / total) * 100) : null;

    _setText('hstat-bk-completed', String(completed));
    _setText('hstat-bk-failed',    String(failed));
    _setText('hstat-bk-abandoned', String(abandoned));
    _setText('hstat-bk-rate', rate !== null ? `${rate}%` : '—');

    // Colour-code the rate
    const rateEl = document.getElementById('hstat-bk-rate');
    if (rateEl) {
      rateEl.style.color = rate === null ? ''
        : rate >= 80 ? 'rgba(52,211,153,0.94)'
        : rate >= 50 ? 'rgba(167,139,250,0.94)'
        : 'rgba(248,113,113,0.88)';
    }
  }

  // ── HTML calendar ─────────────────────────────────────────────────────────

  /**
   * Renders a proper wall-calendar HTML grid for _calYear/_calMonth.
   * Each day cell shows the date number + a coloured dot if sessions exist.
   * Today gets a highlighted ring, future dates are dimmed.
   */
  function _renderCalendarHTML(history) {
    const grid = document.getElementById('hp-calendar-grid');
    if (!grid) return;

    const MONTH_NAMES = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
    const DOW_LABELS  = ['Mo','Tu','We','Th','Fr','Sa','Su'];

    // Update month/year label
    const labelEl = document.getElementById('hp-cal-month-label');
    if (labelEl) labelEl.textContent = `${MONTH_NAMES[_calMonth]} ${_calYear}`;

    const today      = new Date(); today.setHours(0, 0, 0, 0);
    const firstDay   = new Date(_calYear, _calMonth, 1);
    const totalDays  = new Date(_calYear, _calMonth + 1, 0).getDate();
    const startCol   = (firstDay.getDay() + 6) % 7; // 0=Mon

    // Build session map for this month (generous window)
    const dayMap = HistoryStats.buildCalendarData(history, 18);

    let html = '';

    // Day-of-week headers
    DOW_LABELS.forEach(d => {
      html += `<div class="hp-cal-dow">${d}</div>`;
    });

    // Leading empty cells
    for (let i = 0; i < startCol; i++) {
      html += `<div class="hp-cal-day hp-cal-day-empty"></div>`;
    }

    // Day cells
    for (let day = 1; day <= totalDays; day++) {
      const d       = new Date(_calYear, _calMonth, day);
      const key     = d.toDateString();
      const info    = dayMap.get(key);
      const isToday = d.getTime() === today.getTime();
      const isFuture = d > today;

      let cls = 'hp-cal-day';
      if (isToday)             cls += ' hp-cal-today';
      else if (isFuture)       cls += ' hp-cal-future';
      else if (info && info.hasCompleted) cls += ' hp-cal-completed';
      else if (info)           cls += ' hp-cal-has-session';

      const dot = (!isFuture && info) ? '<span class="hp-cal-dot"></span>' : '';
      html += `<div class="${cls}" title="${day} ${MONTH_NAMES[_calMonth]}${info ? ' · ' + info.count + ' session' + (info.count !== 1 ? 's' : '') : ''}">
        <span class="hp-cal-num">${day}</span>${dot}
      </div>`;
    }

    grid.innerHTML = html;
  }

  // ── Sync graph pill to period tab ──────────────────────────────────────────

  function _syncGraphToPeriod(period) {
    const panel = document.getElementById('history-panel');
    if (!panel) return;

    // Map period → graph view
    const VIEW_MAP = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', lifetime: 'lifetime' };
    const view = VIEW_MAP[period] || 'daily';

    // Update pill active state
    panel.querySelectorAll('.hgraph-pill').forEach(p => p.classList.remove('active'));
    const pill = panel.querySelector(`.hgraph-pill[data-view="${view}"]`);
    if (pill) pill.classList.add('active');

    _updateGraphLabel(view);
    _drawChart(view);
  }

  function _updateGraphLabel(view) {
    const LABELS = { daily: 'focus time · last 30 days', weekly: 'focus time · weekly', monthly: 'focus time · monthly', lifetime: 'focus time · all time' };
    const el = document.getElementById('hp-graph-label');
    if (el) el.textContent = LABELS[view] || 'focus time';
  }

  // ── Recent sessions list ──────────────────────────────────────────────────

  function _renderRecentSessions(history, showAll) {
    const container = document.getElementById('hp-recent-list');
    const moreBtn   = document.getElementById('hp-recent-more');
    if (!container) return;

    const LIMIT   = showAll ? 20 : 8;
    const recent  = history.slice(0, LIMIT);
    const hasMore = !showAll && history.length > LIMIT;

    if (!recent.length) {
      container.innerHTML = '<div class="hp-recent-empty">✨ No sessions yet — start your first one!</div>';
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }

    const KNOWN_OUTCOMES = new Set(['completed', 'failed', 'abandoned']);

    // Find today's best session index (for star treatment)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let bestTodayScore = -1, bestTodayIdx = -1;
    recent.forEach((s, i) => {
      if (!s.date || new Date(s.date) < todayStart) return;
      if (s.outcome !== 'COMPLETED') return;
      const total   = (s.durationMinutes || 0) * 60;
      const focused = s.actualFocusedSeconds || 0;
      const sc      = total > 0 ? (focused / total) * 100 : 0;
      if (sc > bestTodayScore) { bestTodayScore = sc; bestTodayIdx = i; }
    });

    container.innerHTML = recent.map((s, idx) => {
      const rawOutcome = String(s.outcome || 'ABANDONED').toLowerCase();
      const outcome    = KNOWN_OUTCOMES.has(rawOutcome) ? rawOutcome : 'abandoned';
      const ICONS  = { completed: '✓', failed: '✕', abandoned: '~' };
      const BADGES = { completed: 'done', failed: 'failed', abandoned: 'quit' };
      const icon     = ICONS[outcome];
      const badgeTxt = BADGES[outcome];

      const durMins  = Math.max(0, parseInt(s.durationMinutes, 10) || 0);
      const durLabel = durMins >= 60
        ? `${Math.floor(durMins / 60)}h ${durMins % 60 > 0 ? (durMins % 60) + 'm' : ''}`.trim()
        : `${durMins}m`;

      const scoreNum = (() => {
        if (outcome !== 'completed') return 0;
        const total   = durMins * 60;
        const focused = Math.max(0, parseInt(s.actualFocusedSeconds, 10) || 0);
        return total > 0 ? Math.round((focused / total) * 100) : 0;
      })();

      // 1-5 star rating
      const stars    = scoreNum > 0 ? Math.max(1, Math.round(scoreNum / 20)) : 0;
      const starsHtml = stars > 0
        ? `<span class="hp-ri-stars" title="${scoreNum}% focus">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>`
        : '';

      const exactTime = (() => {
        if (!s.date) return '';
        const d = new Date(s.date);
        if (!isFinite(d.getTime())) return '';
        let h   = d.getHours();
        const m = String(d.getMinutes()).padStart(2, '0');
        const ap = h >= 12 ? 'pm' : 'am';
        h = h % 12 || 12;
        return `${h}:${m}${ap}`;
      })();

      const timeAgo = (() => {
        if (!s.date) return '';
        const t = new Date(s.date).getTime();
        if (!isFinite(t)) return '';
        const diff = Date.now() - t;
        const mins = Math.floor(diff / 60000);
        if (mins < 60)  return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24)   return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days === 1) return 'yesterday';
        if (days < 7)   return `${days}d ago`;
        return `${Math.floor(days / 7)}w ago`;
      })();

      const isBest    = idx === bestTodayIdx && bestTodayScore > 0;
      const bestBadge = isBest ? '<span class="hp-ri-best">⭐ best</span>' : '';

      // Focus rating label (A/B/C/D/F)
      const focusRating = scoreNum >= 90 ? 'A+' : scoreNum >= 80 ? 'A' : scoreNum >= 70 ? 'B'
                        : scoreNum >= 60 ? 'C'  : scoreNum >= 40 ? 'D' : scoreNum > 0 ? 'F' : '';
      const ratingColor = scoreNum >= 80 ? 'rgba(52,211,153,0.90)'
                        : scoreNum >= 60 ? 'rgba(167,139,250,0.90)'
                        : scoreNum >= 40 ? 'rgba(251,191,36,0.90)'
                        : scoreNum > 0   ? 'rgba(248,113,113,0.88)' : '';

      // Day label for sessions older than today
      const dayLabel = (() => {
        if (!s.date) return '';
        const d = new Date(s.date);
        if (!isFinite(d.getTime())) return '';
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const sd  = new Date(d); sd.setHours(0, 0, 0, 0);
        const diff = Math.round((now - sd) / 86400000);
        if (diff === 0) return '';
        if (diff === 1) return 'Yesterday';
        const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        if (diff < 7)  return DAYS[d.getDay()];
        return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
      })();

      const barColor  = scoreNum >= 80 ? 'rgba(52,211,153,0.75)' : scoreNum >= 50 ? 'rgba(139,118,255,0.75)' : 'rgba(248,113,113,0.65)';
      const focusBar  = scoreNum > 0
        ? `<div class="hp-ri-bar-track"><div class="hp-ri-bar-fill" style="width:${scoreNum}%;background:${barColor}"></div></div>`
        : '';

      return `
        <div class="hp-recent-item" style="animation-delay:${idx * 40}ms">
          <div class="hp-ri-outcome hp-ri-outcome-${outcome}">${icon}</div>
          <div class="hp-ri-info">
            <div class="hp-ri-top">
              <span class="hp-ri-duration">${_esc(durLabel)}</span>
              <span class="hp-ri-badge hp-ri-badge-${outcome}">${badgeTxt}</span>
              ${bestBadge}
              ${dayLabel ? `<span class="hp-ri-day">${_esc(dayLabel)}</span>` : ''}
            </div>
            <div class="hp-ri-meta">
              ${exactTime ? `<span class="hp-ri-time">${_esc(exactTime)}</span>` : ''}
              ${timeAgo   ? `<span class="hp-ri-sep">·</span><span class="hp-ri-ago">${_esc(timeAgo)}</span>` : ''}
              ${starsHtml}
            </div>
            ${focusBar}
          </div>
          ${focusRating ? `<div class="hp-ri-rating" style="color:${ratingColor}">${focusRating}</div>` : ''}
        </div>`;
    }).join('');

    if (moreBtn) {
      if (hasMore) {
        moreBtn.style.display = 'flex';
        moreBtn.textContent   = `show ${history.length - LIMIT} more`;
      } else {
        moreBtn.style.display = 'none';
      }
    }
  }

  // ── Line graph (FocusGraph-style) ────────────────────────────────────────

  /**
   * _drawChart(view) — animated bezier line graph, left-to-right reveal.
   *
   * Visual recipe mirrors FocusGraph:
   *  • Dark plot-area background + faint dashed guide lines
   *  • Smooth bezier S-curves between data points (horizontal mid-point CPs)
   *  • Gradient area fill under the curve (purple → transparent)
   *  • Glowing dot on the current / today data point
   *  • Axis labels revealed as the animation sweeps right
   *  • Ease-out cubic timing (matches FocusGraph feel)
   */
  function _drawChart(view) {
    const canvas = document.getElementById('history-chart-canvas');
    if (!canvas) return;

    // Cancel any in-progress animation before starting a new one
    if (_chartRafId !== null) {
      cancelAnimationFrame(_chartRafId);
      _chartRafId = null;
    }

    const history = (typeof Session !== 'undefined') ? Session.getHistory() : [];

    let bars;
    if      (view === 'daily')   bars = HistoryStats.buildDailyBars(history, 30);
    else if (view === 'weekly')  bars = HistoryStats.buildWeeklyBars(history, 12);
    else if (view === 'monthly') bars = HistoryStats.buildMonthlyBars(history, 12);
    else                         bars = HistoryStats.buildLifetimeBars(history);

    // Size canvas at 2× for HiDPI sharpness (same technique as FocusGraph)
    const W = canvas.parentElement?.clientWidth || 230;
    const H = 130;
    canvas.width        = W * 2;
    canvas.height       = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    const PAD    = { top: 14, right: 14, bottom: 24, left: 14 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top  - PAD.bottom;

    // Draw empty state and bail if there's nothing to show
    if (!bars || !bars.length || bars.every(b => b.focusedMs === 0)) {
      ctx.clearRect(0, 0, W, H);
      _gDrawBackground(ctx, W, H, PAD, innerW, innerH);
      ctx.font      = '8px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(139,118,255,0.22)';
      ctx.textAlign = 'center';
      ctx.fillText('no data yet', W / 2, H / 2 + 3);
      ctx.textAlign = 'left';
      return;
    }

    const n     = bars.length;
    const maxMs = Math.max(...bars.map(b => b.focusedMs), 1);

    // Pre-compute pixel (x, y) for each data point
    const pts = bars.map((bar, i) => ({
      x:     PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
      y:     PAD.top  + innerH - (bar.focusedMs / maxMs) * innerH,
      ms:    bar.focusedMs,
      isCur: bar.isToday || bar.isCurrent,
      label: bar.label,
    }));

    const DURATION = 1500; // ms — same as FocusGraph
    let startTs    = null;

    function _frame(ts) {
      if (!startTs) startTs = ts;
      const raw      = Math.min(1, (ts - startTs) / DURATION);
      const eased    = 1 - Math.pow(1 - raw, 3);          // ease-out cubic
      const revealX  = PAD.left + innerW * eased;

      ctx.clearRect(0, 0, W, H);

      // 1. Static background + guide lines (always full-width)
      _gDrawBackground(ctx, W, H, PAD, innerW, innerH);

      // 2. Clip everything dynamic to the swept region
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.left - 2, 0, (revealX - PAD.left) + 4, H);
      ctx.clip();

      // 3. Gradient area fill under the curve
      _gDrawArea(ctx, pts, PAD, innerH);

      // 4. Bezier line curve
      _gDrawLine(ctx, pts);

      ctx.restore();

      // 5. Data-point dots — appear as the sweep reaches them
      _gDrawDots(ctx, pts, revealX);

      // 6. Axis labels — same progressive reveal
      _gDrawLabels(ctx, pts, revealX, W, H, PAD, view);

      if (raw < 1) {
        _chartRafId = requestAnimationFrame(_frame);
      } else {
        _chartRafId = null;
      }
    }

    _chartRafId = requestAnimationFrame(_frame);
  }

  // ── Graph drawing helpers ─────────────────────────────────────────────────

  /** Dark plot area + faint dashed horizontal guide lines (25 / 50 / 75 %). */
  function _gDrawBackground(ctx, W, H, PAD, innerW, innerH) {
    // Plot area fill
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.roundRect(PAD.left, PAD.top, innerW, innerH, 4);
    ctx.fill();

    // Horizontal guide lines
    ctx.strokeStyle = 'rgba(139,118,255,0.08)';
    ctx.lineWidth   = 0.5;
    ctx.setLineDash([3, 4]);
    [0.25, 0.5, 0.75].forEach(frac => {
      const y = PAD.top + innerH * (1 - frac);
      ctx.beginPath();
      ctx.moveTo(PAD.left,           y);
      ctx.lineTo(PAD.left + innerW,  y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  /** Filled gradient area under the bezier curve. */
  function _gDrawArea(ctx, pts, PAD, innerH) {
    if (pts.length < 2) return;
    const baseY = PAD.top + innerH;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, baseY);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], c = pts[i];
      const mx = (p.x + c.x) / 2;
      ctx.bezierCurveTo(mx, p.y, mx, c.y, c.x, c.y);
    }
    ctx.lineTo(pts[pts.length - 1].x, baseY);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, PAD.top, 0, baseY);
    grad.addColorStop(0,   'rgba(139,118,255,0.30)');
    grad.addColorStop(0.55,'rgba(88,60,200,0.12)');
    grad.addColorStop(1,   'rgba(40,20,100,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /** Smooth bezier line with purple glow (mirrors FocusGraph stroke style). */
  function _gDrawLine(ctx, pts) {
    if (pts.length < 2) return;

    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.strokeStyle = 'rgba(167,139,250,0.92)';
    ctx.shadowColor = 'rgba(139,118,255,0.60)';
    ctx.shadowBlur  = 7;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], c = pts[i];
      const mx = (p.x + c.x) / 2;
      ctx.bezierCurveTo(mx, p.y, mx, c.y, c.x, c.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** Dots at each data point; glowing larger dot for the current period. */
  function _gDrawDots(ctx, pts, revealX) {
    pts.forEach(pt => {
      if (pt.x > revealX + 2) return;
      if (pt.ms === 0) return;

      if (pt.isCur) {
        // Outer glow halo
        ctx.fillStyle   = 'rgba(139,118,255,0.18)';
        ctx.shadowColor = 'rgba(139,118,255,0.75)';
        ctx.shadowBlur  = 12;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5.5, 0, Math.PI * 2);
        ctx.fill();

        // Bright centre
        ctx.fillStyle   = 'rgba(225,215,255,0.98)';
        ctx.shadowColor = 'rgba(167,139,250,0.90)';
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = 'rgba(139,118,255,0.60)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  /** Axis labels — shown progressively as the animation sweeps right. */
  function _gDrawLabels(ctx, pts, revealX, W, H, PAD, view) {
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const n           = pts.length;
    const every       = n <= 7 ? 1 : n <= 14 ? 2 : n <= 30 ? 5 : 4;

    ctx.font      = '7px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';

    pts.forEach((pt, i) => {
      if (i % every !== 0) return;
      if (pt.x > revealX + 2) return;

      const d = pt.label;
      let label;
      if      (view === 'daily')   label = String(d.getDate());
      else if (view === 'weekly')  label = `${d.getDate()}/${d.getMonth() + 1}`;
      else                         label = MONTH_NAMES[d.getMonth()];

      ctx.fillStyle = pt.isCur ? 'rgba(210,195,255,0.88)' : 'rgba(139,118,255,0.40)';
      ctx.fillText(label, pt.x, H - 6);
    });

    ctx.textAlign = 'left';
  }

  // ── Period helpers ────────────────────────────────────────────────────────

  function _getSessionsForYesterday(history) {
    const yest    = new Date(); yest.setDate(yest.getDate() - 1); yest.setHours(0, 0, 0, 0);
    const yestEnd = new Date(yest); yestEnd.setHours(23, 59, 59, 999);
    return history.filter(s => {
      if (!s.date) return false;
      const t = new Date(s.date).getTime();
      return t >= yest.getTime() && t <= yestEnd.getTime();
    });
  }

  function _getSessionsForLastWeek(history) {
    const now           = new Date();
    const dow           = (now.getDay() + 6) % 7;
    const thisWeekStart = new Date(now); thisWeekStart.setDate(now.getDate() - dow); thisWeekStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekEnd   = new Date(thisWeekStart.getTime() - 1);
    return history.filter(s => {
      if (!s.date) return false;
      const t = new Date(s.date).getTime();
      return t >= lastWeekStart.getTime() && t <= lastWeekEnd.getTime();
    });
  }

  function _getSessionsForLastMonth(history) {
    const now            = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(thisMonthStart.getTime() - 1);
    return history.filter(s => {
      if (!s.date) return false;
      const t = new Date(s.date).getTime();
      return t >= lastMonthStart.getTime() && t <= lastMonthEnd.getTime();
    });
  }

  function _computeTrend(currentMs, previousMs) {
    if (previousMs === 0) return null;
    return Math.round(((currentMs - previousMs) / previousMs) * 100);
  }

  function _setTrend(id, trend) {
    const el = document.getElementById(id);
    if (!el) return;
    if (trend === null) { el.textContent = ''; el.className = 'hp-trend'; return; }
    const sign   = trend >= 0 ? '+' : '';
    el.textContent = `${sign}${trend}%`;
    el.className   = `hp-trend ${trend >= 0 ? 'hp-trend-up' : 'hp-trend-down'}`;
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
