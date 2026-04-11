/**
 * ShareCard — Session Share Card
 *
 * Renders a 400×240 canvas card summarising the completed session, then
 * shows a popup modal with options to copy the image to the clipboard
 * or download it as a PNG.
 *
 * Public API
 *   ShareCard.show(sessionData, emotion)
 *   ShareCard.hide()
 *
 * sessionData shape (mirrors session.js history entry):
 *   { actualFocusedSeconds, distractionCount, longestFocusStreakSeconds,
 *     goalText, goalAchieved, durationMinutes }
 *
 * Only rendered on COMPLETED sessions — never for FAILED / ABANDONED.
 */
const ShareCard = (() => {

  // ── Bonding tier ─────────────────────────────────────────────────────────

  // Lightweight tier table: [min streak days, min total focused minutes, label]
  const BONDING_TIERS = [
    [30, 1200, 'SOULBOUND'],
    [14,  480, 'DEVOTED'],
    [ 7,  180, 'BONDED'],
    [ 3,   60, 'ATTACHED'],
    [ 1,    0, 'ACQUAINTED'],
    [ 0,    0, 'STRANGERS'],
  ];

  function _getBondingTier(streakDays, totalMins) {
    for (const [minStreak, minMins, label] of BONDING_TIERS) {
      if (streakDays >= minStreak && totalMins >= minMins) return label;
    }
    return 'STRANGERS';
  }

  // ── Companion glyph drawing ───────────────────────────────────────────────

  // Per-emotion eye/brow/mouth descriptors for a minimal canvas glyph.
  const GLYPHS = {
    happy:      { ew: 1.05, eh: 0.55, brow: -8,  mouth: 'smile'    },
    overjoyed:  { ew: 1.10, eh: 1.10, brow: -10, mouth: 'bigsmile' },
    sad:        { ew: 0.90, eh: 0.90, brow:  10, mouth: 'frown'    },
    crying:     { ew: 0.80, eh: 0.70, brow:  14, mouth: 'dfrown'   },
    grumpy:     { ew: 0.80, eh: 0.65, brow:  16, mouth: 'flat'     },
    suspicious: { ew: 0.85, eh: 0.55, brow:  10, mouth: 'flat'     },
    curious:    { ew: 1.00, eh: 1.25, brow:  -3, mouth: 'open'     },
    focused:    { ew: 0.75, eh: 0.60, brow:   5, mouth: null       },
    sleepy:     { ew: 0.90, eh: 0.18, brow:   3, mouth: null       },
    scared:     { ew: 1.10, eh: 1.30, brow:  -5, mouth: 'o'        },
    excited:    { ew: 1.05, eh: 1.10, brow: -10, mouth: 'bigsmile' },
    idle:       { ew: 1.00, eh: 0.92, brow:  -1, mouth: null       },
  };

  function _drawBrow(ctx, cx, topY, w, angleDeg) {
    const rad = angleDeg * Math.PI / 180;
    const hw  = w / 2;
    const dx  = hw * Math.cos(rad);
    const dy  = hw * Math.sin(rad);
    ctx.beginPath();
    ctx.moveTo(cx - dx, topY + dy);
    ctx.lineTo(cx + dx, topY - dy);
    ctx.strokeStyle = 'rgba(200, 200, 255, 0.70)';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.stroke();
  }

  function _drawMouth(ctx, cx, y, type) {
    ctx.strokeStyle = 'rgba(200, 200, 255, 0.70)';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    switch (type) {
      case 'smile':
        ctx.beginPath();
        ctx.arc(cx, y - 4, 8, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        break;
      case 'bigsmile':
        ctx.beginPath();
        ctx.arc(cx, y - 5, 11, 0.10 * Math.PI, 0.90 * Math.PI);
        ctx.stroke();
        break;
      case 'frown':
        ctx.beginPath();
        ctx.arc(cx, y + 6, 8, 1.15 * Math.PI, 1.85 * Math.PI);
        ctx.stroke();
        break;
      case 'dfrown':
        ctx.beginPath();
        ctx.arc(cx, y + 8, 10, 1.15 * Math.PI, 1.85 * Math.PI);
        ctx.stroke();
        break;
      case 'flat':
        ctx.beginPath();
        ctx.moveTo(cx - 7, y);
        ctx.lineTo(cx + 7, y);
        ctx.stroke();
        break;
      case 'open':
        ctx.beginPath();
        ctx.arc(cx, y, 5, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'o':
        ctx.beginPath();
        ctx.arc(cx, y, 7, 0, Math.PI * 2);
        ctx.stroke();
        break;
    }
  }

  function _drawCompanionGlyph(ctx, emotion, cx, cy) {
    const g = GLYPHS[emotion] || GLYPHS.idle;

    const EYE_BASE_W = 18, EYE_BASE_H = 20;
    const eyeW    = EYE_BASE_W * g.ew;
    const eyeH    = EYE_BASE_H * g.eh;
    const spacing = 26;

    // Soft outer glow
    const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, 42);
    grd.addColorStop(0, 'rgba(160,140,255,0.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(cx - 50, cy - 50, 100, 100);

    // Eyes
    ctx.fillStyle   = 'rgba(190, 180, 255, 0.88)';
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth   = 0.8;

    ctx.beginPath();
    ctx.ellipse(cx - spacing / 2, cy, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx + spacing / 2, cy, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Pupils
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath(); ctx.arc(cx - spacing / 2, cy + 1, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + spacing / 2, cy + 1, 4.5, 0, Math.PI * 2); ctx.fill();

    // Eye glints
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath(); ctx.arc(cx - spacing / 2 - 2, cy - 2, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + spacing / 2 - 2, cy - 2, 1.5, 0, Math.PI * 2); ctx.fill();

    // Eyebrows
    const browTopY = cy - eyeH / 2 - 5;
    _drawBrow(ctx, cx - spacing / 2, browTopY, eyeW * 0.9,  g.brow);
    _drawBrow(ctx, cx + spacing / 2, browTopY, eyeW * 0.9, -g.brow);

    // Mouth
    if (g.mouth) _drawMouth(ctx, cx, cy + eyeH / 2 + 10, g.mouth);
  }

  // ── Focus score bar ───────────────────────────────────────────────────────

  function _drawFocusBar(ctx, x, y, w, h, pct) {
    // Background track
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    _roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();

    // Fill
    const fillW = Math.max(h, w * Math.min(1, Math.max(0, pct)));
    const grad  = ctx.createLinearGradient(x, y, x + fillW, y);
    grad.addColorStop(0,   'rgba(140,110,255,0.80)');
    grad.addColorStop(1,   'rgba(100,200,255,0.80)');
    ctx.fillStyle = grad;
    _roundRect(ctx, x, y, fillW, h, h / 2);
    ctx.fill();
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + h,     r);
    ctx.arcTo(x + w, y + h, x,     y + h,     r);
    ctx.arcTo(x,     y + h, x,     y,          r);
    ctx.arcTo(x,     y,     x + w, y,          r);
    ctx.closePath();
  }

  // ── Card renderer ─────────────────────────────────────────────────────────

  function _renderCard(sessionData, emotion) {
    const W = 400, H = 240;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ── Background ────────────────────────────────────────────────────────
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);

    // Subtle top-edge purple tint
    const topGrad = ctx.createLinearGradient(0, 0, 0, 80);
    topGrad.addColorStop(0, 'rgba(120,90,200,0.18)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, 80);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // ── Header ────────────────────────────────────────────────────────────
    ctx.font      = '500 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillText('👀  DeskBuddy', 24, 30);

    // ── Primary stat: focused time ────────────────────────────────────────
    const focusedMins  = Math.floor((sessionData.actualFocusedSeconds || 0) / 60);
    const longestMins  = Math.floor((sessionData.longestFocusStreakSeconds || 0) / 60);
    const distractions = sessionData.distractionCount || 0;
    const totalSecs    = (sessionData.durationMinutes || 0) * 60;
    const focusScore   = totalSecs > 0
      ? Math.round(((sessionData.actualFocusedSeconds || 0) / totalSecs) * 100)
      : 0;

    ctx.font      = '300 28px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(`✦  ${focusedMins} min focused`, 24, 68);

    // ── Secondary stats ───────────────────────────────────────────────────
    ctx.font      = '300 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.fillText(`${distractions} distraction${distractions !== 1 ? 's' : ''}`, 24, 92);
    ctx.fillText(`longest streak: ${longestMins} min`, 24, 110);

    // ── Focus score bar ───────────────────────────────────────────────────
    ctx.font      = '300 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText(`focus score  ${focusScore}%`, 24, 132);
    _drawFocusBar(ctx, 24, 138, 160, 5, focusScore / 100);

    // ── Goal line ─────────────────────────────────────────────────────────
    if (sessionData.goalText) {
      const achieved = sessionData.goalAchieved;
      const mark     = achieved === true ? ' ✓' : achieved === false ? ' ✗' : '';
      ctx.font      = 'italic 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = achieved === true
        ? 'rgba(100,220,100,0.90)'
        : achieved === false
          ? 'rgba(255,100,100,0.80)'
          : 'rgba(255,255,255,0.42)';

      // Truncate if too long for the card
      let goalTxt = `"${sessionData.goalText}"${mark}`;
      const MAX_W = 200;
      ctx.save();
      if (ctx.measureText(goalTxt).width > MAX_W) {
        while (ctx.measureText(goalTxt + '…"' + mark).width > MAX_W && goalTxt.length > 3) {
          goalTxt = goalTxt.slice(0, -1);
        }
        goalTxt += `…"${mark}`;
      }
      ctx.fillText(goalTxt, 24, 162);
      ctx.restore();
    }

    // ── Companion glyph (right side) ──────────────────────────────────────
    _drawCompanionGlyph(ctx, emotion || 'happy', 318, 115);

    // ── Footer ────────────────────────────────────────────────────────────
    const streak     = (typeof Session !== 'undefined' && Session.computeDayStreak?.()) || 0;
    const totalMins  = (typeof Session !== 'undefined' && Session.getTotalFocusedMinutes?.()) || 0;
    const tier       = _getBondingTier(streak, totalMins);
    const streakText = streak === 1 ? 'Day 1 streak' : `Day ${streak} streak`;

    ctx.font      = '400 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.fillText(`${streakText}  ·  ${tier}`, 24, H - 14);

    // Light bottom separator
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(24, H - 26);
    ctx.lineTo(W - 24, H - 26);
    ctx.stroke();

    return canvas;
  }

  // ── Modal UI ─────────────────────────────────────────────────────────────

  let _modalEl     = null;
  let _canvasCache = null;

  function _ensureModal() {
    if (document.getElementById('share-card-modal')) return;

    const modal = document.createElement('div');
    modal.id        = 'share-card-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Session share card');
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div id="share-card-inner">
        <div id="share-card-header">
          <span id="share-card-title">session summary</span>
          <button id="share-card-close" title="Close" aria-label="Close share card">✕</button>
        </div>
        <div id="share-card-canvas-wrap"></div>
        <div id="share-card-actions">
          <button id="share-card-copy"     class="sc-btn sc-btn-primary">copy image</button>
          <button id="share-card-download" class="sc-btn sc-btn-secondary">save PNG</button>
        </div>
        <div id="share-card-status" aria-live="polite" aria-atomic="true"></div>
      </div>
    `;
    document.body.appendChild(modal);
    _modalEl = modal;

    // Wire close button
    modal.querySelector('#share-card-close').addEventListener('click', () => ShareCard.hide());

    // Close on backdrop click
    modal.addEventListener('click', e => {
      if (e.target === modal) ShareCard.hide();
    });

    // Keyboard dismiss
    modal.addEventListener('keydown', e => {
      if (e.key === 'Escape') ShareCard.hide();
    });

    // Copy to clipboard
    modal.querySelector('#share-card-copy').addEventListener('click', async () => {
      if (!_canvasCache) return;
      const statusEl = modal.querySelector('#share-card-status');
      try {
        _canvasCache.toBlob(async blob => {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob }),
            ]);
            statusEl.textContent = '✓ copied!';
          } catch (_) {
            statusEl.textContent = 'clipboard not available — try save PNG';
          }
          setTimeout(() => { statusEl.textContent = ''; }, 2200);
        }, 'image/png');
      } catch (_) {
        statusEl.textContent = 'could not copy';
        setTimeout(() => { statusEl.textContent = ''; }, 2200);
      }
    });

    // Download PNG
    modal.querySelector('#share-card-download').addEventListener('click', () => {
      if (!_canvasCache) return;
      const a  = document.createElement('a');
      a.href   = _canvasCache.toDataURL('image/png');
      a.download = `deskbuddy-session-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * show(sessionData, emotion) — render the card and open the modal.
   * @param {object} sessionData — session history entry
   * @param {string} emotion     — companion emotion at session end
   */
  function show(sessionData, emotion) {
    _ensureModal();
    _canvasCache = _renderCard(sessionData, emotion);

    const wrap = document.getElementById('share-card-canvas-wrap');
    if (wrap) {
      wrap.innerHTML = '';
      // Scale the 400×240 canvas to fit the modal with CSS — the canvas
      // pixel dimensions stay at 400×240 for export quality.
      _canvasCache.style.maxWidth  = '100%';
      _canvasCache.style.height    = 'auto';
      _canvasCache.style.borderRadius = '8px';
      wrap.appendChild(_canvasCache);
    }

    const modal = document.getElementById('share-card-modal');
    if (modal) {
      modal.classList.add('sc-visible');
      modal.setAttribute('aria-hidden', 'false');
      // Focus the close button for accessibility
      setTimeout(() => modal.querySelector('#share-card-close')?.focus(), 80);
    }

    // Clear any old status text
    const statusEl = document.getElementById('share-card-status');
    if (statusEl) statusEl.textContent = '';
  }

  /**
   * hide() — close the modal.
   */
  function hide() {
    const modal = document.getElementById('share-card-modal');
    if (modal) {
      modal.classList.remove('sc-visible');
      modal.setAttribute('aria-hidden', 'true');
    }
    _canvasCache = null;
  }

  return { show, hide };

})();
