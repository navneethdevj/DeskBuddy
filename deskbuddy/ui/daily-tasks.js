/**
 * DailyTasks v3 — Verified Daily Challenges
 *
 * Core philosophy:
 *   Tasks that can be verified automatically ARE verified automatically —
 *   they fire when the real action happens, not when you tick a checkbox.
 *   Tasks in the physical world (hydration, movement, mindset) are clearly
 *   labeled as "honor" tasks — you tick them yourself, honestly.
 *
 *   AUTO tasks cannot be manually ticked: they're locked until the action
 *   is genuinely performed and Session confirms it.
 *
 * Auto-verification pipeline:
 *   Session.onSessionStateChange → fires on COMPLETED/FAILED/ABANDONED
 *   On COMPLETED → _verifyAutoTasks(session) checks every pending auto-task
 *   against the real session data (focused minutes, focus%, streak, etc.)
 *
 * Live "session active" indicator:
 *   When a session starts, the tasks panel shows a tracking banner.
 *   When the session completes, any newly-verified tasks flash and lock.
 *
 * Refresh guard:
 *   One free refresh is allowed per day, before any auto-task has been
 *   verified. Once the first session completes, refreshing is locked
 *   (prevents gaming the task list after seeing results).
 *
 * Storage key: 'deskbuddy_daily_tasks_v3'
 *   (v3 to avoid conflicts with old format)
 *
 * Dependencies: Session, Timer (optional), Brain (optional)
 */
