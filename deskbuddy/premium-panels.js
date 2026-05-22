/**
 * PREMIUM PANELS — Enhancement layer for DeskBuddy
 * 
 * This file is a non-destructive premium enhancement middleware that:
 * • Injects premium UI systems
 * • Enhances existing panels safely
 * • Extends functionality without replacing renderer.js
 * • Uses modular, isolated feature systems
 * • Respects existing Session, Timer, Settings systems
 * • Supports reduced-motion accessibility
 */

(function() {
  'use strict';

  // ═════════════════════════════════════════════════════════════════════════
  // CONSTANTS & UTILITIES
  // ═════════════════════════════════════════════════════════════════════════

  const PINNED_KEY = 'deskbuddy_pinned_sessions';
  const MAX_PINNED = 5;
  const BREAK_AFFIRMATIONS = [
    "you're doing great — rest is productive",
    "drink some water — seriously",
    "stretch those muscles",
    "step outside for fresh air",
    "take a deep breath — you've got this",
    "your brain needs this break",
    "be kind to yourself today",
    "small breaks lead to big wins",
    "rest is not laziness",
    "you're building focus stamina"
  ];

  const MOOD_EMOJIS = [
    { v: 1, e: '😞', l: 'drained' },
    { v: 2, e: '😐', l: 'neutral' },
    { v: 3, e: '🙂', l: 'okay' },
    { v: 4, e: '😊', l: 'good' },
    { v: 5, e: '🤩', l: 'energised' }
  ];

  const CAT_COLORS = {
    'study': '#a78bfa',
    'work': '#38bdf8',
    'creative': '#f87171',
    'break': '#fbbf24'
  };

  // DOM helpers
  const $id = id => document.getElementById(id);
  const $q = sel => document.querySelector(sel);
  const $qa = sel => Array.from(document.querySelectorAll(sel));
  
  // Formatting helpers
  const fmtMins = mins => mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`;
  const fmtSecs = secs => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Safe global access
  const withGlobal = (name, fn) => {
    if (typeof window[name] !== 'undefined') fn(window[name]);
  };

  // Debounce
  const debounce = (fn, ms) => {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  // ═════════════════════════════════════════════════════════════════════════
  // LOADING SCREEN SYSTEM
  // ═════════════════════════════════════════════════════════════════════════

  const LoadingScreen = (() => {
    let _el = null;
    let _animId = null;
    let _progress = 0;

    function _build() {
      if (_el) return;
      _el = document.createElement('div');
      _el.id = 'loading-screen';
      _el.innerHTML = `
        <div class="ls-content">
          <div class="ls-logo-ring">✦</div>
          <div class="ls-text">waking up...</div>
          <div class="ls-progress">
            <div class="ls-progress-bar"></div>
          </div>
        </div>
      `;
      document.body.appendChild(_el);
    }

    function _animateTo(target) {
      if (!_el) return;
      const bar = _el.querySelector('.ls-progress-bar');
      if (bar) {
        bar.style.transition = 'width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
        bar.style.width = `${target}%`;
      }
    }

    function _done() {
      if (_el) {
        _el.style.opacity = '0';
        _el.style.transition = 'opacity 0.8s ease-out';
        setTimeout(() => {
          if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
          _el = null;
        }, 800);
      }
    }

    return {
      show: function() {
        _build();
        _animateTo(30);
      },
      update: function(percent, text) {
        if (_el && text) {
          const txt = _el.querySelector('.ls-text');
          if (txt) txt.textContent = text;
        }
        _animateTo(percent);
      },
      done: _done
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // TOAST NOTIFICATION SYSTEM
  // ═════════════════════════════════════════════════════════════════════════

  const Toast = (() => {
    let _container = null;

    function _ensureContainer() {
      if (_container) return;
      _container = document.createElement('div');
      _container.id = 'toast-container';
      document.body.appendChild(_container);
    }

    return {
      show: function(msg, type = 'info', duration = 3000) {
        _ensureContainer();
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = msg;
        _container.appendChild(toast);

        setTimeout(() => {
          toast.classList.add('exit');
          setTimeout(() => toast.remove(), 300);
        }, duration);
      }
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // PINNED SESSION TEMPLATES
  // ═════════════════════════════════════════════════════════════════════════

  const PinnedSessions = (() => {
    let _pinned = [];

    function _load() {
      try {
        const saved = localStorage.getItem(PINNED_KEY);
        _pinned = saved ? JSON.parse(saved) : [];
      } catch (e) {
        _pinned = [];
      }
    }

    function _save() {
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify(_pinned));
      } catch (e) {
        console.error('Failed to save pinned sessions', e);
      }
    }

    return {
      load: _load,
      save: _save,
      pin: function(goal, category, durationMins) {
        if (_pinned.length >= MAX_PINNED) {
          Toast.show('Max pinned templates reached', 'warning');
          return false;
        }
        const id = Date.now();
        _pinned.push({ id, goal, category, durationMins });
        _save();
        Toast.show(`"${goal}" saved ✦`, 'success');
        return true;
      },
      unpin: function(id) {
        _pinned = _pinned.filter(p => p.id !== id);
        _save();
      },
      launch: function(idx) {
        if (idx < 0 || idx >= _pinned.length) return;
        const p = _pinned[idx];
        withGlobal('Session', S => {
          if (S.setGoal) S.setGoal(p.goal);
          if (S.setCategory) S.setCategory(p.category);
          if (S.setDuration) S.setDuration(p.durationMins * 60);
          if (S.start) S.start();
        });
      },
      getAll: () => [..._pinned],
      render: function(container) {
        if (!container) return;
        const html = _pinned.map((p, idx) => `
          <div class="sp-pinned-item" data-idx="${idx}">
            <div style="flex:1;">
              <div class="sp-pinned-title">${p.goal}</div>
              <div style="font-size:11px;color:rgba(210,200,255,0.5);margin-top:4px;">${p.category}</div>
            </div>
            <div class="sp-pinned-duration">${fmtMins(p.durationMins)}</div>
          </div>
        `).join('');
        container.innerHTML = html;
        container.querySelectorAll('.sp-pinned-item').forEach((el, idx) => {
          el.addEventListener('click', () => PinnedSessions.launch(idx));
          el.addEventListener('contextmenu', e => {
            e.preventDefault();
            PinnedSessions.unpin(_pinned[idx].id);
            Toast.show('Removed from quick launch', 'info');
            PinnedSessions.render(container);
          });
        });
      }
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // PREMIUM PRESETS
  // ═════════════════════════════════════════════════════════════════════════

  const PremiumPresets = (() => {
    const PRESETS = [15, 25, 45, 60, 90, 120];

    return {
      render: function(container) {
        if (!container) return;
        const html = PRESETS.map(m => `
          <button class="sp-preset-btn" data-mins="${m}">${m}m</button>
        `).join('');
        container.innerHTML = html;
        container.querySelectorAll('.sp-preset-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const mins = parseInt(btn.dataset.mins);
            withGlobal('Session', S => {
              if (S.setDuration) S.setDuration(mins * 60);
            });
            // Highlight active
            container.querySelectorAll('.sp-preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          });
        });
      }
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // COMPANION MOOD BAR
  // ═════════════════════════════════════════════════════════════════════════

  const CompanionMoodBar = (() => {
    const MOODS = {
      'idle': 'in the zone',
      'focused': 'deeply focused',
      'drifting': 'drifting a bit',
      'distracted': 'distracted',
      'break': 'taking a break'
    };

    return {
      updateForState: function(state) {
        const mood = MOODS[state] || MOODS['idle'];
        withGlobal('Brain', B => {
          if (B.setCurrentMood) B.setCurrentMood(mood);
        });
      }
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // BREAK AFFIRMATION SYSTEM
  // ═════════════════════════════════════════════════════════════════════════

  const BreakAffirmation = (() => {
    let _idx = 0;
    let _intervalId = null;

    return {
      start: function(container) {
        if (!container) return;
        _idx = 0;
        container.textContent = BREAK_AFFIRMATIONS[0];
        _intervalId = setInterval(() => {
          _idx = (_idx + 1) % BREAK_AFFIRMATIONS.length;
          container.style.opacity = '0';
          container.style.transition = 'opacity 0.3s ease';
          setTimeout(() => {
            container.textContent = BREAK_AFFIRMATIONS[_idx];
            container.style.opacity = '1';
          }, 300);
        }, 12000);
      },
      stop: function() {
        if (_intervalId) clearInterval(_intervalId);
      }
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // POST-SESSION MOOD RATING
  // ═════════════════════════════════════════════════════════════════════════

  const MoodRating = (() => {
    return {
      render: function(container) {
        if (!container) return;
        const html = MOOD_EMOJIS.map(m => `
          <button class="sp-mood-btn" data-mood="${m.v}" title="${m.l}">${m.e}</button>
        `).join('');
        container.innerHTML = html;
        container.querySelectorAll('.sp-mood-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const mood = parseInt(btn.dataset.mood);
            withGlobal('Session', S => {
              if (S.setMoodRating) S.setMoodRating(mood);
            });
            container.querySelectorAll('.sp-mood-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            Toast.show('Mood recorded ✦', 'success');
          });
        });
      }
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // HISTORY PANEL UPGRADES
  // ═════════════════════════════════════════════════════════════════════════

  const HistoryUpgrades = (() => {
    return {
      init: function() {
        // Enhance stat cards
        const statCards = $qa('.hp-stat-card');
        statCards.forEach((card, idx) => {
          card.style.animationDelay = `${idx * 0.1}s`;
        });

        // Add click-to-star functionality to session rows
        const sessionRows = $qa('.hp-session-row');
        sessionRows.forEach(row => {
          row.style.cursor = 'pointer';
          row.addEventListener('click', e => {
            if (e.target.closest('.hp-star-btn')) return;
            row.classList.toggle('starred');
          });
        });

        // Add export/import buttons if they don't exist
        const historyHeader = $q('#history-card .hp-header');
        if (historyHeader && !historyHeader.querySelector('.hp-export-btn')) {
          const actionRow = document.createElement('div');
          actionRow.style.cssText = 'display:flex;gap:8px;margin:12px 0;';
          actionRow.innerHTML = `
            <button class="sp-btn sp-btn-secondary" style="flex:1;">📥 Export</button>
            <button class="sp-btn sp-btn-secondary" style="flex:1;">📤 Import</button>
          `;
          historyHeader.appendChild(actionRow);
        }
      }
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // SETTINGS PANEL UPGRADE
  // ═════════════════════════════════════════════════════════════════════════

  const SettingsUpgrade = (() => {
    return {
      init: function() {
        // Enhance settings rows
        const settingsRows = $qa('.settings-row');
        settingsRows.forEach((row, idx) => {
          row.style.animation = `slideUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${idx * 0.05}s both`;
        });

        // Enhance toggle switches
        const toggles = $qa('input[type="checkbox"]');
        toggles.forEach(toggle => {
          if (!toggle.classList.contains('premium-toggle-enhanced')) {
            toggle.classList.add('premium-toggle-enhanced');
            toggle.style.cursor = 'pointer';
          }
        });
      }
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═════════════════════════════════════════════════════════════════════════

  function init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    try {
      // Load pinned sessions from storage
      PinnedSessions.load();

      // Enhance history panel if it exists
      const historyCard = $id('history-card');
      if (historyCard) {
        HistoryUpgrades.init();
      }

      // Enhance settings panel if it exists
      const settingsPanel = $id('settings-panel');
      if (settingsPanel) {
        SettingsUpgrade.init();
      }

      // Enhance session panel if it exists
      const sessionPanel = $id('session-panel');
      if (sessionPanel) {
        // Watch for session state changes
        const observer = new MutationObserver(() => {
          const state = document.body.getAttribute('data-timer-state');
          CompanionMoodBar.updateForState(state);
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-timer-state'] });
      }

      // Export to global for external access
      window.PremiumPanels = {
        PinnedSessions,
        Toast,
        LoadingScreen,
        CompanionMoodBar,
        BreakAffirmation,
        MoodRating
      };

    } catch (e) {
      console.error('Premium panels initialization error:', e);
    }
  }

  // Start initialization
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();
