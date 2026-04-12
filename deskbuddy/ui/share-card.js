/**
 * ShareCard — Session Share Card
 *
 * Renders a 400×252 canvas card summarising the completed session, then
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

  /** Format a date as "Apr 12, 2026". */
  function _fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return ''; }
  }

  /**
   * Motivational phrase based on focus score.
   * Keeps the card feeling personal and rewarding.
   */
  function _phrase(score) {
    if (score >= 92) return 'absolutely locked in ✦';
    if (score >= 80) return 'incredible focus! ✨';
    if (score >= 68) return 'great work! ⚡';
    if (score >= 50) return 'solid session ✦';
    if (score >= 30) return 'keep it up! 💙';
    return 'you showed up — that counts ✦';
  }

  function _renderCard(sessionData) {
    const W = 400, H = 252;   // slightly taller for breathing room
    const canvas = document.createElement('canvas');
    canvas.width  = W * 2;    // 2× for HiDPI / export quality
    canvas.height = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);           // draw at logical px; export at 2× resolution

    const focusedMins  = Math.floor((sessionData.actualFocusedSeconds  || 0) / 60);
    const longestMins  = Math.floor((sessionData.longestFocusStreakSeconds || 0) / 60);
    const distractions = sessionData.distractionCount  || 0;
    const durationMins = Math.round(sessionData.durationMinutes || 0);
    const totalSecs    = durationMins * 60;
    const focusScore   = totalSecs > 0
      ? Math.round(((sessionData.actualFocusedSeconds || 0) / totalSecs) * 100)
      : 0;

    // ── Palette helpers ───────────────────────────────────────────────────
    // Arc ring colour changes with focus quality
    const ringColor = focusScore >= 80
      ? 'rgba(72, 214, 150, 0.92)'
      : focusScore >= 55
        ? 'rgba(218, 184, 52,  0.92)'
        : 'rgba(218, 110, 72,  0.88)';

    // ── Background ────────────────────────────────────────────────────────
    ctx.fillStyle = '#0b0919';
    ctx.fillRect(0, 0, W, H);

    // Warm amber radial beacon (left-center, behind hero stat)
    const ga = ctx.createRadialGradient(120, 100, 0, 120, 100, 190);
    ga.addColorStop(0,    'rgba(215, 148, 28,  0.12)');
    ga.addColorStop(0.50, 'rgba(145,  68, 200, 0.05)');
    ga.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = ga;
    ctx.fillRect(0, 0, W, H);

    // Cool right-edge glow (behind ring area)
    const gb = ctx.createRadialGradient(360, 90, 0, 360, 90, 130);
    gb.addColorStop(0, 'rgba(80, 200, 168, 0.09)');
    gb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gb;
    ctx.fillRect(0, 0, W, H);

    // Top purple wash
    const gc = ctx.createLinearGradient(0, 0, 0, 62);
    gc.addColorStop(0, 'rgba(80, 42, 162, 0.32)');
    gc.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gc;
    ctx.fillRect(0, 0, W, 62);

    // Bottom dark fade
    const gd = ctx.createLinearGradient(0, H - 52, 0, H);
    gd.addColorStop(0, 'rgba(0,0,0,0)');
    gd.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = gd;
    ctx.fillRect(0, H - 52, W, 52);

    // Outer border — lavender rim
    ctx.strokeStyle = 'rgba(172, 132, 255, 0.26)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Inner inset border
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.strokeRect(3, 3, W - 6, H - 6);

    // Top accent gradient line (lavender → gold)
    const tl = ctx.createLinearGradient(0, 0, W, 0);
    tl.addColorStop(0,    'rgba(0,0,0,0)');
    tl.addColorStop(0.16, 'rgba(172,132,255,0.55)');
    tl.addColorStop(0.65, 'rgba(218,168,46, 0.42)');
    tl.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.strokeStyle = tl;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(W, 1); ctx.stroke();

    // ── Confetti dots (fixed pattern, celebratory) ────────────────────────
    const DOTS = [
      [340, 22, 2.2, 'rgba(255,185,58, 0.34)'],
      [362, 46, 1.6, 'rgba(155,115,255,0.28)'],
      [384, 20, 1.9, 'rgba(72, 214,150, 0.28)'],
      [376, 68, 2.4, 'rgba(255,140,80, 0.26)'],
      [395, 94, 1.7, 'rgba(255,225,98, 0.30)'],
      [356,110, 1.5, 'rgba(180,130,255,0.24)'],
      [388,132, 1.9, 'rgba(72, 214,150, 0.22)'],
      [372,158, 1.6, 'rgba(255,185,58, 0.20)'],
      [393,180, 2.1, 'rgba(155,115,255,0.22)'],
      [14, 148, 1.6, 'rgba(255,225,98, 0.16)'],
      [22, 230, 1.8, 'rgba(155,115,255,0.16)'],
      [397,220, 1.9, 'rgba(255,225,98, 0.16)'],
      [380,205, 1.4, 'rgba(72, 214,150, 0.18)'],
      [210, 13, 1.7, 'rgba(255,255,255,0.10)'],
    ];
    DOTS.forEach(([x, y, r, c]) => {
      ctx.save(); ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    // Background sparkle glyphs
    _drawSparkle(ctx, 352, 15,  3.8, 'rgba(255,210,75,0.22)');
    _drawSparkle(ctx, 390, 52,  2.2, 'rgba(255,210,75,0.14)');
    _drawSparkle(ctx, 380, 205, 2.0, 'rgba(255,210,75,0.12)');
    _drawSparkle(ctx, 19,  224, 2.6, 'rgba(165,132,255,0.16)');
    _drawSparkle(ctx, 215, 13,  1.7, 'rgba(255,255,255,0.10)');

    // ── Header ────────────────────────────────────────────────────────────
    ctx.font      = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(162, 130, 255, 0.72)';
    ctx.fillText('✦  DESKBUDDY', 22, 22);

    // Date — right-aligned, dim
    const dateStr = sessionData.date ? _fmtDate(sessionData.date) : '';
    if (dateStr) {
      ctx.font      = '400 9px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      const dw = ctx.measureText(dateStr).width;
      ctx.fillText(dateStr, W - 20 - dw, 22);
    }

    // SESSION COMPLETE badge (centred in header)
    ctx.font = '600 9px "Segoe UI", system-ui, sans-serif';
    const scW = ctx.measureText('SESSION COMPLETE').width + 20;
    _drawBadge(ctx, Math.round((W - scW) / 2), 11, scW, 16, 'SESSION COMPLETE',
      'rgba(218,162,38,0.16)', 'rgba(218,162,38,0.44)', 'rgba(234,194,78,0.94)', 9);

    // Header separator
    const hs = ctx.createLinearGradient(0, 0, W, 0);
    hs.addColorStop(0,    'rgba(0,0,0,0)');
    hs.addColorStop(0.12, 'rgba(218,168,46,0.32)');
    hs.addColorStop(0.88, 'rgba(172,130,255,0.24)');
    hs.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.strokeStyle = hs; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(14, 35); ctx.lineTo(W - 14, 35); ctx.stroke();

    // ── Left gold accent bar ───────────────────────────────────────────────
    const ab = ctx.createLinearGradient(0, 42, 0, 126);
    ab.addColorStop(0,   'rgba(218,168,46,0.82)');
    ab.addColorStop(0.5, 'rgba(234,192,72,0.96)');
    ab.addColorStop(1,   'rgba(218,168,46,0.12)');
    ctx.fillStyle = ab;
    ctx.fillRect(14, 42, 2.5, 84);

    // ── Hero stat — focused minutes (giant gold number) ────────────────────
    ctx.save();
    const ng = ctx.createLinearGradient(22, 46, 22, 114);
    ng.addColorStop(0, 'rgba(255,236,128,0.98)');
    ng.addColorStop(1, 'rgba(218,172, 38,0.92)');
    ctx.fillStyle = ng;
    ctx.font      = '200 54px "Segoe UI", system-ui, sans-serif';
    const numStr  = String(focusedMins);
    ctx.fillText(numStr, 22, 112);
    const numW = ctx.measureText(numStr).width;
    ctx.restore();

    // "min" / "focused" labels stacked right of the big number
    ctx.font      = '400 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText('min', 30 + numW, 90);
    ctx.font      = '300 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.fillText('focused', 30 + numW, 108);

    // ── Focus-score ring (right of hero) ───────────────────────────────────
    const RCX = 332, RCY = 83, RR = 30;

    // Dim background ring
    ctx.beginPath();
    ctx.arc(RCX, RCY, RR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 5;
    ctx.stroke();

    // Coloured fill arc (clockwise from top)
    if (focusScore > 0) {
      const sa = -0.5 * Math.PI;
      const ea = sa + (Math.min(focusScore, 100) / 100) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(RCX, RCY, RR, sa, ea);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth   = 5;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }

    // Small inner glow circle
    const ig = ctx.createRadialGradient(RCX, RCY, 0, RCX, RCY, RR - 6);
    ig.addColorStop(0, 'rgba(255,255,255,0.04)');
    ig.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.arc(RCX, RCY, RR - 5, 0, Math.PI * 2); ctx.fill();

    // Percentage text (centred in ring)
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = '700 17px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle    = 'rgba(255,255,255,0.94)';
    ctx.fillText(`${focusScore}%`, RCX, RCY - 1);
    ctx.font         = '500 7.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle    = 'rgba(255,255,255,0.38)';
    ctx.fillText('FOCUS', RCX, RCY + 13);
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';

    // ── Stat chips row ─────────────────────────────────────────────────────
    const CHIP_H = 18, CHIP_Y = 124, GAP = 8;
    ctx.font = '400 10px "Segoe UI", system-ui, sans-serif';

    // Mood metadata (used for both chip and goal-line slot)
    const MOOD_META = [
      null, // index 0 unused
      { label: 'drained',  tc: 'rgba(255,100,100,0.84)', bg: 'rgba(255,60,60,0.08)',   bd: 'rgba(255,60,60,0.22)'  },
      { label: 'meh',      tc: 'rgba(255,175,80,0.84)',  bg: 'rgba(255,140,40,0.08)',  bd: 'rgba(255,140,40,0.22)' },
      { label: 'okay',     tc: 'rgba(220,215,100,0.84)', bg: 'rgba(200,190,40,0.08)',  bd: 'rgba(200,190,40,0.20)' },
      { label: 'good',     tc: 'rgba(90,215,160,0.90)',  bg: 'rgba(72,215,148,0.10)',  bd: 'rgba(72,215,148,0.28)' },
      { label: 'on fire!', tc: 'rgba(255,210,60,0.96)',  bg: 'rgba(218,168,46,0.14)',  bd: 'rgba(218,168,46,0.34)' },
    ];

    // Third chip: goal result if answered, mood if rated, else duration
    const goalAchieved  = sessionData.goalAchieved;
    const moodRating    = sessionData.moodRating;
    const hasGoalAnswer = sessionData.goalText && goalAchieved !== null && goalAchieved !== undefined;
    const hasMood       = !sessionData.goalText && moodRating >= 1 && moodRating <= 5;
    const moodMeta      = hasMood ? MOOD_META[moodRating] : null;

    const thirdChip = hasGoalAnswer
      ? goalAchieved === true
        ? { label: '✓  goal achieved!',
            tc: 'rgba(72,215,148,0.90)', bg: 'rgba(72,215,148,0.10)', bd: 'rgba(72,215,148,0.30)' }
        : { label: '✗  goal incomplete',
            tc: 'rgba(255,120,100,0.84)', bg: 'rgba(255,80,60,0.08)', bd: 'rgba(255,80,60,0.22)' }
      : hasMood
        ? { label: `◈  vibe: ${moodMeta.label}`,
            tc: moodMeta.tc, bg: moodMeta.bg, bd: moodMeta.bd }
        : { label: `◈  ${durationMins} min session`,
            tc: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)', bd: 'rgba(255,255,255,0.10)' };

    const chipDefs = [
      {
        label: distractions === 0 ? '✓  no distractions!' : `◈  ${distractions} distraction${distractions !== 1 ? 's' : ''}`,
        tc: distractions === 0 ? 'rgba(72,215,148,0.90)' : 'rgba(255,255,255,0.55)',
        bg: distractions === 0 ? 'rgba(72,215,148,0.10)' : 'rgba(255,255,255,0.06)',
        bd: distractions === 0 ? 'rgba(72,215,148,0.30)' : 'rgba(255,255,255,0.10)',
      },
      {
        label: `◈  ${longestMins} min streak`,
        tc: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.06)', bd: 'rgba(255,255,255,0.10)',
      },
      thirdChip,
    ];

    // Measure all chips, then distribute evenly
    const chipWidths = chipDefs.map(c => ctx.measureText(c.label).width + 18);
    const totalChipW = chipWidths.reduce((s, w) => s + w, 0) + GAP * (chipDefs.length - 1);
    let chipX = Math.max(22, Math.round((W - totalChipW) / 2));   // centre the row

    chipDefs.forEach((chip, i) => {
      const cw = chipWidths[i];
      ctx.save();
      ctx.fillStyle = chip.bg;
      _roundRect(ctx, chipX, CHIP_Y, cw, CHIP_H, CHIP_H / 2);
      ctx.fill();
      ctx.strokeStyle = chip.bd; ctx.lineWidth = 0.75;
      _roundRect(ctx, chipX, CHIP_Y, cw, CHIP_H, CHIP_H / 2);
      ctx.stroke();
      ctx.fillStyle    = chip.tc;
      ctx.textBaseline = 'middle';
      ctx.fillText(chip.label, chipX + 9, CHIP_Y + CHIP_H / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
      chipX += cw + GAP;
    });

    // ── Focus score bar ────────────────────────────────────────────────────
    ctx.font      = '400 9px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    const fsLabelW = ctx.measureText('FOCUS SCORE').width;
    ctx.fillText('FOCUS SCORE', 22, 160);
    ctx.font      = '600 9px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(225,184,72,0.90)';
    ctx.fillText(`  ${focusScore}%`, 22 + fsLabelW, 160);
    _drawFocusBar(ctx, 22, 165, W - 44, 4, focusScore / 100);

    // ── Goal line OR mood line (y=184 slot) ────────────────────────────────
    if (sessionData.goalText) {
      // Session had a goal — show it with completion mark
      const achieved  = sessionData.goalAchieved;
      const mark      = achieved === true ? ' ✓' : achieved === false ? ' ✗' : '';
      ctx.font      = 'italic 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = achieved === true
        ? 'rgba(72,215,148,0.92)'
        : achieved === false
          ? 'rgba(255,100,100,0.84)'
          : 'rgba(255,255,255,0.42)';

      let goalTxt = `"${sessionData.goalText}"${mark}`;
      ctx.save();
      const MAX_GW = W - 44;
      if (ctx.measureText(goalTxt).width > MAX_GW) {
        let base = sessionData.goalText;
        while (ctx.measureText(`"${base}…"${mark}`).width > MAX_GW && base.length > 1)
          base = base.slice(0, -1);
        goalTxt = `"${base}…"${mark}`;
      }
      ctx.fillText(goalTxt, 22, 184);
      ctx.restore();
    } else if (hasMood) {
      // No goal — show the mood/energy rating the user gave
      ctx.save();
      ctx.font      = '400 9px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillText('VIBE', 22, 184);
      const vibeLabelW = ctx.measureText('VIBE').width;
      ctx.font      = '500 11px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = moodMeta.tc;
      ctx.fillText(`  ${moodMeta.label}`, 22 + vibeLabelW, 184);
      ctx.restore();
    }

    // ── Trophy watermark (right side, behind ring area, faint) ────────────
    _drawTrophy(ctx, 332, 170, 0.82, 'rgba(218,168,46,0.12)');

    // ── Footer ────────────────────────────────────────────────────────────
    const streak    = (typeof Session !== 'undefined' && Session.computeDayStreak?.()) || 0;
    const totalMins = (typeof Session !== 'undefined' && Session.getTotalFocusedMinutes?.()) || 0;
    const tier      = _getBondingTier(streak, totalMins);

    // Goal completion rate — only rendered when there's meaningful history (≥3 answered)
    const goalRate = (typeof Session !== 'undefined' && Session.getGoalCompletionRate?.()) || null;

    // Footer gradient separator
    const fl = ctx.createLinearGradient(0, 0, W, 0);
    fl.addColorStop(0,    'rgba(0,0,0,0)');
    fl.addColorStop(0.12, 'rgba(218,168,46,0.32)');
    fl.addColorStop(0.88, 'rgba(172,130,255,0.24)');
    fl.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.strokeStyle = fl; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(14, 196); ctx.lineTo(W - 14, 196); ctx.stroke();

    // Motivational phrase
    ctx.font      = 'italic 400 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(225,192,100,0.62)';
    ctx.fillText(_phrase(focusScore), 22, 213);

    // Day streak (left of footer bottom row)
    const streakLabel = streak > 0 ? `Day ${streak} streak` : 'first session ✦';
    ctx.font      = '400 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText(streakLabel, 22, 234);

    // Goal completion rate — shown between streak and tier when ≥3 goals answered
    if (goalRate && goalRate.total >= 3) {
      const grLabel = `${goalRate.achieved}/${goalRate.total} goals ✓`;
      ctx.font      = '400 9px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = goalRate.rate >= 70
        ? 'rgba(72,215,148,0.60)'
        : 'rgba(255,255,255,0.28)';
      const streakW = ctx.measureText(streakLabel).width;
      // Position it right after the streak label with a mid-dot separator
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillText(' · ', 22 + streakW, 234);
      const dotW = ctx.measureText(' · ').width;
      ctx.fillStyle = goalRate.rate >= 70
        ? 'rgba(72,215,148,0.60)'
        : 'rgba(255,255,255,0.28)';
      ctx.fillText(grLabel, 22 + streakW + dotW, 234);
    }

    // Tier badge (right of footer bottom row)
    ctx.font     = '600 9px "Segoe UI", system-ui, sans-serif';
    const tierW  = ctx.measureText(tier).width + 18;
    _drawBadge(ctx, W - 18 - tierW, H - 28, tierW, 15, tier,
      'rgba(138,102,255,0.16)', 'rgba(138,102,255,0.36)', 'rgba(194,170,255,0.84)', 9);

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
        <div id="share-card-left">
          <div id="share-card-header">
            <span id="share-card-title">session summary</span>
            <button id="share-card-close" title="Close" aria-label="Close share card">✕</button>
          </div>
          <div id="share-card-canvas-wrap"></div>
          <div id="share-card-goal-prompt" style="display:none">
            <div class="sc-goal-prompt-content">
              <span class="sc-prompt-icon">🎯</span>
              <span id="share-card-goal-label" class="sc-prompt-label">did you complete your goal?</span>
            </div>
            <div class="sc-prompt-btns">
              <button id="share-card-goal-yes" class="sc-btn sc-btn-yes">yes! ✓</button>
              <button id="share-card-goal-no"  class="sc-btn sc-btn-no">not yet</button>
            </div>
          </div>
          <div id="share-card-goal-insight" style="display:none" aria-live="polite"></div>
          <div id="share-card-mood-prompt" style="display:none">
            <span class="sc-prompt-label">how did this session feel?</span>
            <div class="sc-mood-btns">
              <button class="sc-mood-btn" data-rating="1" title="Drained">😩</button>
              <button class="sc-mood-btn" data-rating="2" title="Meh">😕</button>
              <button class="sc-mood-btn" data-rating="3" title="Okay">😐</button>
              <button class="sc-mood-btn" data-rating="4" title="Good">🙂</button>
              <button class="sc-mood-btn" data-rating="5" title="On fire!">🔥</button>
            </div>
          </div>
          <div id="share-card-actions">
            <button id="share-card-copy"     class="sc-btn sc-btn-primary">copy image</button>
            <button id="share-card-download" class="sc-btn sc-btn-secondary">save PNG</button>
          </div>
          <div id="share-card-status" aria-live="polite" aria-atomic="true"></div>
        </div>
        <div id="share-card-graph-col" style="display:none">
          <div class="sc-graph-header">
            <span class="sc-graph-title">focus timeline</span>
            <span class="sc-graph-legend">
              <span class="sc-graph-legend-dot sc-graph-legend-green"></span>focused
              <span class="sc-graph-legend-dot sc-graph-legend-amber"></span>drifting
              <span class="sc-graph-legend-dot sc-graph-legend-red"></span>distracted
            </span>
          </div>
          <canvas id="share-card-graph-canvas"></canvas>
        </div>
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
      // Buddy celebrates with the user
      if (typeof Emotion !== 'undefined') Emotion.preview('overjoyed', 3000);
      if (typeof Sounds !== 'undefined') Sounds.play('overjoyed_chirp');
      // Show goal completion insight
      _showGoalInsight(true);
    });

    // Goal achieved — no
    modal.querySelector('#share-card-goal-no').addEventListener('click', () => {
      if (!_sessionDataRef) return;
      _sessionDataRef.goalAchieved = false;
      if (typeof Session !== 'undefined') Session.setGoalAchieved(false);
      _rerenderCard();
      modal.querySelector('#share-card-goal-prompt').style.display = 'none';
      // Buddy shows supportive pouty expression
      if (typeof Emotion !== 'undefined') Emotion.preview('pouty', 2500);
      // Show encouraging goal insight
      _showGoalInsight(false);
    });

    // Mood rating — one of five emoji buttons
    modal.querySelectorAll('.sc-mood-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_sessionDataRef) return;
        const rating = parseInt(btn.dataset.rating, 10);
        _sessionDataRef.moodRating = rating;
        if (typeof Session !== 'undefined') Session.setMoodRating(rating);
        _rerenderCard();
        modal.querySelector('#share-card-mood-prompt').style.display = 'none';
      });
    });

    // Copy to clipboard — use Electron native API, fall back to Web Clipboard API
    modal.querySelector('#share-card-copy').addEventListener('click', async () => {
      if (!_canvasCache) return;
      const statusEl = modal.querySelector('#share-card-status');
      try {
        const dataUrl = _canvasCache.toDataURL('image/png');
        if (window.electronAPI?.copyImage) {
          // Electron path: route through main process → clipboard.writeImage()
          const res = await window.electronAPI.copyImage(dataUrl);
          statusEl.textContent = res?.ok ? '✓ copied to clipboard!' : 'could not copy — try save PNG';
        } else {
          // Web fallback (non-Electron context)
          await new Promise((resolve, reject) => {
            _canvasCache.toBlob(async blob => {
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                resolve();
              } catch (e) { reject(e); }
            }, 'image/png');
          });
          statusEl.textContent = '✓ copied!';
        }
      } catch (_) {
        statusEl.textContent = 'could not copy — try save PNG';
      }
      setTimeout(() => { statusEl.textContent = ''; }, 2400);
    });

    // Save PNG — use Electron native save dialog, fall back to <a> download
    modal.querySelector('#share-card-download').addEventListener('click', async () => {
      if (!_canvasCache) return;
      const statusEl = modal.querySelector('#share-card-status');
      try {
        const dataUrl = _canvasCache.toDataURL('image/png');
        if (window.electronAPI?.saveImage) {
          // Electron path: opens native OS Save dialog
          const res = await window.electronAPI.saveImage(dataUrl);
          if (res?.ok) {
            statusEl.textContent = '✓ saved!';
            setTimeout(() => { statusEl.textContent = ''; }, 2400);
          }
          // If canceled, show nothing
        } else {
          // Web fallback
          const a      = document.createElement('a');
          a.href       = dataUrl;
          a.download   = `deskbuddy-session-${new Date().toISOString().slice(0, 10)}.png`;
          a.click();
        }
      } catch (_) {
        statusEl.textContent = 'could not save';
        setTimeout(() => { statusEl.textContent = ''; }, 2400);
      }
    });
  }

  /** Re-render the card canvas after a goal-achieved answer. */
  function _rerenderCard() {
    if (!_sessionDataRef) return;
    _canvasCache = _renderCard(_sessionDataRef);
    const wrap = document.getElementById('share-card-canvas-wrap');
    if (wrap) {
      wrap.innerHTML = '';
      _canvasCache.style.maxWidth     = '100%';
      _canvasCache.style.height       = 'auto';
      _canvasCache.style.borderRadius = '8px';
      wrap.appendChild(_canvasCache);
    }
  }

  /**
   * _showGoalInsight(achieved) — show a goal completion insight after the user
   * answers the goal prompt. Displays goal completion rate and a personal message.
   */
  function _showGoalInsight(achieved) {
    const insightEl = document.getElementById('share-card-goal-insight');
    if (!insightEl) return;

    const rate = (typeof Session !== 'undefined' && Session.getGoalCompletionRate?.()) || null;

    let message, sub;
    if (achieved) {
      message = '🎉 goal crushed!';
      if (rate && rate.total >= 2) {
        sub = `${rate.achieved} of ${rate.total} goals completed — ${rate.rate}% completion rate`;
      } else {
        sub = 'keep up the amazing work!';
      }
    } else {
      message = '💙 next time you will';
      if (rate && rate.total >= 2) {
        sub = `${rate.achieved} of ${rate.total} goals completed — you\'re building the habit`;
      } else {
        sub = 'every session gets you closer';
      }
    }

    insightEl.innerHTML = `<span class="sc-insight-msg">${message}</span><span class="sc-insight-sub">${sub}</span>`;
    insightEl.style.display = '';
    // Auto-hide insight after 8s
    setTimeout(() => { insightEl.style.display = 'none'; }, 8000);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * show(sessionData) — render the card and open the modal.
   * @param {object} sessionData — session history entry
   * @param {string} _emotion    — kept for call-site compatibility; unused
   */
  function show(sessionData, _emotion) {
    _ensureModal();
    _sessionDataRef = sessionData;  // mutable ref so goal-answer can re-render
    _canvasCache    = _renderCard(sessionData);

    const wrap = document.getElementById('share-card-canvas-wrap');
    if (wrap) {
      wrap.innerHTML = '';
      _canvasCache.style.maxWidth     = '100%';
      _canvasCache.style.height       = 'auto';
      _canvasCache.style.borderRadius = '8px';
      wrap.appendChild(_canvasCache);
    }

    // Show the right prompt depending on whether the session had a goal
    const goalPromptEl = document.getElementById('share-card-goal-prompt');
    const moodPromptEl = document.getElementById('share-card-mood-prompt');
    const insightEl    = document.getElementById('share-card-goal-insight');
    // Reset insight on each new show
    if (insightEl) insightEl.style.display = 'none';
    if (goalPromptEl && moodPromptEl) {
      const hasGoal  = !!sessionData.goalText;
      const showGoal = hasGoal && sessionData.goalAchieved === null;
      const showMood = !hasGoal && (sessionData.moodRating === null || sessionData.moodRating === undefined);
      goalPromptEl.style.display = showGoal ? '' : 'none';
      moodPromptEl.style.display = showMood ? '' : 'none';
      // Personalise the goal prompt label with the actual goal text
      if (hasGoal && showGoal) {
        const labelEl = document.getElementById('share-card-goal-label');
        if (labelEl) {
          const maxLen = 48;
          const truncated = sessionData.goalText.length > maxLen
            ? sessionData.goalText.slice(0, maxLen - 1) + '…'
            : sessionData.goalText;
          labelEl.textContent = `did you complete: "${truncated}"?`;
        }
      }
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

    // ── Focus graph — show right column and start draw-in animation ──────────
    const graphCol    = document.getElementById('share-card-graph-col');
    const graphCanvas = document.getElementById('share-card-graph-canvas');
    const timeline    = sessionData.focusTimeline;
    const hasGraph    = Array.isArray(timeline) && timeline.length >= 2;

    if (graphCol) graphCol.style.display = hasGraph ? '' : 'none';
    if (hasGraph && graphCanvas && typeof FocusGraph !== 'undefined') {
      // Small delay so the modal fade-in completes before animation starts
      setTimeout(() => {
        FocusGraph.draw(graphCanvas, sessionData.focusTimeline, sessionData.milestones || []);
      }, 150);
    }
  }

  /**
   * hide() — close the modal and stop any running graph animation.
   */
  function hide() {
    // Cancel graph animation before hiding
    if (typeof FocusGraph !== 'undefined') FocusGraph.cancel();

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
