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

  // ── Shared drawing utilities ─────────────────────────────────────────────

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  /** Rounded-bar focus-score indicator, gold gradient fill. */
  function _drawFocusBar(ctx, x, y, w, h, pct) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    _roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();

    const fillW = Math.max(h, w * Math.min(1, Math.max(0, pct)));
    const grad  = ctx.createLinearGradient(x, y, x + fillW, y);
    grad.addColorStop(0,   'rgba(215, 150,  28, 0.85)');
    grad.addColorStop(0.5, 'rgba(230, 185,  60, 0.90)');
    grad.addColorStop(1,   'rgba(200, 225, 100, 0.80)');
    ctx.fillStyle = grad;
    _roundRect(ctx, x, y, fillW, h, h / 2);
    ctx.fill();
  }

  /** 4-pointed sparkle at (cx, cy). */
  function _drawSparkle(ctx, cx, cy, size, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r     = (i % 2 === 0) ? size : size * 0.30;
      const px    = cx + Math.cos(angle) * r;
      const py    = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Small filled circle bullet. */
  function _dot(ctx, cx, cy, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Pill-shaped badge with centred label text. */
  function _drawBadge(ctx, x, y, w, h, text, bgColor, borderColor, textColor, fontSize) {
    const r = h / 2;
    ctx.save();
    ctx.fillStyle = bgColor;
    _roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth   = 0.75;
    _roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
    ctx.fillStyle    = textColor;
    ctx.font         = `600 ${fontSize || 9}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'center';
    ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /** Minimal trophy silhouette — used as a faint decorative watermark. */
  function _drawTrophy(ctx, cx, cy, scale, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.3;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    const s = scale;

    // Cup body
    ctx.beginPath();
    ctx.moveTo(cx - 13 * s, cy - 18 * s);
    ctx.lineTo(cx - 11 * s, cy);
    ctx.quadraticCurveTo(cx, cy + 8 * s, cx + 11 * s, cy);
    ctx.lineTo(cx + 13 * s, cy - 18 * s);
    ctx.closePath();
    ctx.stroke();

    // Left handle
    ctx.beginPath();
    ctx.arc(cx - 14 * s, cy - 10 * s, 5 * s, 0.35 * Math.PI, 1.5 * Math.PI);
    ctx.stroke();

    // Right handle
    ctx.beginPath();
    ctx.arc(cx + 14 * s, cy - 10 * s, 5 * s, 1.5 * Math.PI, 0.65 * Math.PI);
    ctx.stroke();

    // Stem + base
    ctx.beginPath();
    ctx.moveTo(cx, cy + 8 * s);
    ctx.lineTo(cx, cy + 17 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10 * s, cy + 17 * s);
    ctx.lineTo(cx + 10 * s, cy + 17 * s);
    ctx.stroke();

    // Star on cup top
    _drawSparkle(ctx, cx, cy - 22 * s, 4 * s, color);

    ctx.restore();
  }

  // ── Card renderer ─────────────────────────────────────────────────────────

  function _renderCard(sessionData, emotion) {
    const W = 400, H = 240;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const focusedMins  = Math.floor((sessionData.actualFocusedSeconds  || 0) / 60);
    const longestMins  = Math.floor((sessionData.longestFocusStreakSeconds || 0) / 60);
    const distractions = sessionData.distractionCount || 0;
    const totalSecs    = (sessionData.durationMinutes || 0) * 60;
    const focusScore   = totalSecs > 0
      ? Math.round(((sessionData.actualFocusedSeconds || 0) / totalSecs) * 100)
      : 0;

    // ── Background ────────────────────────────────────────────────────────

    // Base fill — deep dark indigo
    ctx.fillStyle = '#0c0a1a';
    ctx.fillRect(0, 0, W, H);

    // Warm gold beacon behind stat area (trophy glow)
    const warmGlow = ctx.createRadialGradient(85, 95, 0, 85, 95, 165);
    warmGlow.addColorStop(0,    'rgba(215, 150,  28, 0.11)');
    warmGlow.addColorStop(0.45, 'rgba(150,  75, 200, 0.05)');
    warmGlow.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, 0, W, H);

    // Cool lavender glow on companion side
    const lavGlow = ctx.createRadialGradient(318, 112, 0, 318, 112, 105);
    lavGlow.addColorStop(0, 'rgba(150, 120, 255, 0.11)');
    lavGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lavGlow;
    ctx.fillRect(0, 0, W, H);

    // Top purple-to-transparent band
    const topBand = ctx.createLinearGradient(0, 0, 0, 58);
    topBand.addColorStop(0, 'rgba(88, 48, 168, 0.28)');
    topBand.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topBand;
    ctx.fillRect(0, 0, W, 58);

    // Bottom fade
    const botFade = ctx.createLinearGradient(0, H - 46, 0, H);
    botFade.addColorStop(0, 'rgba(0,0,0,0)');
    botFade.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = botFade;
    ctx.fillRect(0, H - 46, W, 46);

    // Outer border — subtle lavender rim
    ctx.strokeStyle = 'rgba(175, 135, 255, 0.22)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Inner inset border
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    // Top edge gradient line (purple → gold → transparent)
    const topLine = ctx.createLinearGradient(0, 0, W, 0);
    topLine.addColorStop(0,    'rgba(0,0,0,0)');
    topLine.addColorStop(0.18, 'rgba(175,135,255,0.50)');
    topLine.addColorStop(0.62, 'rgba(215,168,48, 0.38)');
    topLine.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.strokeStyle = topLine;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(W, 1);
    ctx.stroke();

    // ── Background sparkle decorations ────────────────────────────────────
    _drawSparkle(ctx, 358, 17,  3.8, 'rgba(255,210,75,0.20)');
    _drawSparkle(ctx, 387, 56,  2.2, 'rgba(255,210,75,0.12)');
    _drawSparkle(ctx, 378, 202, 2.0, 'rgba(255,210,75,0.10)');
    _drawSparkle(ctx, 21,  220, 2.5, 'rgba(160,128,255,0.15)');
    _drawSparkle(ctx, 214, 13,  1.8, 'rgba(255,255,255,0.10)');

    // ── Header ────────────────────────────────────────────────────────────
    ctx.font      = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(160,128,255,0.68)';
    ctx.fillText('✦  DESKBUDDY', 22, 23);

    // "SESSION COMPLETE" pill badge
    ctx.font = '600 9px "Segoe UI", system-ui, sans-serif';
    const badgeW = ctx.measureText('SESSION COMPLETE').width + 18;
    _drawBadge(ctx, 22, 30, badgeW, 15, 'SESSION COMPLETE',
      'rgba(218,162,38,0.14)',
      'rgba(218,162,38,0.40)',
      'rgba(232,192,76,0.90)',
      9);

    // ── Left vertical gold accent bar ─────────────────────────────────────
    const accentG = ctx.createLinearGradient(0, 52, 0, 136);
    accentG.addColorStop(0,   'rgba(218,168,46,0.72)');
    accentG.addColorStop(0.5, 'rgba(232,190,70,0.95)');
    accentG.addColorStop(1,   'rgba(218,168,46,0.18)');
    ctx.fillStyle = accentG;
    ctx.fillRect(14, 52, 2.5, 84);

    // ── Primary stat: focused minutes — large gold number ─────────────────
    ctx.save();
    const numGrad = ctx.createLinearGradient(22, 56, 22, 110);
    numGrad.addColorStop(0, 'rgba(255,234,125,0.98)');
    numGrad.addColorStop(1, 'rgba(218,172, 38,0.92)');
    ctx.fillStyle = numGrad;
    ctx.font      = '200 52px "Segoe UI", system-ui, sans-serif';
    const numStr  = String(focusedMins);
    ctx.fillText(numStr, 22, 108);
    const numW = ctx.measureText(numStr).width;
    ctx.restore();

    // "min focused" label floated right of the big number
    ctx.font      = '300 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.76)';
    ctx.fillText('min focused', 28 + numW, 86);

    // ── Secondary stats ───────────────────────────────────────────────────
    const GOLD_DOT = 'rgba(218,168,46,0.68)';
    ctx.font       = '300 12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle  = 'rgba(255,255,255,0.44)';

    _dot(ctx, 28, 124, GOLD_DOT);
    ctx.fillText(`${distractions} distraction${distractions !== 1 ? 's' : ''}`, 37, 127);

    _dot(ctx, 28, 141, GOLD_DOT);
    ctx.fillText(`longest streak: ${longestMins} min`, 37, 144);

    // ── Focus score bar ───────────────────────────────────────────────────
    ctx.font      = '400 9.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText('FOCUS', 22, 162);
    ctx.font      = '600 9.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(225,184,72,0.90)';
    ctx.fillText(`${focusScore}%`, 57, 162);
    _drawFocusBar(ctx, 22, 167, 198, 4, focusScore / 100);

    // ── Goal line ─────────────────────────────────────────────────────────
    if (sessionData.goalText) {
      const achieved  = sessionData.goalAchieved;
      const mark      = achieved === true ? ' ✓' : achieved === false ? ' ✗' : '';
      const goalColor = achieved === true
        ? 'rgba(75,215,120,0.92)'
        : achieved === false
          ? 'rgba(255,100,100,0.82)'
          : 'rgba(255,255,255,0.40)';
      ctx.font      = 'italic 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = goalColor;

      let goalTxt = `"${sessionData.goalText}"${mark}`;
      ctx.save();
      const MAX_W = 198;
      if (ctx.measureText(goalTxt).width > MAX_W) {
        let base = sessionData.goalText;
        while (ctx.measureText(`"${base}…"${mark}`).width > MAX_W && base.length > 1) {
          base = base.slice(0, -1);
        }
        goalTxt = `"${base}…"${mark}`;
      }
      ctx.fillText(goalTxt, 22, 186);
      ctx.restore();
    }

    // ── Companion glyph (right side) ──────────────────────────────────────
    _drawCompanionGlyph(ctx, emotion || 'happy', 318, 112);

    // ── Trophy watermark beneath companion ────────────────────────────────
    _drawTrophy(ctx, 318, 168, 0.86, 'rgba(218,168,46,0.18)');

    // ── Footer ────────────────────────────────────────────────────────────
    const streak    = (typeof Session !== 'undefined' && Session.computeDayStreak?.()) || 0;
    const totalMins = (typeof Session !== 'undefined' && Session.getTotalFocusedMinutes?.()) || 0;
    const tier      = _getBondingTier(streak, totalMins);

    // Footer separator — gold-to-lavender gradient line
    const footLine = ctx.createLinearGradient(0, 0, W, 0);
    footLine.addColorStop(0,    'rgba(0,0,0,0)');
    footLine.addColorStop(0.14, 'rgba(218,168,46,0.28)');
    footLine.addColorStop(0.86, 'rgba(175,135,255,0.20)');
    footLine.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.strokeStyle = footLine;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(14, H - 32);
    ctx.lineTo(W - 14, H - 32);
    ctx.stroke();

    // Streak label
    const streakLabel = streak > 0 ? `Day ${streak} streak` : 'first session ✦';
    ctx.font      = '400 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText(streakLabel, 22, H - 14);

    // Tier badge — pill on right side of footer
    ctx.font     = '600 9px "Segoe UI", system-ui, sans-serif';
    const tierW  = ctx.measureText(tier).width + 18;
    _drawBadge(ctx, W - 18 - tierW, H - 28, tierW, 14, tier,
      'rgba(135,100,255,0.15)',
      'rgba(135,100,255,0.34)',
      'rgba(192,168,255,0.82)',
      9);

    return canvas;
  }

  // ── Modal UI ─────────────────────────────────────────────────────────────

  let _modalEl      = null;
  let _canvasCache  = null;
  let _sessionDataRef = null;  // mutable ref so goal-answer can re-render

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
        <div id="share-card-goal-prompt" style="display:none">
          <span class="sc-goal-question">did you finish it?</span>
          <div class="sc-goal-btns">
            <button id="share-card-goal-yes" class="sc-btn sc-btn-yes">yes ✓</button>
            <button id="share-card-goal-no"  class="sc-btn sc-btn-no">not yet</button>
          </div>
        </div>
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

    // Goal achieved — yes
    modal.querySelector('#share-card-goal-yes').addEventListener('click', () => {
      if (!_sessionDataRef) return;
      _sessionDataRef.goalAchieved = true;
      if (typeof Session !== 'undefined') Session.setGoalAchieved(true);
      _rerenderCard();
      modal.querySelector('#share-card-goal-prompt').style.display = 'none';
    });

    // Goal achieved — no
    modal.querySelector('#share-card-goal-no').addEventListener('click', () => {
      if (!_sessionDataRef) return;
      _sessionDataRef.goalAchieved = false;
      if (typeof Session !== 'undefined') Session.setGoalAchieved(false);
      _rerenderCard();
      modal.querySelector('#share-card-goal-prompt').style.display = 'none';
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

  /** Re-render the card canvas after a goal-achieved answer. */
  function _rerenderCard() {
    if (!_sessionDataRef) return;
    const emotion = (typeof Emotion !== 'undefined' && Emotion.getState?.()) || 'happy';
    _canvasCache = _renderCard(_sessionDataRef, emotion);
    const wrap = document.getElementById('share-card-canvas-wrap');
    if (wrap) {
      wrap.innerHTML = '';
      _canvasCache.style.maxWidth    = '100%';
      _canvasCache.style.height      = 'auto';
      _canvasCache.style.borderRadius = '8px';
      wrap.appendChild(_canvasCache);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * show(sessionData, emotion) — render the card and open the modal.
   * @param {object} sessionData — session history entry
   * @param {string} emotion     — companion emotion at session end
   */
  function show(sessionData, emotion) {
    _ensureModal();
    _sessionDataRef = sessionData;  // keep mutable ref for goal-answer re-render
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

    // Show goal prompt if session had a goal and it hasn't been answered yet
    const goalPromptEl = document.getElementById('share-card-goal-prompt');
    if (goalPromptEl) {
      const showPrompt = !!(sessionData.goalText && sessionData.goalAchieved === null);
      goalPromptEl.style.display = showPrompt ? '' : 'none';
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
    _canvasCache    = null;
    _sessionDataRef = null;
  }

  return { show, hide };

})();
