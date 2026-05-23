/**
 * DailyTasks — Adaptive daily productivity task system.
 *
 * Generates 6 personalized tasks per day based on:
 *   - Session history (category, length, focus %)
 *   - Current streak
 *   - Time of day
 *   - Day of week
 *
 * Storage:
 *   'deskbuddy_daily_tasks'    → { date, tasks[], taskStreak }
 *
 * Depends on: Session (getHistory, computeDayStreak, getTotalFocusedMinutes)
 */
const DailyTasks = (() => {

  const STORAGE_KEY   = 'deskbuddy_daily_tasks';
  const TASK_COUNT    = 7;

  // ── Private state ──────────────────────────────────────────────────────

  let _tasks      = [];
  let _taskStreak = 0;
  let _isOpen     = false;

  // ── Motivational quotes pool ──────────────────────────────────────────

  const _QUOTES = [
    'Small steps every day build the life you want.',
    'Discipline is choosing between what you want now and what you want most.',
    'The secret of getting ahead is getting started.',
    'Focus is not about saying yes. It\'s about saying no to almost everything.',
    'Done is better than perfect — ship, then iterate.',
    'You don\'t rise to the level of your goals. You fall to the level of your systems.',
    'Energy follows attention. Choose carefully.',
    'One focused hour beats three distracted ones.',
    'Your future self is watching. Make them proud.',
    'Progress, not perfection.',
    'The best time to start was yesterday. The second best time is now.',
    'Consistency compounds. Show up every day.',
    'Rest is part of the work — not a reward for it.',
    'Hard work beats talent when talent doesn\'t work hard.',
    'You\'re closer than you think.',
    'Build the habit first, then optimize it.',
    'Every expert was once a beginner who kept going.',
  ];

  // ── Task templates (data-driven) ──────────────────────────────────────

  function _getTaskPool(history, streak, todayMinutes, dominantCat, avgFocusPct, hourOfDay) {
    const recentLengths = history.slice(0, 5).map(s => s.plannedMinutes || 25);
    const avgLength     = recentLengths.length
      ? Math.round(recentLengths.reduce((a, b) => a + b, 0) / recentLengths.length)
      : 25;
    const isLowFocus    = avgFocusPct < 65;
    const isHighFocus   = avgFocusPct >= 80;
    const isMorning     = hourOfDay < 12;
    const isEvening     = hourOfDay >= 17;
    const isWeekend     = [0, 6].includes(new Date().getDay());

    // Build pool — each entry has: id, type, icon, text
    const pool = [

      // FOCUS tasks
      { id:'f1', type:'focus', icon:'⏱',
        text: `Complete a ${Math.min(avgLength + 5, 45)}‑minute focus session` },
      { id:'f2', type:'focus', icon:'🎯',
        text: `Finish ${dominantCat === 'study' ? 'one study topic' : dominantCat === 'work' ? 'one work task' : 'one creative goal'} today` },
      { id:'f3', type:'focus', icon:'⚡',
        text: `Start your first session before ${isMorning ? '10 AM' : isEvening ? '7 PM' : '2 PM'}` },
      ...(todayMinutes < 30 ? [{ id:'f4', type:'focus', icon:'🚀',
        text:'Log at least 30 minutes of focused work today' }] : []),
      ...(avgLength < 20 ? [{ id:'f5', type:'focus', icon:'📈',
        text:'Push your session to 25 minutes — you can do it' }] : []),

      // STREAK tasks
      { id:'s1', type:'streak', icon:'🔥',
        text: streak > 0 ? `Keep your ${streak}-day streak alive — log a session` : 'Start a new focus streak today' },
      ...(streak >= 3 ? [{ id:'s2', type:'streak', icon:'💪',
        text:`${streak + 1} days in a row incoming — lock it in` }] : []),

      // QUALITY tasks
      { id:'q1', type:'quality', icon:'🧠',
        text: isLowFocus
          ? 'Aim for 70% focus score this session — silence your phone'
          : isHighFocus
            ? 'Maintain your 80%+ focus streak in your next session'
            : 'Hit 75% focus quality in at least one session today' },
      { id:'q2', type:'quality', icon:'📵',
        text:'Put your phone face-down for an entire session' },

      // MOVEMENT tasks
      { id:'m1', type:'movement', icon:'🚶',
        text:'Take a 5-minute walk between sessions' },
      { id:'m2', type:'movement', icon:'🧘',
        text:'Do 10 desk stretches before your next session' },
      { id:'m3', type:'movement', icon:'👁',
        text:'Follow the 20-20-20 rule: every 20 min, look 20 ft away for 20 sec' },

      // HYDRATION
      { id:'h1', type:'hydration', icon:'💧',
        text:'Drink a full glass of water before your first session' },
      { id:'h2', type:'hydration', icon:'🍵',
        text:'Prep your study drink now (water/tea) — don\'t let thirst break focus' },

      // MINDSET tasks
      { id:'i1', type:'mindset', icon:'📝',
        text:'Write down your 3 priorities for today before starting' },
      { id:'i2', type:'mindset', icon:'🌅',
        text: isMorning ? 'Spend 2 minutes setting your intention for today' : 'Review what you accomplished and plan tomorrow\'s top 3' },
      ...(isWeekend ? [{ id:'i3', type:'mindset', icon:'🗓',
        text:'Plan your weekly goals — 10 minutes now saves hours later' }] : []),

      // REVIEW tasks
      { id:'r1', type:'review', icon:'📖',
        text:`Review your ${dominantCat === 'study' ? 'notes from yesterday' : 'last session\'s work'} for 10 minutes` },
      { id:'r2', type:'review', icon:'✅',
        text:'End today\'s last session by writing 3 things you learned' },
      ...(history.length > 3 ? [{ id:'r3', type:'review', icon:'📊',
        text:'Check your focus history — spot a pattern to improve' }] : []),

    ];

    return pool;
  }

  // ── Date helpers ──────────────────────────────────────────────────────

  function _todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  // ── Generate today's tasks ──────────────────────────────────────────

  function _generateTasks() {
    // Gather behavioral data from Session
    let history = [], streak = 0, todayMinutes = 0, avgFocusPct = 72;
    let dominantCat = 'study';

    try {
      if (typeof Session !== 'undefined') {
        history       = Session.getHistory() || [];
        streak        = Session.computeDayStreak() || 0;
        todayMinutes  = Math.round(Session.getTotalFocusedMinutes() || 0);

        // Compute avg focus pct from last 7 sessions
        const recent7 = history.slice(0, 7).filter(s => typeof s.focusPct === 'number');
        if (recent7.length) {
          avgFocusPct = Math.round(recent7.reduce((a, s) => a + s.focusPct, 0) / recent7.length);
        }

        // Dominant category
        const cats = {};
        history.slice(0, 14).forEach(s => { if (s.category) cats[s.category] = (cats[s.category] || 0) + 1; });
        const entries = Object.entries(cats);
        if (entries.length) dominantCat = entries.sort((a,b) => b[1]-a[1])[0][0];
      }
    } catch (_) { /* Session not ready yet */ }

    const pool = _getTaskPool(
      history, streak, todayMinutes, dominantCat, avgFocusPct, new Date().getHours()
    );

    // Shuffle pool deterministically using today's date as seed
    const seed = parseInt(_todayStr().replace(/-/g,'')) % 997;
    const shuffled = pool.slice().sort((a, b) => {
      const ha = ((a.id.charCodeAt(0) * 31 + seed) % 97);
      const hb = ((b.id.charCodeAt(0) * 31 + seed) % 97);
      return ha - hb;
    });

    // Pick TASK_COUNT tasks, ensuring variety (max 2 per type)
    const picked = [];
    const typeCounts = {};
    for (const t of shuffled) {
      if (picked.length >= TASK_COUNT) break;
      const c = typeCounts[t.type] || 0;
      if (c >= 2) continue;
      picked.push({ ...t, done: false });
      typeCounts[t.type] = c + 1;
    }

    // Ensure at least TASK_COUNT items
    while (picked.length < TASK_COUNT && shuffled.length) {
      const t = shuffled[picked.length % shuffled.length];
      if (!picked.find(p => p.id === t.id)) picked.push({ ...t, done: false });
      else break;
    }

    return picked;
  }

  // ── LocalStorage ─────────────────────────────────────────────────────

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        date:        _todayStr(),
        tasks:       _tasks,
        taskStreak:  _taskStreak,
      }));
    } catch (_) {}
  }

  // ── Computed ──────────────────────────────────────────────────────────

  function _doneCount()  { return _tasks.filter(t => t.done).length; }
  function _allDone()    { return _tasks.length > 0 && _doneCount() === _tasks.length; }
  function _randomQuote(){ return _QUOTES[new Date().getDate() % _QUOTES.length]; }

  // ── Render ────────────────────────────────────────────────────────────

  function _renderTasks() {
    const list = document.getElementById('tasks-list');
    if (!list) return;
    list.innerHTML = '';

    _tasks.forEach(task => {
      const item = document.createElement('div');
      item.className  = 'task-item' + (task.done ? ' done' : '');
      item.dataset.id   = task.id;
      item.dataset.type = task.type;
      item.innerHTML = `
        <div class="task-check">${task.done ? '✓' : ''}</div>
        <span class="task-icon">${task.icon}</span>
        <span class="task-text">${escapeHtml ? escapeHtml(task.text) : task.text}</span>
      `;
      item.addEventListener('click', () => _toggleTask(task.id));
      list.appendChild(item);
    });

    _renderProgress();
    _renderAllDone();
    _updateBadge();
  }

  function _renderProgress() {
    const fill  = document.getElementById('tasks-progress-fill');
    const label = document.getElementById('tasks-progress-label');
    if (!fill || !label) return;
    const pct = _tasks.length ? Math.round((_doneCount() / _tasks.length) * 100) : 0;
    fill.style.width   = pct + '%';
    label.textContent  = _doneCount() + ' / ' + _tasks.length + ' done';
  }

  function _renderAllDone() {
    const allDoneEl = document.getElementById('tasks-all-done');
    const listEl    = document.getElementById('tasks-list');
    if (!allDoneEl || !listEl) return;
    if (_allDone()) {
      allDoneEl.classList.add('visible');
      listEl.style.opacity = '0.35';
    } else {
      allDoneEl.classList.remove('visible');
      listEl.style.opacity = '1';
    }
  }

  function _updateBadge() {
    const badge = document.querySelector('#tasks-icon .tasks-badge');
    if (!badge) return;
    const done = _doneCount();
    if (done > 0 && done === _tasks.length) {
      badge.textContent = '✓';
      badge.classList.add('visible');
    } else if (done > 0) {
      badge.textContent = done;
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  }

  // ── Toggle task completion ────────────────────────────────────────────

  function _toggleTask(id) {
    const task = _tasks.find(t => t.id === id);
    if (!task) return;
    task.done = !task.done;

    // Animate the item
    const item = document.querySelector(`.task-item[data-id="${id}"]`);
    if (item) {
      item.classList.add('just-done');
      setTimeout(() => item.classList.remove('just-done'), 400);
    }

    // Check if all done → update streak
    if (_allDone() && !_taskStreak._counted) {
      _taskStreak++;
      _taskStreak._counted = true; // prevent double-count
    }

    _save();
    _renderTasks();

    // Update streak display
    _renderStreak();
  }

  function _renderStreak() {
    const el = document.getElementById('tasks-streak-val');
    if (el) el.textContent = _taskStreak + ' day' + (_taskStreak !== 1 ? 's' : '');
  }

  // ── Panel open/close ──────────────────────────────────────────────────

  function _open() {
    const panel = document.getElementById('tasks-panel');
    const icon  = document.getElementById('tasks-icon');
    if (!panel) return;
    panel.classList.add('tasks-panel-open');
    if (icon) icon.classList.add('tasks-icon-hidden');
    _isOpen = true;

    // Close history panel if open (they share same side)
    const hp = document.getElementById('history-panel');
    if (hp && hp.classList.contains('hp-panel-open')) {
      hp.classList.remove('hp-panel-open');
      const hpIcon = document.getElementById('hp-icon');
      if (hpIcon) hpIcon.classList.remove('hp-icon-hidden');
    }
  }

  function _close() {
    const panel = document.getElementById('tasks-panel');
    const icon  = document.getElementById('tasks-icon');
    if (!panel) return;
    panel.classList.remove('tasks-panel-open');
    if (icon) {
      icon.classList.remove('tasks-icon-hidden');
      icon.style.removeProperty('opacity');
      icon.style.removeProperty('pointer-events');
      icon.style.removeProperty('display');
    }
    _isOpen = false;
  }

  function _toggle() {
    _isOpen ? _close() : _open();
  }

  // ── Init ──────────────────────────────────────────────────────────────

  function init() {
    // Load or generate tasks for today
    const saved = _load();
    if (saved && saved.date === _todayStr() && Array.isArray(saved.tasks)) {
      _tasks      = saved.tasks;
      _taskStreak = saved.taskStreak || 0;
    } else {
      // New day — check if yesterday was all-done (streak continues)
      if (saved && saved.tasks && saved.tasks.every(t => t.done)) {
        // Check yesterday's date
        const yest = new Date(); yest.setDate(yest.getDate() - 1);
        const yestStr = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;
        if (saved.date === yestStr) {
          _taskStreak = (saved.taskStreak || 0) + 1;
        } else {
          _taskStreak = 0; // streak broken
        }
      } else {
        _taskStreak = saved ? (saved.taskStreak || 0) : 0;
      }
      _tasks = _generateTasks();
      _save();
    }

    // Render the quote
    const quoteEl = document.getElementById('tasks-quote-text');
    if (quoteEl) quoteEl.textContent = _randomQuote();

    // Render date
    const dateEl = document.getElementById('tasks-date-label');
    if (dateEl) {
      const d = new Date();
      dateEl.textContent = d.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
    }

    // Wire icon button
    const icon = document.getElementById('tasks-icon');
    if (icon) icon.addEventListener('click', _toggle);

    // Wire close button — stopPropagation prevents the document click-outside
    // handler from running on the same tick and fighting the close
    const closeBtn = document.getElementById('tasks-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); _close(); });

    // Wire refresh button
    const refreshBtn = document.getElementById('tasks-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      _tasks = _generateTasks();
      _save();
      _renderTasks();
      const quoteEl = document.getElementById('tasks-quote-text');
      if (quoteEl) quoteEl.textContent = _randomQuote();
    });

    // Wire hp-close-btn — stop propagation so the document click-outside handler
    // doesn't re-open or interfere; force icon back to visible with a small delay
    // so CSS transitions complete cleanly before pointer-events are restored.
    const hpClose = document.getElementById('hp-close-btn');
    if (hpClose) {
      hpClose.style.display = 'flex';
      hpClose.addEventListener('click', (e) => {
        e.stopPropagation();
        const hp     = document.getElementById('history-panel');
        const hpIcon = document.getElementById('hp-icon');
        if (hp)     hp.classList.remove('hp-panel-open');
        if (hpIcon) {
          hpIcon.classList.remove('hp-icon-hidden');
          // Belt-and-suspenders: re-apply flex display in case CSS was overridden
          hpIcon.style.removeProperty('display');
          hpIcon.style.removeProperty('opacity');
          hpIcon.style.removeProperty('pointer-events');
        }
      });
    }

    // Wire new hp-export-btn / hp-import-btn in the history panel header
    const hpExportBtn = document.getElementById('hp-export-btn');
    if (hpExportBtn) {
      hpExportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Delegate to existing export logic in settings (export-history-btn)
        const existing = document.getElementById('export-history-btn');
        if (existing) { existing.click(); return; }
        // Fallback: direct export
        if (typeof Session === 'undefined') return;
        const history = Session.getHistory ? Session.getHistory() : [];
        const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(),
          appVersion: 'DeskBuddy', sessionCount: history.length, sessions: history }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), {
          href: url, download: `deskbuddy-history-${Date.now()}.json` });
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      });
    }
    const hpImportBtn = document.getElementById('hp-import-btn');
    if (hpImportBtn) {
      hpImportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = document.getElementById('import-history-btn');
        if (existing) { existing.click(); return; }
      });
    }

    // Wire session panel close buttons — stopPropagation prevents the auto-hide
    // mouseleave timer from racing with the explicit close action
    ['sp-close-idle','sp-close-active','sp-close-paused'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = document.getElementById('session-panel');
        const icon  = document.getElementById('sp-icon');
        if (panel) panel.classList.remove('sidebar-open');
        if (icon) {
          icon.classList.remove('sp-icon-hidden');
          // Force visibility — clears any lingering inline style overrides
          icon.style.removeProperty('opacity');
          icon.style.removeProperty('pointer-events');
        }
      });
    });

    // Close tasks panel when clicking outside
    document.addEventListener('click', (e) => {
      if (!_isOpen) return;
      const panel = document.getElementById('tasks-panel');
      const icon  = document.getElementById('tasks-icon');
      if (!panel) return;
      if (panel.contains(e.target) || e.target === icon || icon?.contains(e.target)) return;
      _close();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _isOpen) _close();
    });

    // Wire preset buttons — add active class on click
    document.querySelectorAll('.sp-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sp-preset-btn').forEach(b => b.classList.remove('sp-preset-active'));
        btn.classList.add('sp-preset-active');
      });
    });

    // Wire mood buttons
    document.querySelectorAll('.sp-mood-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sp-mood-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Store mood for session (Session.setMoodRating exists)
        try {
          if (typeof Session !== 'undefined' && Session.setMoodRating) {
            Session.setMoodRating(parseInt(btn.dataset.mood));
          }
        } catch (_) {}
      });
    });

    // Render initial state
    _renderTasks();
    _renderStreak();
    _updateQuickStats();

    // Update quick stats whenever session panel opens
    document.getElementById('sp-icon')?.addEventListener('click', () => {
      setTimeout(_updateQuickStats, 100);
    });

    // Midnight reset check (every minute)
    setInterval(() => {
      const saved2 = _load();
      if (saved2 && saved2.date !== _todayStr()) {
        // New day — regenerate
        if (saved2.tasks.every(t => t.done)) {
          _taskStreak = (saved2.taskStreak || 0) + 1;
        } else {
          _taskStreak = 0;
        }
        _tasks = _generateTasks();
        _save();
        _renderTasks();
        const quoteEl = document.getElementById('tasks-quote-text');
        if (quoteEl) quoteEl.textContent = _randomQuote();
        _renderStreak();
      }
    }, 60_000);
  }

  // ── Quick stats (session panel idle) ─────────────────────────────────

  function _updateQuickStats() {
    try {
      const sessToday = document.getElementById('sp-qs-sessions');
      const streakEl  = document.getElementById('sp-qs-streak');
      const minEl     = document.getElementById('sp-qs-minutes');

      if (typeof Session !== 'undefined') {
        // Today's sessions
        const todayStr = _todayStr();
        const history  = Session.getHistory() || [];
        const todaySess = history.filter(s => {
          if (!s.startedAt) return false;
          const d = new Date(s.startedAt);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === todayStr;
        });

        if (sessToday) sessToday.textContent  = todaySess.length;
        if (streakEl)  streakEl.textContent   = (Session.computeDayStreak() || 0) + '🔥';
        if (minEl) {
          const totalMin = todaySess.reduce((a, s) => a + (s.actualFocusedMinutes || s.plannedMinutes || 0), 0);
          minEl.textContent = totalMin >= 60
            ? (totalMin / 60).toFixed(1) + 'h'
            : Math.round(totalMin) + 'm';
        }
      }
    } catch (_) {}
  }

  return { init };

})();

// Auto-init after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => DailyTasks.init(), 600));
} else {
  setTimeout(() => DailyTasks.init(), 600);
}
