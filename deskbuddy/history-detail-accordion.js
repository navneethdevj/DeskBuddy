/**
 * history-detail-accordion.js — Bouncy Detail Accordion for History Panel
 *
 * Converts the bottom "detail" sections of the history panel into a smooth
 * spring accordion. The stats cards + chart remain outside, controlled by pills.
 *
 * Accordion sections:
 *   1. 🔥 Streaks & Calendar  — hp-streak-section
 *   2. 📊 Performance Radar   — hp-radar-section
 *   3. 📋 Session Log         — hp-section (recent sessions)
 *
 * Self-contained. No framework. Inspired by Skiper103 glassmorphism icons
 * + Nike full-screen overlay spring easing.
 */
(function HistoryDetailAccordion() {
  'use strict';

  /* ── Spring easing (framer-motion approximation) ─────────────────────── */
  const SPRING_IN   = 'cubic-bezier(0.34, 1.38, 0.64, 1)';  // overshoot settle
  const SPRING_OUT  = 'cubic-bezier(0.16, 1.00, 0.30, 1)';  // Nike-style fast
  const DUR_EXPAND  = 360;  // ms
  const DUR_COLLAPSE = 220; // ms

  /* ── Section definitions ─────────────────────────────────────────────── */
  const SECTIONS = [
    {
      id:          'streaks',
      label:       'Streaks & Calendar',
      icon:        '🔥',
      selector:    '.hp-streak-section',
      openDefault: true,
      metaFn:      (el) => {
        const streakEl = el.querySelector('#hsr-current-streak');
        return streakEl ? (streakEl.textContent.trim() + ' day streak') : '';
      },
    },
    {
      id:          'radar',
      label:       'Performance Radar',
      icon:        '📊',
      selector:    '#hp-radar-section',
      openDefault: false,
      metaFn:      () => '',
    },
    {
      id:          'sessions',
      label:       'Session Log',
      icon:        '📋',
      selector:    '.hp-section:not(.hp-streak-section)',
      openDefault: true,
      metaFn:      (el) => {
        const rows = el.querySelectorAll('.hp-recent-row');
        return rows.length ? rows.length + ' sessions' : '';
      },
    },
  ];

  /* ── State ───────────────────────────────────────────────────────────── */
  let _items       = [];
  let _initialized = false;

  /* ── Build accordion wrapper ─────────────────────────────────────────── */
  function _build(historyCard) {
    // Create the wrapper
    const acc = document.createElement('div');
    acc.className   = 'hp-detail-accordion';
    acc.setAttribute('role', 'list');

    // Anchor: insert before close of history-card
    // We need a good place — after all hp-view panels but inside history-card
    // The streak-section and other sections are at the bottom of history-card.
    // We'll collect those sections and move them into the accordion.

    let insertBefore = null;

    SECTIONS.forEach(section => {
      const sectionEl = historyCard.querySelector(section.selector);
      if (!sectionEl) return;

      // Remember where to insert accordion (before first matched section)
      if (!insertBefore) {
        insertBefore = sectionEl;
      }

      // Build item
      const item = document.createElement('div');
      item.className  = 'hp-da-item';
      item.dataset.id = section.id;
      item.setAttribute('role', 'listitem');

      // Header
      const header = document.createElement('button');
      header.className = 'hp-da-header';
      header.setAttribute('type', 'button');
      header.setAttribute('aria-expanded', section.openDefault ? 'true' : 'false');
      header.innerHTML = `
        <span class="hp-da-icon">${section.icon}</span>
        <span class="hp-da-label">${section.label}</span>
        <span class="hp-da-meta" id="hp-da-meta-${section.id}"></span>
        <span class="hp-da-chevron" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 3.5 L5 6.5 L7.5 3.5"
              stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>`;

      // Body wraps the original section element
      const body = document.createElement('div');
      body.className = 'hp-da-body';

      // Move original section into body
      sectionEl.parentNode.removeChild(sectionEl);
      body.appendChild(sectionEl);

      item.appendChild(header);
      item.appendChild(body);
      acc.appendChild(item);

      // State object
      const stateObj = {
        section,
        header,
        body,
        sectionEl,
        open:      section.openDefault,
        animating: false,
      };
      _items.push(stateObj);

      // Set initial visibility
      if (section.openDefault) {
        body.style.display   = 'block';
        body.style.height    = 'auto';
        body.style.overflow  = 'visible';
        body.style.opacity   = '1';
        body.style.transform = 'translateY(0)';
        header.classList.add('hp-da-open');
        item.classList.add('hp-da-open');
      } else {
        body.style.display   = 'none';
        body.style.height    = '0px';
        body.style.overflow  = 'hidden';
        body.style.opacity   = '0';
        body.style.transform = 'translateY(-6px)';
      }

      // Wire click
      header.addEventListener('click', () => _toggle(stateObj));
    });

    // Insert accordion before the first original section's position
    if (insertBefore && insertBefore.parentNode) {
      historyCard.appendChild(acc);
    } else {
      historyCard.appendChild(acc);
    }

    return _items.length > 0;
  }

  /* ── Expand ──────────────────────────────────────────────────────────── */
  function _expand(item) {
    if (item.open || item.animating) return;
    item.animating = true;
    item.open      = true;

    item.header.setAttribute('aria-expanded', 'true');
    item.header.classList.add('hp-da-open');
    item.body.parentElement.classList.add('hp-da-open');

    item.body.style.display   = 'block';
    item.body.style.overflow  = 'hidden';
    item.body.style.height    = '0px';
    item.body.style.opacity   = '0';
    item.body.style.transform = 'translateY(-8px)';
    item.body.style.transition = 'none';

    // Force reflow
    void item.body.offsetHeight;

    const targetH = item.body.scrollHeight;
    item.body.style.transition =
      `height ${DUR_EXPAND}ms ${SPRING_IN}, ` +
      `opacity ${Math.round(DUR_EXPAND * 0.55)}ms ${SPRING_OUT}, ` +
      `transform ${DUR_EXPAND}ms ${SPRING_IN}`;
    item.body.style.height    = targetH + 'px';
    item.body.style.opacity   = '1';
    item.body.style.transform = 'translateY(0)';

    setTimeout(() => {
      if (item.open) {
        item.body.style.height   = 'auto';
        item.body.style.overflow = 'visible';
      }
      item.animating = false;
      // Trigger chart redraw if inside radar/streaks
      _maybeRedrawChart(item);
    }, DUR_EXPAND + 40);
  }

  /* ── Collapse ────────────────────────────────────────────────────────── */
  function _collapse(item) {
    if (!item.open || item.animating) return;
    item.animating = true;
    item.open      = false;

    item.header.setAttribute('aria-expanded', 'false');
    item.header.classList.remove('hp-da-open');
    item.body.parentElement.classList.remove('hp-da-open');

    const currentH = item.body.scrollHeight;
    item.body.style.height   = currentH + 'px';
    item.body.style.overflow = 'hidden';

    void item.body.offsetHeight;

    item.body.style.transition =
      `height ${DUR_COLLAPSE}ms ${SPRING_OUT}, ` +
      `opacity ${Math.round(DUR_COLLAPSE * 0.65)}ms ${SPRING_OUT}, ` +
      `transform ${DUR_COLLAPSE}ms ${SPRING_OUT}`;
    item.body.style.height    = '0px';
    item.body.style.opacity   = '0';
    item.body.style.transform = 'translateY(-4px)';

    setTimeout(() => {
      if (!item.open) {
        item.body.style.display = 'none';
      }
      item.animating = false;
    }, DUR_COLLAPSE + 20);
  }

  /* ── Toggle ──────────────────────────────────────────────────────────── */
  function _toggle(item) {
    if (item.open) _collapse(item);
    else           _expand(item);
  }

  /* ── Chart redraw after expand ────────────────────────────────────────── */
  function _maybeRedrawChart(item) {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  /* ── Update meta badges (called after data refresh) ──────────────────── */
  function _updateMetas() {
    _items.forEach(item => {
      const metaEl = document.getElementById('hp-da-meta-' + item.section.id);
      if (metaEl && item.section.metaFn) {
        try {
          metaEl.textContent = item.section.metaFn(item.sectionEl) || '';
        } catch (_) {}
      }
    });
  }

  /* ── Nike-inspired stagger entrance ─────────────────────────────────── */
  function _staggerEntrance() {
    _items.forEach((item, i) => {
      item.header.style.opacity   = '0';
      item.header.style.transform = 'translateX(-10px)';
      item.header.style.transition = 'none';
      setTimeout(() => {
        item.header.style.transition = `opacity 0.22s ${SPRING_OUT}, transform 0.30s ${SPRING_IN}`;
        item.header.style.opacity    = '1';
        item.header.style.transform  = 'translateX(0)';
      }, i * 45 + 80);
    });
  }

  /* ── Watch history panel open state ─────────────────────────────────── */
  function _watchPanelOpen(historyPanel) {
    const observer = new MutationObserver(() => {
      if (historyPanel.classList.contains('hp-panel-open')) {
        setTimeout(_staggerEntrance, 80);
        setTimeout(_updateMetas, 150);
      }
    });
    observer.observe(historyPanel, { attributes: true, attributeFilter: ['class'] });
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  window.HistoryDetailAccordion = {
    updateMetas: _updateMetas,
    expandAll:   () => _items.forEach(_expand),
    collapseAll: () => _items.forEach(_collapse),
    toggle:      (id) => {
      const item = _items.find(i => i.section.id === id);
      if (item) _toggle(item);
    },
  };

  /* ── Init ────────────────────────────────────────────────────────────── */
  function init() {
    if (_initialized) return;

    const historyCard  = document.getElementById('history-card');
    const historyPanel = document.getElementById('history-panel');
    if (!historyCard) {
      setTimeout(init, 250);
      return;
    }

    // Disable old accordion if still present
    const oldAcc = historyCard.querySelector('.hp-accordion');
    if (oldAcc) {
      // Undo old accordion: restore hp-view panels, show pills
      const pillsRow = historyCard.querySelector('.hp-pills-row');
      if (pillsRow) {
        pillsRow.style.display    = '';
        pillsRow.removeAttribute('aria-hidden');
      }
      // Move views out of accordion items back to history-card
      oldAcc.querySelectorAll('.hp-view').forEach(view => {
        view.style.display = '';
        historyCard.insertBefore(view, oldAcc);
      });
      oldAcc.remove();
    }

    // Re-activate the 'daily' view
    const dailyView = historyCard.querySelector('[data-view-panel="daily"]');
    if (dailyView) {
      historyCard.querySelectorAll('.hp-view').forEach(v => v.classList.remove('hp-view-active'));
      dailyView.classList.add('hp-view-active');
    }

    const built = _build(historyCard);
    if (!built) {
      setTimeout(init, 300);
      return;
    }

    if (historyPanel) _watchPanelOpen(historyPanel);

    // Update metas whenever refresh fires
    const origRefresh = window.HistoryPanel && window.HistoryPanel.refresh;
    if (origRefresh) {
      // Intercept refresh to update metas after data loads
      const patchedRefresh = function() {
        origRefresh.apply(this, arguments);
        setTimeout(_updateMetas, 100);
      };
      if (window.HistoryPanel) window.HistoryPanel.refresh = patchedRefresh;
    }

    _initialized = true;
    setTimeout(_updateMetas, 500);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
  } else {
    // Run after existing history-accordion.js (which loads first at line 2091)
    setTimeout(init, 400);
  }

})();
