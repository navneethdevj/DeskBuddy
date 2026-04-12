/**
 * HistoryPanel — Session history dashboard (right-side hover sidebar).
 *
 * Open/close is owned by renderer.js's _wireHistorySidebar().
 * This module handles data rendering, pill toggling, and all reward systems.
 *
 * Sections:
 *   0. Header with Level/XP progress bar
 *   1. Today hero — progress ring + focused time + motivation message
 *   2. Achievement badges — horizontally scrollable unlocked badges
 *   3. Quick stats 2×2 — week / month / streak / lifetime with trends
 *   4. Activity calendar — 16w / month / week views on <canvas>
 *   5. Focus time bar chart — daily/weekly/monthly/lifetime pills
 *   6. Recent sessions — last 8 sessions with focus bars, stars, timestamps
 *
 * Public API:
 *   HistoryPanel.init()     — wire events
 *   HistoryPanel.refresh()  — re-render all sections with latest history data
 */
const HistoryPanel = (() => {

  // ── Constants ─────────────────────────────────────────────────────────────

  const GOAL_MS   = 120 * 60 * 1000;   // 2-hour daily focus goal
  const RING_R    = 22;
  const RING_CIRC = 2 * Math.PI * RING_R; // ≈ 138.23

  // XP level table
  const LEVELS = [
    { name: 'Beginner',   threshold: 0    },
    { name: 'Learner',    threshold: 60   },
    { name: 'Student',    threshold: 180  },
    { name: 'Focused',    threshold: 380  },
    { name: 'Dedicated',  threshold: 700  },
    { name: 'Expert',     threshold: 1200 },
    { name: 'Master',     threshold: 2200 },
    { name: 'Legend',     threshold: 4500 },
  ];

  // Achievement definitions — test(history, currentStreak) → bool
  const ACHIEVEMENTS = [
    { id: 'first',      icon: '🌱', name: 'First Step',    test: (h) => h.filter(x => x.outcome === 'COMPLETED').length >= 1   },
    { id: 'five',       icon: '🎯', name: 'Sharpshooter',  test: (h) => h.filter(x => x.outcome === 'COMPLETED').length >= 5   },
    { id: 'ten',        icon: '🏆', name: 'Champion',      test: (h) => h.filter(x => x.outcome === 'COMPLETED').length >= 10  },
    { id: 'fifty',      icon: '💎', name: 'Diamond',       test: (h) => h.filter(x => x.outcome === 'COMPLETED').length >= 50  },
    { id: 'hundred',    icon: '🚀', name: 'Centurion',     test: (h) => h.filter(x => x.outcome === 'COMPLETED').length >= 100 },
    { id: 'streak3',    icon: '🔥', name: 'On Fire',       test: (h, s) => s >= 3  },
    { id: 'streak7',    icon: '⚡', name: 'Lightning',     test: (h, s) => s >= 7  },
    { id: 'streak14',   icon: '🌟', name: 'Fortnight',     test: (h, s) => s >= 14 },
    { id: 'streak30',   icon: '👑', name: 'Royalty',       test: (h, s) => s >= 30 },
    { id: 'perfect',    icon: '✨', name: 'Perfectionist', test: (h) => h.some(x => x.outcome === 'COMPLETED' && (x.durationMinutes || 0) > 0 && (x.actualFocusedSeconds || 0) >= (x.durationMinutes * 60) * 0.97) },
    { id: 'early',      icon: '🌅', name: 'Early Bird',    test: (h) => h.some(x => x.date && new Date(x.date).getHours() < 8  && x.outcome === 'COMPLETED') },
    { id: 'night',      icon: '🌙', name: 'Night Owl',     test: (h) => h.some(x => x.date && new Date(x.date).getHours() >= 22 && x.outcome === 'COMPLETED') },
    { id: 'marathon',   icon: '🏃', name: 'Marathoner',    test: (h) => h.some(x => x.outcome === 'COMPLETED' && (x.durationMinutes || 0) >= 60) },
    { id: 'comeback',   icon: '💪', name: 'Comeback Kid',  test: (h) => { for (let i = 1; i < h.length; i++) { if (h[i].outcome === 'FAILED' && h[i-1].outcome === 'COMPLETED') return true; } return false; } },
    { id: 'consistent', icon: '📅', name: 'Consistent',    test: (h, s) => s >= 5  },
  ];

  // Active requestAnimationFrame handle for the line graph animation
  let _chartRafId = null;

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

    _renderHeroDate();
    _renderHeroProgress(history);
    _renderHeroMotivation(history, streak);
    _renderLevelXP(history);
    _renderAchievements(history, streak);
    _renderStatCards(history, streak);
    _renderRecentSessions(history, false);

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
    const now    = new Date();
    const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    el.textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()}`;
  }

  // ── Hero progress ring ────────────────────────────────────────────────────

  function _renderHeroProgress(history) {
    const todaySessions = HistoryStats.getSessionsForToday(history);
    const todayMs       = HistoryStats.getFocusedMs(todaySessions);
    const pct           = Math.min(1, todayMs / GOAL_MS);

    // Today's focused time and session count
    _setText('hstat-today-focused',  HistoryStats.formatFocusTime(todayMs));
    _setText('hstat-today-sessions', String(todaySessions.length));

    // SVG ring
    const fill  = document.getElementById('hp-ring-fill');
    const pctEl = document.getElementById('hp-ring-pct');
    if (fill) {
      fill.style.strokeDasharray  = RING_CIRC;
      fill.style.strokeDashoffset = RING_CIRC * (1 - pct);
    }
    if (pctEl) pctEl.textContent = `${Math.round(pct * 100)}%`;

    // Goal-achieved glow class
    const card = document.querySelector('.hp-hero-card');
    if (card) card.classList.toggle('hp-hero-goal-achieved', pct >= 1);

    // Today vs yesterday delta
    const yestMs  = HistoryStats.getFocusedMs(_getSessionsForYesterday(history));
    const deltaEl = document.getElementById('hp-vs-yesterday');
    if (deltaEl) {
      if (yestMs > 0 || todayMs > 0) {
        const diffMins = Math.round((todayMs - yestMs) / 60000);
        const sign     = diffMins >= 0 ? '+' : '';
        const cls      = diffMins >= 0 ? 'hp-delta-up' : 'hp-delta-down';
        deltaEl.innerHTML = `<span class="${cls}">${sign}${diffMins}m vs yesterday</span>`;
        deltaEl.style.display = '';
      } else {
        deltaEl.style.display = 'none';
      }
    }
  }

  // ── Hero motivational message ─────────────────────────────────────────────

  function _renderHeroMotivation(history, streak) {
    const el = document.getElementById('hp-hero-motivation');
    if (!el) return;

    const today          = HistoryStats.getSessionsForToday(history);
    const todayCompleted = today.filter(s => s.outcome === 'COMPLETED');
    const todayMins      = Math.round(HistoryStats.getFocusedMs(today) / 60000);

    let msg = '';
    if      (streak >= 30)               msg = '👑 Legendary streak! You\'re unstoppable.';
    else if (streak >= 14)               msg = `🌟 ${streak}-day streak — you're a legend.`;
    else if (streak >= 7)                msg = `⚡ ${streak} days strong. Lightning focus!`;
    else if (streak >= 3)                msg = `🔥 ${streak}-day streak. Momentum is real.`;
    else if (todayCompleted.length >= 4) msg = '🏆 Incredible day. Absolutely crushing it!';
    else if (todayCompleted.length >= 3) msg = '🎯 Three sessions in. Elite performance!';
    else if (todayMins >= 90)            msg = '💪 90+ min focused today. Elite work.';
    else if (todayCompleted.length >= 2) msg = '✅ Two sessions done. Keep stacking wins.';
    else if (todayCompleted.length === 1)msg = '🌱 First session done! Build the chain.';
    else if (today.length === 0)         msg = '✨ Ready to focus? Your streak awaits.';
    else                                 msg = '💡 Every focused minute compounds.';

    el.textContent = msg;
  }

  // ── Level & XP system ────────────────────────────────────────────────────

  function _computeXP(history) {
    return history.reduce((xp, s) => {
      const mins    = s.durationMinutes || 0;
      const total   = mins * 60;
      const focused = s.actualFocusedSeconds || 0;
      const quality = total > 0 ? focused / total : 0;
      if      (s.outcome === 'COMPLETED') return xp + Math.round(mins * quality * 2.5 + 5);
      else if (s.outcome === 'FAILED')    return xp + Math.round(mins * 0.4);
      else                                return xp + Math.round(mins * 0.1);
    }, 0);
  }

  function _getLevelInfo(xp) {
    let lvlIdx = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (xp >= LEVELS[i].threshold) lvlIdx = i;
    }
    const cur     = LEVELS[lvlIdx];
    const next    = LEVELS[lvlIdx + 1];
    const prgXP   = xp - cur.threshold;
    const needXP  = next ? next.threshold - cur.threshold : 1;
    return {
      level:    lvlIdx + 1,
      name:     cur.name,
      xp,
      prgXP,
      needXP,
      pct:      next ? Math.min(1, prgXP / needXP) : 1,
      isMax:    !next,
      nextName: next ? next.name : null,
    };
  }

  function _renderLevelXP(history) {
    const xp   = _computeXP(history);
    const info = _getLevelInfo(xp);

    const levelEl = document.getElementById('hp-level-label');
    const xpFill  = document.getElementById('hp-xp-fill');
    const xpText  = document.getElementById('hp-xp-text');
    const xpBadge = document.getElementById('hp-xp-badge');

    if (levelEl) levelEl.textContent = `Lv ${info.level}`;
    if (xpFill)  xpFill.style.width  = `${Math.round(info.pct * 100)}%`;
    if (xpText)  xpText.textContent  = info.isMax ? `${xp} XP · MAX` : `${info.prgXP} / ${info.needXP} XP`;
    if (xpBadge) xpBadge.title       = `${info.name} · ${xp} total XP`;
  }

  // ── Achievement badges ────────────────────────────────────────────────────

  function _renderAchievements(history, streak) {
    const container = document.getElementById('hp-achievements');
    if (!container) return;

    const unlocked = ACHIEVEMENTS.filter(a => a.test(history, streak));
    const locked   = ACHIEVEMENTS.filter(a => !a.test(history, streak));

    const unlockedHtml = unlocked.map(a => `
      <div class="hp-badge hp-badge-unlocked" title="${_esc(a.name)}">
        <span class="hp-badge-icon">${a.icon}</span>
        <span class="hp-badge-name">${_esc(a.name)}</span>
      </div>`).join('');

    // Show up to 4 locked badges as "next goals"
    const lockedHtml = locked.slice(0, Math.max(0, 5 - unlocked.length)).map(a => `
      <div class="hp-badge hp-badge-locked" title="${_esc(a.name)} (locked)">
        <span class="hp-badge-icon">🔒</span>
        <span class="hp-badge-name">${_esc(a.name)}</span>
      </div>`).join('');

    container.innerHTML = unlockedHtml + lockedHtml;
  }

  // ── Stat cards ────────────────────────────────────────────────────────────

  function _renderStatCards(history, streak) {
    const todaySessions  = HistoryStats.getSessionsForToday(history);
    const weekSessions   = HistoryStats.getSessionsForWeek(history);
    const monthSessions  = HistoryStats.getSessionsForMonth(history);
    const lastWeek       = _getSessionsForLastWeek(history);
    const lastMonth      = _getSessionsForLastMonth(history);

    // Today (used by hero chips)
    _setText('hstat-today-sessions', String(todaySessions.length));

    // This week
    _setText('hstat-week-focused',   HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(weekSessions)));
    _setText('hstat-week-sessions',  String(weekSessions.length));
    _setTrend('hstat-week-trend', _computeTrend(
      HistoryStats.getFocusedMs(weekSessions),
      HistoryStats.getFocusedMs(lastWeek)
    ));

    // This month
    _setText('hstat-month-focused',  HistoryStats.formatFocusTime(HistoryStats.getFocusedMs(monthSessions)));
    _setText('hstat-month-sessions', String(monthSessions.length));
    _setTrend('hstat-month-trend', _computeTrend(
      HistoryStats.getFocusedMs(monthSessions),
      HistoryStats.getFocusedMs(lastMonth)
    ));

    // Streak
    _setText('hstat-week-streak', String(streak));
    _setText('hstat-streak-current', String(streak));
    const longest = (typeof Session !== 'undefined' && Session.computeLongestStreak) ? Session.computeLongestStreak() : 0;
    _setText('hstat-streak-longest', String(longest));

    // Lifetime
    _setText('hstat-lifetime-focused', HistoryStats.formatFocusTime(
      (typeof Session !== 'undefined' ? Session.getTotalFocusedMinutes() : 0) * 60 * 1000
    ));

    // Focus score avg (for hero chip)
    const completed = history.filter(s => s.outcome === 'COMPLETED');
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

      const barColor  = scoreNum >= 80 ? 'var(--col-green)' : scoreNum >= 50 ? 'var(--col-purple)' : 'var(--col-red)';
      const focusBar  = scoreNum > 0
        ? `<div class="hp-ri-bar-track"><div class="hp-ri-bar-fill" style="width:${scoreNum}%;background:${barColor}"></div></div>`
        : '';

      return `
        <div class="hp-recent-item" style="animation-delay:${idx * 50}ms">
          <div class="hp-ri-outcome hp-ri-outcome-${outcome}">${icon}</div>
          <div class="hp-ri-info">
            <div class="hp-ri-top">
              <span class="hp-ri-duration">${_esc(durLabel)}</span>
              <span class="hp-ri-badge hp-ri-badge-${outcome}">${badgeTxt}</span>
              ${bestBadge}
            </div>
            <div class="hp-ri-meta">
              ${exactTime ? `<span class="hp-ri-time">${_esc(exactTime)}</span>` : ''}
              ${timeAgo   ? `<span class="hp-ri-sep">·</span><span class="hp-ri-ago">${_esc(timeAgo)}</span>` : ''}
              ${starsHtml}
            </div>
            ${focusBar}
          </div>
          ${scoreNum > 0 ? `<div class="hp-ri-score">${scoreNum}%</div>` : ''}
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
