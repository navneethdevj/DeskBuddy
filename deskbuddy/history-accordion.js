/**
 * history-accordion.js — Bouncy Accordion for History Panel
 *
 * Transforms the tab-based history view into a smooth spring accordion.
 * Nike-menu inspired backdrop entrance. Glassmorphism headers.
 * Self-contained — no framework dependencies.
 */
(function HistoryAccordion() {
  'use strict';

  /* ── Spring easing (mimics framer-motion spring) ─────────────────────────── */
  // Approximation: overshoot + settle
  const SPRING_IN  = 'cubic-bezier(0.34, 1.38, 0.64, 1)';
  const SPRING_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const DURATION_EXPAND  = 380; // ms
  const DURATION_COLLAPSE = 240; // ms

  /* ── View configuration ──────────────────────────────────────────────────── */
  const VIEWS = [
    { id: 'daily',    label: 'Today',      icon: '◑',  openByDefault: true  },
    { id: 'weekly',   label: 'This Week',  icon: '◈',  openByDefault: false },
    { id: 'monthly',  label: 'This Month', icon: '◉',  openByDefault: false },
    { id: 'lifetime', label: 'All Time',   icon: '◎',  openByDefault: false },
  ];

  /* ── State ───────────────────────────────────────────────────────────────── */
  let _initialized = false;
  let _items = []; // { view, header, body, open, animating }

  /* ── Measure height of a hidden element ──────────────────────────────────── */
  function _measureHeight(el) {
    const prev = el.style.cssText;
    el.style.cssText = 'position:fixed;visibility:hidden;height:auto;overflow:visible;display:flex;flex-direction:column;';
    document.body.appendChild(el);
    const h = el.scrollHeight;
    el.style.cssText = prev;
    return h;
  }

  /* ── Expand one item ─────────────────────────────────────────────────────── */
  function _expand(item) {
    if (item.open || item.animating) return;
    item.animating = true;
    item.open      = true;

    item.header.setAttribute('aria-expanded', 'true');
    item.header.classList.add('hp-acc-open');

    // Reveal the view briefly to measure
    item.body.style.display    = 'flex';
    item.body.style.overflow   = 'hidden';
    item.body.style.height     = '0px';
    item.body.style.opacity    = '0';
    item.body.style.transform  = 'translateY(-6px)';
    item.body.style.transition = 'none';

    // Force reflow
    void item.body.offsetHeight;

    const targetH = item.body.scrollHeight;
    item.body.style.transition =
      `height ${DURATION_EXPAND}ms ${SPRING_IN}, ` +
      `opacity ${DURATION_EXPAND * 0.6}ms ${SPRING_OUT}, ` +
      `transform ${DURATION_EXPAND}ms ${SPRING_IN}`;
    item.body.style.height    = targetH + 'px';
    item.body.style.opacity   = '1';
    item.body.style.transform = 'translateY(0)';

    // After transition, set height to auto
    setTimeout(() => {
      if (item.open) {
        item.body.style.height   = 'auto';
        item.body.style.overflow = 'visible';
      }
      item.animating = false;

      // Trigger chart redraw for this view (size may now be known)
      _triggerChartDraw(item.view.id);
    }, DURATION_EXPAND + 40);
  }

  /* ── Collapse one item ───────────────────────────────────────────────────── */
  function _collapse(item) {
    if (!item.open || item.animating) return;
    item.animating = true;
    item.open      = false;

    item.header.setAttribute('aria-expanded', 'false');
    item.header.classList.remove('hp-acc-open');

    // Snapshot current height before collapsing
    const currentH = item.body.scrollHeight;
    item.body.style.height   = currentH + 'px';
    item.body.style.overflow = 'hidden';

    void item.body.offsetHeight;

    item.body.style.transition =
      `height ${DURATION_COLLAPSE}ms ${SPRING_OUT}, ` +
      `opacity ${DURATION_COLLAPSE * 0.7}ms ${SPRING_OUT}, ` +
      `transform ${DURATION_COLLAPSE}ms ${SPRING_OUT}`;
    item.body.style.height    = '0px';
    item.body.style.opacity   = '0';
    item.body.style.transform = 'translateY(-4px)';

    setTimeout(() => {
      if (!item.open) {
        item.body.style.display = 'none';
      }
      item.animating = false;
    }, DURATION_COLLAPSE + 20);
  }

  /* ── Toggle ──────────────────────────────────────────────────────────────── */
  function _toggle(item) {
    if (item.open) {
      _collapse(item);
    } else {
      _expand(item);
    }
  }

  /* ── Trigger chart redraw after accordion opens ──────────────────────────── */
  function _triggerChartDraw(viewId) {
    // history-panel.js exposes _drawViewChart or similar
    // Try to find the canvas and trigger a resize/redraw
    const canvasId = 'hp-chart-' + viewId;
    const canvas   = document.getElementById(canvasId);
    if (!canvas) return;

    // Dispatch a custom event that history-panel.js can listen to
    const evt = new CustomEvent('hp:accordion-open', { detail: { view: viewId } });
    document.dispatchEvent(evt);

    // Also try window resize to trigger chart recalc
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  /* ── Build accordion DOM ─────────────────────────────────────────────────── */
  function _build(historyCard) {
    // Find existing elements
    const pillsRow = historyCard.querySelector('.hp-pills-row');
    const views    = historyCard.querySelectorAll('.hp-view');
    if (!pillsRow || !views.length) return false;

    // Create accordion container
    const acc = document.createElement('div');
    acc.className = 'hp-accordion';
    acc.setAttribute('role', 'list');

    // Insert accordion where pills row currently is
    pillsRow.parentNode.insertBefore(acc, pillsRow);

    // Hide original pills row (pills are now the accordion headers)
    pillsRow.style.display = 'none';
    pillsRow.setAttribute('aria-hidden', 'true');

    // Build each accordion item
    VIEWS.forEach(view => {
      const viewEl = historyCard.querySelector(`[data-view-panel="${view.id}"]`);
      if (!viewEl) return;

      // Remove the view's default display:none and hp-view class management
      // We'll control visibility ourselves
      viewEl.classList.remove('hp-view-active');

      const item = document.createElement('div');
      item.className = 'hp-acc-item';
      item.setAttribute('role', 'listitem');
      item.dataset.view = view.id;

      const header = document.createElement('button');
      header.className = 'hp-acc-header';
      header.setAttribute('aria-expanded', view.openByDefault ? 'true' : 'false');
      header.setAttribute('type', 'button');
      header.innerHTML = `
        <span class="hp-acc-icon">${view.icon}</span>
        <span class="hp-acc-label">${view.label}</span>
        <span class="hp-acc-meta" id="hp-acc-meta-${view.id}"></span>
        <span class="hp-acc-chevron" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 3.5 L5 6.5 L7.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      `;

      // The body wraps the existing view element
      const body = document.createElement('div');
      body.className = 'hp-acc-body';

      // Move the existing view into the body
      viewEl.parentNode.removeChild(viewEl);
      body.appendChild(viewEl);

      // Ensure view is visible inside accordion
      viewEl.style.display    = 'flex';
      viewEl.style.flexDirection = 'column';
      viewEl.style.gap        = '8px';
      viewEl.style.paddingBottom = '10px';

      item.appendChild(header);
      item.appendChild(body);
      acc.appendChild(item);

      // Create state object
      const stateItem = {
        view,
        header,
        body,
        viewEl,
        open:      false,
        animating: false,
      };
      _items.push(stateItem);

      // Wire click
      header.addEventListener('click', () => _toggle(stateItem));

      // Set initial state
      if (view.openByDefault) {
        body.style.display   = 'flex';
        body.style.height    = 'auto';
        body.style.overflow  = 'visible';
        body.style.opacity   = '1';
        body.style.transform = 'translateY(0)';
        header.classList.add('hp-acc-open');
        stateItem.open = true;
        // Mark the view as active for chart rendering
        viewEl.classList.add('hp-view-active');
      } else {
        body.style.display   = 'none';
        body.style.height    = '0px';
        body.style.overflow  = 'hidden';
        body.style.opacity   = '0';
      }
    });

    return true;
  }

  /* ── Update meta labels (e.g. "2h 30m") ─────────────────────────────────── */
  // Called by history-stats when data updates
  function updateMeta(viewId, text) {
    const el = document.getElementById('hp-acc-meta-' + viewId);
    if (el) el.textContent = text || '';
  }
  window.HistoryAccordion = { updateMeta };

  /* ── Nike-inspired panel entrance ────────────────────────────────────────── */
  function _applyPanelEntrance(historyPanel) {
    // On panel open, stagger accordion items in
    const observer = new MutationObserver(() => {
      if (historyPanel.classList.contains('hp-panel-open')) {
        _staggerIn();
      }
    });
    observer.observe(historyPanel, { attributes: true, attributeFilter: ['class'] });
  }

  function _staggerIn() {
    _items.forEach((item, i) => {
      item.header.style.opacity   = '0';
      item.header.style.transform = 'translateX(-8px)';
      setTimeout(() => {
        item.header.style.transition = `opacity 0.22s ${SPRING_OUT}, transform 0.28s ${SPRING_IN}`;
        item.header.style.opacity    = '1';
        item.header.style.transform  = 'translateX(0)';
      }, i * 38 + 60);
    });
  }

  /* ── Listen for history-panel.js events ──────────────────────────────────── */
  function _hookIntoHistoryPanel() {
    // When history-panel.js activates a view via the pill buttons (which we hid),
    // we should also open the corresponding accordion item.
    // Intercept the data-view attribute changes
    const pillsRow = document.querySelector('.hp-pills-row');
    if (!pillsRow) return;

    pillsRow.querySelectorAll('.hgraph-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const viewId = pill.dataset.view;
        const target = _items.find(it => it.view.id === viewId);
        if (target && !target.open) {
          // Close others, open target
          _items.forEach(it => { if (it !== target && it.open) _collapse(it); });
          _expand(target);
        }
      });
    });
  }

  /* ── Init ────────────────────────────────────────────────────────────────── */
  function init() {
    if (_initialized) return;

    const historyCard  = document.getElementById('history-card');
    const historyPanel = document.getElementById('history-panel');
    if (!historyCard) {
      // Retry
      setTimeout(init, 200);
      return;
    }

    const built = _build(historyCard);
    if (!built) {
      setTimeout(init, 300);
      return;
    }

    if (historyPanel) _applyPanelEntrance(historyPanel);
    _hookIntoHistoryPanel();
    _initialized = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 150));
  } else {
    setTimeout(init, 150);
  }

})();