const DailyTasks = (() => {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────

  const STORAGE_KEY = 'deskbuddy_daily_tasks_v3';
  const TASK_COUNT  = 7;  // 4–5 auto + 2–3 honor per day

  // Task type enum
  const TYPE = {
    FOCUS_SESSION: 'focus_session',  // complete ≥ N focused minutes in a session
    FOCUS_SCORE:   'focus_score',    // achieve ≥ N% focus quality in a session
    SESSION_COUNT: 'session_count',  // complete N sessions today
    KEEP_STREAK:   'keep_streak',    // complete any session (starts/keeps streak)
    NO_DISTRACT:   'no_distract',    // complete a session with 0 distractions
    LONG_FOCUS:    'long_focus',     // sustain N consecutive focused minutes
    BREAK_TAKEN:   'break_taken',    // take ≥1 scheduled break during a session
    HONOR:         'honor',          // physical world — manually ticked
  };

  // Set of types that cannot be manually ticked (auto-verified only)
  const AUTO_TYPES = new Set([
    TYPE.FOCUS_SESSION, TYPE.FOCUS_SCORE, TYPE.SESSION_COUNT,
    TYPE.KEEP_STREAK, TYPE.NO_DISTRACT, TYPE.LONG_FOCUS, TYPE.BREAK_TAKEN,
  ]);

  // ── Private state ──────────────────────────────────────────────────────────

  let _tasks          = [];
  let _taskStreak     = 0;
  let _streakCounted  = false;   // FIX: was _taskStreak._counted (property on a number = no-op)
  let _refreshesLeft  = 1;       // locked to 0 once first auto-task is verified
  let _isOpen         = false;
  let _sessionActive  = false;
  let _lastSessionState = null;  // for transition detection

  // ── Quotes pool ────────────────────────────────────────────────────────────

  const _QUOTES = [
    'Small steps every day build the life you want.',
    'Discipline is choosing between what you want now and what you want most.',
    'One focused hour beats three distracted ones.',
    'You don\'t rise to the level of your goals. You fall to the level of your systems.',
    'Done is better than perfect — ship, then iterate.',
    'Consistency compounds. Show up every day.',
    'Progress, not perfection.',
    'The best time to start was yesterday. The second best time is now.',
    'Hard work beats talent when talent doesn\'t work hard.',
    'Energy follows attention. Choose carefully.',
    'Build the habit first, then optimize it.',
    'Rest is part of the work — not a reward for it.',
    'Your future self is watching. Make them proud.',
    'You\'re closer than you think.',
    'Every expert was once a beginner who kept going.',
    'Focus is not about saying yes. It\'s about saying no to almost everything.',
    'Depth over breadth. One thing done well beats three things done halfway.',
    'The session you almost skipped is often the most important one.',
  ];

  // ── Task pool builder ──────────────────────────────────────────────────────

  function _getTaskPool(history, streak, todayFocusedMinutes, dominantCat, avgFocusPct, hour) {
    const recentLengths = history.slice(0, 5).map(s => s.durationMinutes || 25);
    const avgLength     = recentLengths.length
      ? Math.round(recentLengths.reduce((a, b) => a + b, 0) / recentLengths.length)
      : 25;
    const todaySessions = _countTodaySessions(history);
    const isLowFocus    = avgFocusPct < 62;
    const isHighFocus   = avgFocusPct >= 82;
    const isMorning     = hour < 12;
    const isEvening     = hour >= 17;
    const isWeekend     = [0, 6].includes(new Date().getDay());

    // ── AUTO tasks (4–5 will be picked) ───────────────────────────────────
    const focusTarget  = Math.min(Math.max(avgLength, 20), 50);
    const scoreTarget  = isLowFocus ? 65 : isHighFocus ? 85 : 75;
    const countTarget  = Math.min(Math.max(todaySessions + 2, 2), 4);
    const longTarget   = Math.max(10, Math.min(Math.round(avgLength * 0.6), 25));

    const auto = [
      {
        id: 'a_focus',
        type: TYPE.FOCUS_SESSION,
        icon: '⏱',
        target: focusTarget,
        text: `Complete a ${focusTarget}-min focused session`,
        hint: `Session must end as COMPLETED with ≥${focusTarget} min of focus`,
      },
      {
        id: 'a_score',
        type: TYPE.FOCUS_SCORE,
        icon: '🎯',
        target: scoreTarget,
        text: `Achieve ${scoreTarget}% focus quality in one session`,
        hint: `DeskBuddy measures your real attention — no faking it`,
      },
      {
        id: 'a_count',
        type: TYPE.SESSION_COUNT,
        icon: '📈',
        target: countTarget,
        text: `Complete ${countTarget} sessions today`,
        hint: `${todaySessions}/${countTarget} done so far today`,
      },
      streak > 0
        ? {
            id: 'a_streak',
            type: TYPE.KEEP_STREAK,
            icon: '🔥',
            target: 1,
            text: `Keep your ${streak}-day streak — finish any session`,
            hint: 'Any completed session counts',
          }
        : {
            id: 'a_streak',
            type: TYPE.KEEP_STREAK,
            icon: '🌱',
            target: 1,
            text: 'Start a new focus streak — finish any session',
            hint: 'Complete any session to begin your streak',
          },
      {
        id: 'a_nodistract',
        type: TYPE.NO_DISTRACT,
        icon: '🧊',
        target: 0,
        text: 'Complete a session with zero distractions',
        hint: 'Stay focused — no phone, no looking away',
      },
      {
        id: 'a_longfocus',
        type: TYPE.LONG_FOCUS,
        icon: '⚡',
        target: longTarget,
        text: `Sustain ${longTarget} consecutive focused minutes`,
        hint: 'One unbroken focus streak — no drifting',
      },
      {
        id: 'a_break',
        type: TYPE.BREAK_TAKEN,
        icon: '☕',
        target: 1,
        text: 'Take a scheduled break during a session',
        hint: 'Use break reminders — rest is part of the work',
      },
    ];

    // ── HONOR tasks (2–3 will be picked) ──────────────────────────────────
    const honor = [
      {
        id: 'h_water',
        type: TYPE.HONOR,
        icon: '💧',
        text: 'Drink a full glass of water before your first session',
        hint: 'Hydration improves focus measurably',
      },
      {
        id: 'h_walk',
        type: TYPE.HONOR,
        icon: '🚶',
        text: 'Take a 5-min walk between sessions',
        hint: 'Physical movement clears mental fog',
      },
      {
        id: 'h_stretch',
        type: TYPE.HONOR,
        icon: '🧘',
        text: 'Do 10 desk stretches before your next session',
        hint: 'Neck, shoulders, wrists',
      },
      {
        id: 'h_202020',
        type: TYPE.HONOR,
        icon: '👁',
        text: 'Follow 20-20-20: every 20 min, look 20 ft away for 20 sec',
        hint: 'Prevents eye strain over long sessions',
      },
      {
        id: 'h_priorities',
        type: TYPE.HONOR,
        icon: '📝',
        text: isMorning
          ? 'Write down your 3 priorities before starting'
          : 'Review what you accomplished and plan tomorrow\'s top 3',
        hint: 'Clarity before focus is not optional',
      },
      {
        id: 'h_review',
        type: TYPE.HONOR,
        icon: '📖',
        text: `Review your ${dominantCat === 'study' ? 'notes from yesterday' : 'last session\'s work'} for 10 min`,
        hint: 'Spaced repetition compounds knowledge',
      },
      ...(isWeekend
        ? [{
            id: 'h_plan',
            type: TYPE.HONOR,
            icon: '🗓',
            text: 'Plan your goals for next week — 10 minutes now saves hours later',
            hint: 'Weekly planning is the highest-leverage habit',
          }]
        : []
      ),
      {
        id: 'h_sleep',
        type: TYPE.HONOR,
        icon: '🛏',
        text: 'Commit to a consistent sleep time tonight',
        hint: 'Sleep quality determines tomorrow\'s focus ceiling',
      },
      {
        id: 'h_eat',
        type: TYPE.HONOR,
        icon: '🍎',
        text: 'Eat a proper meal before your focus session',
        hint: 'Blood sugar affects concentration directly',
      },
    ];

    return { auto, honor };
  }

  // ── Task selection ─────────────────────────────────────────────────────────

  function _generateTasks() {
    let history = [], streak = 0, todayFocusedMinutes = 0, avgFocusPct = 72;
    let dominantCat = 'study';
    try {
      if (typeof Session !== 'undefined') {
        history              = Session.getHistory() || [];
        streak               = Session.computeDayStreak() || 0;
        todayFocusedMinutes  = Math.round(Session.getTotalFocusedMinutes() || 0);
        const recent7 = history.slice(0, 7).filter(s => typeof s.focusPct === 'number');
        if (recent7.length) {
          avgFocusPct = Math.round(recent7.reduce((a, s) => a + s.focusPct, 0) / recent7.length);
        }
        const cats = {};
        history.slice(0, 14).forEach(s => {
          if (s.category) cats[s.category] = (cats[s.category] || 0) + 1;
        });
        const entries = Object.entries(cats);
        if (entries.length) dominantCat = entries.sort((a, b) => b[1] - a[1])[0][0];
      }
    } catch (_) {}

    const { auto, honor } = _getTaskPool(
      history, streak, todayFocusedMinutes, dominantCat, avgFocusPct, new Date().getHours()
    );

    // Deterministic daily shuffle via today's date as seed
    const seed = parseInt(_todayStr().replace(/-/g, '')) % 997;
    const shuffleArr = (arr) => arr.slice().sort((a, b) => {
      const ha = ((a.id.charCodeAt(0) * 31 + seed) % 97);
      const hb = ((b.id.charCodeAt(0) * 31 + seed) % 97);
      return ha - hb;
    });

    // Pick 4–5 auto tasks + 2–3 honor tasks (total TASK_COUNT)
    const autoCount  = Math.min(5, Math.max(4, TASK_COUNT - 2));
    const honorCount = TASK_COUNT - autoCount;

    const pickedAuto  = shuffleArr(auto).slice(0, autoCount);
    const pickedHonor = shuffleArr(honor).slice(0, honorCount);

    return [...pickedAuto, ...pickedHonor].map(t => ({
      ...t,
      done:         false,
      autoVerified: false,
      verifiedAt:   null,
    }));
  }

  // ── Auto-verification ──────────────────────────────────────────────────────

  /**
   * Called whenever a session reaches COMPLETED.
   * Checks each pending auto task against real session data and
   * marks verified tasks as done (locked — cannot be unticked).
   */
  function _verifyAutoTasks(session) {
    if (!session || session.outcome !== 'COMPLETED') return;

    const focusedMinutes  = (session.actualFocusedSeconds   || 0) / 60;
    const durationMinutes = (session.durationMinutes         || 0);
    const focusPct        = durationMinutes > 0
      ? Math.round((session.actualFocusedSeconds / (durationMinutes * 60)) * 100)
      : 0;
    const longestMinutes  = (session.longestFocusStreakSeconds || 0) / 60;
    const distractions    = session.distractionCount          || 0;
    const breaks          = (session.breaks || []).filter(b =>
      b.durationSecs != null && b.durationSecs >= 30
    ).length;

    // Today's total completed sessions (history[0] is the just-committed one)
    const history      = (typeof Session !== 'undefined' && Session.getHistory) ? Session.getHistory() : [];
    const todaySessions = _countTodaySessions(history);

    let changed = false;
    for (const task of _tasks) {
      if (task.done || !AUTO_TYPES.has(task.type)) continue;

      let verified = false;
      switch (task.type) {
        case TYPE.FOCUS_SESSION: verified = focusedMinutes  >= task.target; break;
        case TYPE.FOCUS_SCORE:   verified = focusPct        >= task.target; break;
        case TYPE.SESSION_COUNT: verified = todaySessions   >= task.target; break;
        case TYPE.KEEP_STREAK:   verified = true;                           break;
        case TYPE.NO_DISTRACT:   verified = distractions    === 0;          break;
        case TYPE.LONG_FOCUS:    verified = longestMinutes  >= task.target; break;
        case TYPE.BREAK_TAKEN:   verified = breaks          >= 1;           break;
      }

      if (verified) {
        task.done         = true;
        task.autoVerified = true;
        task.verifiedAt   = Date.now();
        changed           = true;
      }
    }

    if (changed) {
      // Lock refresh once any auto-task is verified (prevent gaming)
      _refreshesLeft = 0;
      _checkAllDone();
      _save();
      _renderTasks();
      _updateBadge();
    }
  }

  // ── Session state monitoring ───────────────────────────────────────────────

  function _startSessionMonitor() {
    // Hook into Session.onSessionStateChange (cleaner than polling)
    if (typeof Session !== 'undefined' && Session.onSessionStateChange) {
      Session.onSessionStateChange(_onSessionStateChange);
    } else {
      // Fallback: poll every 600ms until Session is available, then hook
      const _tryHook = () => {
        if (typeof Session !== 'undefined' && Session.onSessionStateChange) {
          Session.onSessionStateChange(_onSessionStateChange);
        } else {
          setTimeout(_tryHook, 600);
        }
      };
      setTimeout(_tryHook, 800);
    }
  }

  function _onSessionStateChange(newState) {
    const SESSION = typeof Session !== 'undefined' ? Session.STATE : {};
    const wasActive = _sessionActive;

    if (newState === SESSION.ACTIVE) {
      _sessionActive = true;
      if (!wasActive) {
        _renderSessionBanner(true);
        // Live progress: update count-based tasks immediately
        _renderTasks();
      }
    } else if (newState === SESSION.COMPLETED) {
      _sessionActive = false;
      _renderSessionBanner(false);
      // Grab the just-committed session (history[0])
      try {
        const history = Session.getHistory ? Session.getHistory() : [];
        if (history.length > 0) _verifyAutoTasks(history[0]);
      } catch (_) {}
    } else if (newState === SESSION.IDLE || newState === SESSION.FAILED || newState === SESSION.ABANDONED) {
      _sessionActive = false;
      _renderSessionBanner(false);
      // On FAILED/ABANDONED: update session_count tasks in case they completed
      if (newState !== SESSION.IDLE) {
        try {
          const history = Session.getHistory ? Session.getHistory() : [];
          if (history.length > 0 && history[0].outcome === 'COMPLETED') {
            _verifyAutoTasks(history[0]);
          }
        } catch (_) {}
      }
      _renderTasks();
    }
  }

  function _renderSessionBanner(active) {
    const banner = document.getElementById('tasks-session-banner');
    if (!banner) return;
    if (active) {
      banner.style.display = '';
      banner.classList.add('visible');
    } else {
      banner.classList.remove('visible');
      setTimeout(() => { if (!_sessionActive) banner.style.display = 'none'; }, 400);
    }
  }

  // ── Date helpers ───────────────────────────────────────────────────────────

  function _todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function _countTodaySessions(history) {
    const today = _todayStr();
    return (history || []).filter(s => {
      if (!s.startedAt && !s.date) return false;
      const ts = s.startedAt || s.date;
      try {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === today;
      } catch (_) { return false; }
    }).length;
  }

  // ── Storage ────────────────────────────────────────────────────────────────

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
        date:          _todayStr(),
        tasks:         _tasks,
        taskStreak:    _taskStreak,
        streakCounted: _streakCounted,
        refreshesLeft: _refreshesLeft,
      }));
    } catch (_) {}
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  function _doneCount()  { return _tasks.filter(t => t.done).length; }
  function _allDone()    { return _tasks.length > 0 && _doneCount() === _tasks.length; }
  function _randomQuote() { return _QUOTES[new Date().getDate() % _QUOTES.length]; }

  function _checkAllDone() {
    if (_allDone() && !_streakCounted) {
      _taskStreak++;
      _streakCounted = true;
      _save();
      _renderStreak();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function _renderTasks() {
    const list = document.getElementById('tasks-list');
    if (!list) return;
    list.innerHTML = '';

    // Get live session data for progress hints
    const sessionActive = _sessionActive;
    const todayHistory  = (typeof Session !== 'undefined' && Session.getHistory)
      ? Session.getHistory()
      : [];
    const todaySessions = _countTodaySessions(todayHistory);

    _tasks.forEach(task => {
      const isAuto   = AUTO_TYPES.has(task.type);
      const isHonor  = task.type === TYPE.HONOR;
      const isDone   = task.done;
      const isLocked = isDone && task.autoVerified;

      const item = document.createElement('div');
      item.className = [
        'task-item',
        isDone ? 'done' : '',
        isLocked ? 'auto-verified' : '',
        isHonor ? 'honor-task' : 'auto-task',
      ].filter(Boolean).join(' ');
      item.dataset.id   = task.id;
      item.dataset.type = task.type;

      // Check button / lock
      const checkEl = document.createElement('div');
      checkEl.className = 'task-check';
      if (isDone) {
        checkEl.innerHTML = isLocked ? '✓' : '✓';
        checkEl.title     = isLocked ? 'Auto-verified — DeskBuddy confirmed this' : 'Completed';
      } else if (isAuto) {
        checkEl.innerHTML = '○';
        checkEl.title     = 'Auto-verified when you complete the action';
      }
      item.appendChild(checkEl);

      // Content wrapper
      const content = document.createElement('div');
      content.className = 'task-content';

      // Main row: icon + text + badge
      const mainRow = document.createElement('div');
      mainRow.className = 'task-main-row';

      const iconEl = document.createElement('span');
      iconEl.className   = 'task-icon';
      iconEl.textContent = task.icon;
      mainRow.appendChild(iconEl);

      const textEl = document.createElement('span');
      textEl.className   = 'task-text';
      textEl.textContent = task.text;
      mainRow.appendChild(textEl);

      // Type badge
      const badge = document.createElement('span');
      if (isHonor) {
        badge.className   = 'task-type-badge task-badge-honor';
        badge.textContent = '🤝';
        badge.title       = 'Honor task — tick this yourself, honestly';
      } else if (isDone && isLocked) {
        badge.className   = 'task-type-badge task-badge-verified';
        badge.textContent = 'verified';
        badge.title       = 'DeskBuddy auto-verified this from your session data';
      } else {
        badge.className   = 'task-type-badge task-badge-auto';
        badge.textContent = 'auto';
        badge.title       = 'Verified automatically from your real session performance';
      }
      mainRow.appendChild(badge);
      content.appendChild(mainRow);

      // Progress hint row (auto tasks only, not yet done)
      if (isAuto && !isDone) {
        const progressRow = document.createElement('div');
        progressRow.className = 'task-progress-row';

        let progressText = '';
        let progressPct  = 0;

        switch (task.type) {
          case TYPE.SESSION_COUNT: {
            progressText = `${todaySessions} / ${task.target} sessions today`;
            progressPct  = Math.min(100, Math.round((todaySessions / task.target) * 100));
            break;
          }
          case TYPE.KEEP_STREAK: {
            const streak = (typeof Session !== 'undefined' && Session.computeDayStreak)
              ? Session.computeDayStreak() : 0;
            progressText = streak > 0 ? `🔥 ${streak}-day streak — complete to extend` : 'complete any session';
            progressPct  = todaySessions > 0 ? 100 : 0;
            break;
          }
          default: {
            progressText = sessionActive ? '⏳ session in progress — being tracked' : 'complete a session to verify';
            progressPct  = sessionActive ? -1 : 0;  // -1 = indeterminate
          }
        }

        if (sessionActive && task.type === TYPE.SESSION_COUNT) {
          progressText = `${todaySessions}/${task.target} sessions — tracking…`;
        }

        if (progressPct === -1) {
          // Indeterminate: animated pulse bar
          progressRow.innerHTML = `
            <div class="task-progress-bar indeterminate">
              <div class="task-progress-fill tpf-pulse"></div>
            </div>
            <span class="task-progress-label">${escapeHtml ? escapeHtml(progressText) : progressText}</span>
          `;
        } else if (progressPct > 0 || task.type === TYPE.SESSION_COUNT) {
          progressRow.innerHTML = `
            <div class="task-progress-bar">
              <div class="task-progress-fill" style="width:${progressPct}%"></div>
            </div>
            <span class="task-progress-label">${escapeHtml ? escapeHtml(progressText) : progressText}</span>
          `;
        } else {
          progressRow.innerHTML = `
            <span class="task-progress-label passive">${escapeHtml ? escapeHtml(progressText) : progressText}</span>
          `;
        }

        content.appendChild(progressRow);
      }

      item.appendChild(content);

      // Click handler — only HONOR tasks are manually toggleable
      if (isHonor && !isLocked) {
        item.addEventListener('click', () => _toggleTask(task.id));
        item.style.cursor = 'pointer';
      } else if (isAuto && !isDone) {
        item.title = task.hint || 'Complete the action — DeskBuddy will verify automatically';
      }

      // Flash animation for newly-verified tasks
      if (isDone && task.verifiedAt && (Date.now() - task.verifiedAt) < 3000) {
        item.classList.add('just-verified');
        setTimeout(() => item.classList.remove('just-verified'), 800);
      }

      list.appendChild(item);
    });

    _renderProgress();
    _renderAllDoneState();
    _updateBadge();
    _renderRefreshBtn();
  }

  function _renderProgress() {
    const fill  = document.getElementById('tasks-progress-fill');
    const label = document.getElementById('tasks-progress-label');
    if (!fill || !label) return;
    const pct = _tasks.length ? Math.round((_doneCount() / _tasks.length) * 100) : 0;
    fill.style.width  = pct + '%';
    label.textContent = `${_doneCount()} / ${_tasks.length} done`;
  }

  function _renderAllDoneState() {
    const allDoneEl = document.getElementById('tasks-all-done');
    const listEl    = document.getElementById('tasks-list');
    if (!allDoneEl || !listEl) return;
    if (_allDone()) {
      allDoneEl.classList.add('visible');
      listEl.style.opacity = '0.35';
    } else {
      allDoneEl.classList.remove('visible');
      listEl.style.opacity = '';
    }
  }

  function _renderRefreshBtn() {
    const btn = document.getElementById('tasks-refresh-btn');
    if (!btn) return;
    if (_refreshesLeft > 0) {
      btn.disabled = false;
      btn.textContent = '↻ refresh (1 left)';
      btn.title = 'Regenerate tasks — only available before your first session';
      btn.style.opacity = '';
    } else {
      btn.disabled = true;
      btn.textContent = '↻ locked';
      btn.title = 'Refresh locked once a session is completed — prevents gaming';
      btn.style.opacity = '0.35';
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

  function _renderStreak() {
    const el = document.getElementById('tasks-streak-val');
    if (el) el.textContent = _taskStreak + ' day' + (_taskStreak !== 1 ? 's' : '');
  }

  // ── Toggle (HONOR tasks only) ──────────────────────────────────────────────

  function _toggleTask(id) {
    const task = _tasks.find(t => t.id === id);
    if (!task || task.autoVerified) return;  // never untick auto-verified
    if (AUTO_TYPES.has(task.type)) return;   // double safety: never touch auto types

    task.done = !task.done;
    if (task.done) {
      task.verifiedAt = Date.now();
    } else {
      task.verifiedAt = null;
    }

    // Animate
    const item = document.querySelector(`.task-item[data-id="${id}"]`);
    if (item) {
      item.classList.add('just-done');
      setTimeout(() => item.classList.remove('just-done'), 400);
    }

    _checkAllDone();
    _save();
    _renderTasks();
    _renderStreak();
  }

  // ── Panel open/close ───────────────────────────────────────────────────────

  function _open() {
    const panel = document.getElementById('tasks-panel');
    const icon  = document.getElementById('tasks-icon');
    if (!panel) return;
    panel.classList.add('tasks-panel-open');
    if (icon) icon.classList.add('tasks-icon-hidden');
    _isOpen = true;
    // Close history panel if open
    const hp = document.getElementById('history-panel');
    if (hp?.classList.contains('hp-panel-open')) {
      hp.classList.remove('hp-panel-open');
      document.getElementById('hp-icon')?.classList.remove('hp-icon-hidden');
    }
    // Refresh live progress when opening
    _renderTasks();
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
    }
    _isOpen = false;
  }

  function _toggle() { _isOpen ? _close() : _open(); }

  // ── Quick stats update ─────────────────────────────────────────────────────

  function _updateQuickStats() {
    try {
      if (typeof Session === 'undefined') return;
      const todayStr  = _todayStr();
      const history   = Session.getHistory() || [];
      const todaySess = history.filter(s => {
        const ts = s.startedAt || s.date;
        if (!ts) return false;
        try {
          const d = new Date(ts);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === todayStr;
        } catch (_) { return false; }
      });

      const sessEl  = document.getElementById('sp-qs-sessions');
      const streakEl = document.getElementById('sp-qs-streak');
      const minEl   = document.getElementById('sp-qs-minutes');

      if (sessEl)  sessEl.textContent  = todaySess.length;
      if (streakEl) streakEl.textContent = (Session.computeDayStreak() || 0) + '🔥';
      if (minEl) {
        const totalMin = todaySess.reduce((a, s) => a + (s.actualFocusedSeconds || 0), 0) / 60;
        minEl.textContent = totalMin >= 60
          ? (totalMin / 60).toFixed(1) + 'h'
          : Math.round(totalMin) + 'm';
      }
    } catch (_) {}
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    const saved = _load();
    if (saved && saved.date === _todayStr() && Array.isArray(saved.tasks) && saved.tasks.length > 0) {
      // Restore today's tasks
      _tasks          = saved.tasks;
      _taskStreak     = saved.taskStreak    || 0;
      _streakCounted  = saved.streakCounted || false;
      _refreshesLeft  = typeof saved.refreshesLeft === 'number' ? saved.refreshesLeft : 1;
    } else {
      // New day: check if yesterday was all-done (streak continuation)
      if (saved?.tasks?.every(t => t.done)) {
        const yest = new Date(); yest.setDate(yest.getDate() - 1);
        const yestStr = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;
        _taskStreak = saved.date === yestStr
          ? (saved.taskStreak || 0) + 1
          : 0;  // streak broken — missed a day
      } else {
        _taskStreak = saved ? (saved.taskStreak || 0) : 0;
      }
      _streakCounted = false;
      _refreshesLeft = 1;
      _tasks = _generateTasks();
      _save();
    }

    // Render quote
    const quoteEl = document.getElementById('tasks-quote-text');
    if (quoteEl) quoteEl.textContent = _randomQuote();

    // Render date
    const dateEl = document.getElementById('tasks-date-label');
    if (dateEl) {
      const d = new Date();
      dateEl.textContent = d.toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric',
      });
    }

    // Wire panel icon
    document.getElementById('tasks-icon')?.addEventListener('click', _toggle);

    // Wire close button
    document.getElementById('tasks-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation(); _close();
    });

    // Wire refresh button
    document.getElementById('tasks-refresh-btn')?.addEventListener('click', () => {
      if (_refreshesLeft <= 0) return;
      _refreshesLeft = 0;
      _tasks = _generateTasks();
      _streakCounted = false;
      _save();
      _renderTasks();
      _renderStreak();
      const qe = document.getElementById('tasks-quote-text');
      if (qe) qe.textContent = _randomQuote();
    });

    // Wire hp-close-btn
    const hpClose = document.getElementById('hp-close-btn');
    if (hpClose) {
      hpClose.style.display = 'flex';
      hpClose.addEventListener('click', (e) => {
        e.stopPropagation();
        const hp     = document.getElementById('history-panel');
        const hpIcon = document.getElementById('hp-icon');
        hp?.classList.remove('hp-panel-open');
        if (hpIcon) {
          hpIcon.classList.remove('hp-icon-hidden');
          hpIcon.style.removeProperty('display');
          hpIcon.style.removeProperty('opacity');
          hpIcon.style.removeProperty('pointer-events');
        }
      });
    }

    // Wire export/import buttons
    const hpExportBtn = document.getElementById('hp-export-btn');
    if (hpExportBtn) {
      hpExportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = document.getElementById('export-history-btn');
        if (existing) { existing.click(); return; }
        if (typeof Session === 'undefined') return;
        const history = Session.getHistory ? Session.getHistory() : [];
        const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(),
          sessionCount: history.length, sessions: history }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), {
          href: url, download: `deskbuddy-history-${Date.now()}.json`,
        });
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      });
    }

    document.getElementById('hp-import-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('import-history-btn')?.click();
    });

    // Wire session panel close buttons
    ['sp-close-idle', 'sp-close-active', 'sp-close-paused'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = document.getElementById('session-panel');
        const icon  = document.getElementById('sp-icon');
        panel?.classList.remove('sidebar-open');
        if (icon) {
          icon.classList.remove('sp-icon-hidden');
          icon.style.removeProperty('opacity');
          icon.style.removeProperty('pointer-events');
        }
      });
    });

    // Wire preset buttons
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
        try {
          if (typeof Session !== 'undefined' && Session.setMoodRating) {
            Session.setMoodRating(parseInt(btn.dataset.mood));
          }
        } catch (_) {}
      });
    });

    // Click-outside to close
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

    // sp-icon click updates quick stats
    document.getElementById('sp-icon')?.addEventListener('click', () => {
      setTimeout(_updateQuickStats, 100);
    });

    // Start session monitor
    _startSessionMonitor();

    // Initial render
    _renderTasks();
    _renderStreak();
    _updateQuickStats();

    // Midnight reset (check every minute)
    setInterval(() => {
      const saved2 = _load();
      if (saved2 && saved2.date !== _todayStr()) {
        // Day rolled over
        _taskStreak    = saved2.tasks?.every(t => t.done)
          ? (saved2.taskStreak || 0) + 1
          : 0;
        _streakCounted = false;
        _refreshesLeft = 1;
        _tasks         = _generateTasks();
        _save();
        _renderTasks();
        _renderStreak();
        const qe = document.getElementById('tasks-quote-text');
        if (qe) qe.textContent = _randomQuote();
      }
    }, 60_000);
  }

  return { init };
})();

// Auto-init after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => DailyTasks.init(), 800));
} else {
  setTimeout(() => DailyTasks.init(), 800);
}
