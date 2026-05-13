/**
 * PersonalityEditor — "Personality Studio ✦"
 * Full-screen glassmorphic overlay for shaping companion personality.
 *
 * Architecture:
 *  - Schema-driven: SCHEMA array generates all controls dynamically
 *  - Throttled live preview: Brain calls fire immediately on drag;
 *    Settings.set() is debounced 280ms so localStorage isn't spammed
 *  - Backward-compatible adapter: 1-10 sliders map to Brain's 1-3 APIs
 *  - Radar chart: six emo_ dimensions visualised as SVG polygon
 *  - Presets: COZY / BALANCED / ENERGETIC / SCHOLAR + save as custom
 *  - Export / Import: JSON personality files
 *  - resetKey(id) exposed to Settings; full reset re-opens editor
 *
 * Integration points (called from renderer.js after Settings.init()):
 *   PersonalityEditor.init()   ← sets up all event listeners
 *   PersonalityEditor.open()   ← programmatic open
 *   PersonalityEditor.close()  ← programmatic close
 */
const PersonalityEditor = (() => {

  // ── State ─────────────────────────────────────────────────────────────────
  let _open       = false;
  let _dirty      = {};          // key → pending value (not yet Settings.set)
  let _saveTimers = {};          // per-key debounce for Settings.set
  const SAVE_DEBOUNCE = 280;     // ms — localStorage write debounce

  // ── Personality Presets ──────────────────────────────────────────────────
  const PRESETS = {
    cozy: {
      label: '🌙 Cozy',
      desc:  'Soft, slow, affectionate companion. Minimal interruptions.',
      vals: {
        idleSpeed: 2, expressiveness: 4, spontaneousFreq: 3, reactionSpeed: 4,
        affectionLevel: 8, pettingMode: 9, jealousyLevel: 4, forgivenessSpeed: 8,
        talkative: 3, voicePitch: 4, whisperStyle: 'poetic',
        sensitivity: 'GENTLE', encourageFreq: 3, distractPatience: 8, phoneScolding: false,
        nightOwlMode: false, morningCheerful: false, memoryWhispers: true,
        flowStateEnabled: true, streakCelebrate: false, waveReaction: true,
        emo_happy: 6, emo_sad: 4, emo_fear: 4, emo_curious: 5,
        emo_love: 8, emo_grumpy: 2, emo_shy: 7, emo_excited: 3,
      },
    },
    balanced: {
      label: '⚖️ Balanced',
      desc:  'Default personality. Adaptive, expressive, helpful.',
      vals: {
        idleSpeed: 5, expressiveness: 5, spontaneousFreq: 5, reactionSpeed: 5,
        affectionLevel: 5, pettingMode: 5, jealousyLevel: 3, forgivenessSpeed: 6,
        talkative: 5, voicePitch: 5, whisperStyle: 'cute',
        sensitivity: 'NORMAL', encourageFreq: 5, distractPatience: 5, phoneScolding: true,
        nightOwlMode: false, morningCheerful: true, memoryWhispers: true,
        flowStateEnabled: true, streakCelebrate: true, waveReaction: true,
        emo_happy: 5, emo_sad: 5, emo_fear: 5, emo_curious: 6,
        emo_love: 5, emo_grumpy: 5, emo_shy: 5, emo_excited: 5,
      },
    },
    energetic: {
      label: '⚡ Energetic',
      desc:  'Hyper, expressive, excited. Lots of reactions and sounds.',
      vals: {
        idleSpeed: 9, expressiveness: 9, spontaneousFreq: 9, reactionSpeed: 9,
        affectionLevel: 7, pettingMode: 8, jealousyLevel: 6, forgivenessSpeed: 7,
        talkative: 9, voicePitch: 7, whisperStyle: 'chaotic',
        sensitivity: 'STRICT', encourageFreq: 8, distractPatience: 3, phoneScolding: true,
        nightOwlMode: true, morningCheerful: true, memoryWhispers: true,
        flowStateEnabled: false, streakCelebrate: true, waveReaction: true,
        emo_happy: 9, emo_sad: 3, emo_fear: 4, emo_curious: 9,
        emo_love: 7, emo_grumpy: 4, emo_shy: 2, emo_excited: 10,
      },
    },
    scholar: {
      label: '📚 Scholar',
      desc:  'Focus-first. Quiet, stoic, strict about productivity.',
      vals: {
        idleSpeed: 3, expressiveness: 3, spontaneousFreq: 2, reactionSpeed: 6,
        affectionLevel: 4, pettingMode: 3, jealousyLevel: 2, forgivenessSpeed: 4,
        talkative: 2, voicePitch: 3, whisperStyle: 'stoic',
        sensitivity: 'STRICT', encourageFreq: 7, distractPatience: 2, phoneScolding: true,
        nightOwlMode: false, morningCheerful: true, memoryWhispers: false,
        flowStateEnabled: true, streakCelebrate: true, waveReaction: false,
        emo_happy: 4, emo_sad: 3, emo_fear: 3, emo_curious: 7,
        emo_love: 3, emo_grumpy: 6, emo_shy: 3, emo_excited: 3,
      },
    },
  };

  // ── Schema ───────────────────────────────────────────────────────────────
  // type: 's' = slider 1-10, 't' = toggle, 'c' = choice chips
  // onApply: fn(v) called immediately on slider drag (live preview)
  // onSave:  fn(v) called after debounce when Settings.set fires (optional)
  const SCHEMA = [
    // ── GROUP 1 ── ENERGY ─────────────────────────────────────────────
    { group: '⚡  Energy', id: 'g_energy', items: [
      {
        id: 'idleSpeed', label: 'Idle energy', type: 's', min: 1, max: 10, def: 5,
        ll: 'Ghost still', rl: 'Total chaos',
        tip: 'Controls how often and how fast the buddy moves spontaneously.',
        onApply: v => _brain('setIdleSpeed', _remap(v)),
      },
      {
        id: 'expressiveness', label: 'Expressiveness', type: 's', min: 1, max: 10, def: 5,
        ll: 'Micro-twitch', rl: 'Full drama queen',
        tip: 'Controls how big and dramatic emotional reactions appear.',
        onApply: v => _brain('setExpressiveness', _remap(v)),
      },
      {
        id: 'spontaneousFreq', label: 'Spontaneous actions', type: 's', min: 1, max: 10, def: 5,
        ll: 'Minimal', rl: 'Maximum',
        tip: 'How often the buddy does random idle behaviours like spinning or peeking.',
      },
      {
        id: 'reactionSpeed', label: 'Reaction speed', type: 's', min: 1, max: 10, def: 5,
        ll: 'Dreamy slow', rl: 'Instant snappy',
        tip: 'How quickly emotional reactions fire after a trigger.',
      },
    ]},

    // ── GROUP 2 ── WARMTH ─────────────────────────────────────────────
    { group: '♡  Warmth', id: 'g_warmth', items: [
      {
        id: 'affectionLevel', label: 'Affection', type: 's', min: 1, max: 10, def: 5,
        ll: 'Aloof', rl: 'Clingy beyond reason',
        tip: 'Higher affection = warmer whispers, more love reactions, higher petting sensitivity.',
      },
      {
        id: 'pettingMode', label: 'Petting response', type: 's', min: 1, max: 10, def: 5,
        ll: 'Reserved', rl: 'Melts instantly',
        tip: 'How responsive the buddy is to being held or clicked near.',
        onApply: v => _brain('setPettingMode', Math.round(1 + (v - 1) / 9 * 2)),
      },
      {
        id: 'jealousyLevel', label: 'Jealousy', type: 's', min: 1, max: 10, def: 3,
        ll: "Doesn't notice", rl: 'Very jealous',
        tip: 'Higher jealousy = buddy reacts sooner and more intensely when you look away.',
      },
      {
        id: 'forgivenessSpeed', label: 'Forgiveness speed', type: 's', min: 1, max: 10, def: 6,
        ll: 'Holds grudges', rl: 'Instantly over it',
        tip: 'How quickly the buddy forgives you after being grumpy or sulking.',
      },
    ]},

    // ── GROUP 3 ── FOCUS BEHAVIOUR ────────────────────────────────────
    { group: '🎯  Focus', id: 'g_focus', items: [
      {
        id: 'sensitivity', label: 'Distraction tolerance', type: 'c', def: 'NORMAL',
        choices: [
          { v: 'GENTLE', l: '🌸 Gentle', desc: 'Very forgiving. 15s grace on absence.' },
          { v: 'NORMAL', l: '⚖️ Balanced', desc: 'Default. 8s grace.' },
          { v: 'STRICT', l: '⚡ Strict', desc: 'Fast to notice. 3s grace.' },
        ],
        tip: 'Controls how sensitive the focus timer is to you looking away or being absent.',
        onApply: v => _brain('setSensitivity', v),
      },
      {
        id: 'encourageFreq', label: 'Encouragement', type: 's', min: 1, max: 10, def: 5,
        ll: 'Silent', rl: 'Constant cheerleader',
        tip: 'How often the buddy sends motivational whispers during deep focus.',
      },
      {
        id: 'distractPatience', label: 'Distraction patience', type: 's', min: 1, max: 10, def: 5,
        ll: 'Reacts instantly', rl: 'Very patient',
        tip: 'How long the buddy waits before reacting to you being distracted.',
      },
      {
        id: 'phoneScolding', label: 'Phone scolding', type: 't', def: true,
        tip: 'When enabled, buddy reacts when you check your phone during a session.',
        onApply: v => _brain('setPhoneDetectionEnabled', v),
      },
    ]},

    // ── GROUP 4 ── VOICE & CHAT ───────────────────────────────────────
    { group: '🗣  Voice & Chat', id: 'g_voice', items: [
      {
        id: 'talkative', label: 'Talkativeness', type: 's', min: 1, max: 10, def: 5,
        ll: 'Near-silent', rl: 'Constant commentary',
        tip: 'How often the buddy sends spontaneous ambient whispers.',
      },
      {
        id: 'voicePitch', label: 'Voice pitch', type: 's', min: 1, max: 10, def: 5,
        ll: 'Deep hum', rl: 'High chirp',
        tip: 'Adjusts audio pitch for all buddy sounds.',
        onApply: v => _setSoundPitch(v),
      },
      {
        id: 'whisperStyle', label: 'Whisper style', type: 'c', def: 'cute',
        choices: [
          { v: 'cute',    l: '🌸 Cute',    desc: 'Soft, playful, affectionate wording.' },
          { v: 'stoic',   l: '🪨 Stoic',   desc: 'Concise, calm, minimal emoji.' },
          { v: 'chaotic', l: '🌀 Chaotic', desc: 'Energetic, random, dramatic expressions.' },
          { v: 'poetic',  l: '🌙 Poetic',  desc: 'Dreamy, metaphorical, emotionally expressive.' },
        ],
        tip: 'Changes the tone, vocabulary, and style of all buddy whispers.',
      },
    ]},

    // ── GROUP 5 ── SPECIAL BEHAVIOURS ─────────────────────────────────
    { group: '✦  Special', id: 'g_special', items: [
      {
        id: 'waveReaction', label: 'Wave reaction', type: 't', def: true,
        tip: 'Buddy reacts with joy when you wave at the camera.',
      },
      {
        id: 'nightOwlMode', label: 'Night owl mode', type: 't', def: false,
        tip: 'Keeps buddy energetic at night instead of going sleepy.',
      },
      {
        id: 'morningCheerful', label: 'Morning energy', type: 't', def: true,
        tip: 'Extra cheerful greetings and higher energy before 10am.',
      },
      {
        id: 'streakCelebrate', label: 'Streak celebrations', type: 't', def: true,
        tip: 'Buddy celebrates when you hit consecutive focused milestones.',
      },
      {
        id: 'flowStateEnabled', label: 'Deep flow mode', type: 't', def: true,
        tip: 'Buddy enters a quieter, non-disruptive mode during long focus streaks (12+ min).',
      },
      {
        id: 'multiPersonReact', label: 'Social awareness', type: 't', def: true,
        tip: 'Buddy reacts when extra faces appear on camera.',
      },
      {
        id: 'memoryWhispers', label: 'Memory snippets', type: 't', def: true,
        tip: 'Buddy occasionally references your session history in whispers.',
      },
    ]},

    // ── GROUP 6 ── EMOTION SENSITIVITY ────────────────────────────────
    { group: '🎭  Emotions', id: 'g_emo', items: [
      {
        id: 'emo_happy',   label: 'Happiness',   type: 's', min: 1, max: 10, def: 5,
        ll: 'Hard to please', rl: 'Easily delighted',
        tip: 'How easily the buddy becomes and stays happy.',
      },
      {
        id: 'emo_love',    label: 'Lovey-ness',  type: 's', min: 1, max: 10, def: 5,
        ll: 'Reluctant',     rl: 'Falls instantly',
        tip: 'How quickly the buddy enters love/cozy states.',
      },
      {
        id: 'emo_excited', label: 'Excitability', type: 's', min: 1, max: 10, def: 5,
        ll: 'Calm always',   rl: 'Perpetually hyped',
        tip: 'How easily the buddy gets excited from typing or interactions.',
      },
      {
        id: 'emo_shy',     label: 'Shyness',     type: 's', min: 1, max: 10, def: 5,
        ll: 'Bold',          rl: 'Extremely shy',
        tip: 'How quickly sustained eye contact makes the buddy shy.',
      },
      {
        id: 'emo_curious', label: 'Curiosity',   type: 's', min: 1, max: 10, def: 6,
        ll: 'Incurious',     rl: 'Always curious',
        tip: 'How easily the curious state triggers (scanning, tilting head).',
      },
      {
        id: 'emo_grumpy',  label: 'Grumpiness',  type: 's', min: 1, max: 10, def: 5,
        ll: 'Patient',       rl: 'Short-tempered',
        tip: 'How quickly looking away leads to grumpy/pouty states.',
      },
      {
        id: 'emo_sad',     label: 'Sadness depth', type: 's', min: 1, max: 10, def: 5,
        ll: 'Stoic',         rl: 'Very sensitive',
        tip: 'How deep and long-lasting sadness is when you are absent.',
      },
      {
        id: 'emo_fear',    label: 'Jumpiness',   type: 's', min: 1, max: 10, def: 5,
        ll: 'Fearless',      rl: 'Jumpy at anything',
        tip: 'How easily the buddy gets startled by sudden mouse movements.',
      },
    ]},
  ];

  // All IDs flat list (for preset apply + reset)
  const ALL_IDS = SCHEMA.flatMap(g => g.items.map(d => d.id));

  // ── Brain adapter helpers ─────────────────────────────────────────────────
  // Slider 1-10 → Brain 0.4-3.0 (existing Brain API expects 1-3 but clamps)
  function _remap(v) { return Math.round((v / 10 * 3) * 100) / 100; }

  function _brain(method, val) {
    if (typeof Brain !== 'undefined' && typeof Brain[method] === 'function') {
      Brain[method](val);
    }
  }

  function _setSoundPitch(v) {
    if (typeof Sounds !== 'undefined' && Sounds.setPitchMult) {
      Sounds.setPitchMult(0.5 + (v - 1) / 9 * 1.5);
    }
  }

  // ── Throttled live-apply + debounced save ─────────────────────────────────
  // Each slider calls _liveApply(dim, v) on every 'input' event.
  // onApply fires immediately (live preview).
  // Settings.set fires after SAVE_DEBOUNCE ms of no movement (no localStorage spam).
  function _liveApply(dim, v) {
    _dirty[dim.id] = v;
    if (typeof dim.onApply === 'function') dim.onApply(v);

    // Debounce Settings.set
    clearTimeout(_saveTimers[dim.id]);
    _saveTimers[dim.id] = setTimeout(() => {
      if (typeof Settings !== 'undefined') Settings.set(dim.id, v);
      delete _dirty[dim.id];
    }, SAVE_DEBOUNCE);
  }

  // ── Radar chart ───────────────────────────────────────────────────────────
  const RADAR_KEYS = ['emo_happy','emo_love','emo_excited','emo_shy','emo_curious','emo_grumpy'];
  const RADAR_LABELS = ['Happy', 'Love', 'Excited', 'Shy', 'Curious', 'Grumpy'];

  function _buildRadar(vals) {
    const N    = RADAR_KEYS.length;
    const CX   = 80, CY = 80, R = 64;
    const pts  = RADAR_KEYS.map((k, i) => {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      const r     = ((vals[k] ?? 5) / 10) * R;
      return { x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r };
    });
    const poly  = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    // Axis lines + labels
    const axes = RADAR_KEYS.map((k, i) => {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      const lx    = CX + Math.cos(angle) * (R + 14);
      const ly    = CY + Math.sin(angle) * (R + 14);
      return `<line x1="${CX}" y1="${CY}" x2="${(CX + Math.cos(angle)*R).toFixed(1)}" y2="${(CY + Math.sin(angle)*R).toFixed(1)}" stroke="rgba(155,135,255,.15)" stroke-width="1"/>
<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="rgba(155,135,255,.5)" font-size="7.5" text-anchor="middle" dominant-baseline="middle">${RADAR_LABELS[i]}</text>`;
    }).join('');

    // Grid circles
    const grid = [0.33, 0.66, 1].map(f =>
      `<circle cx="${CX}" cy="${CY}" r="${(R*f).toFixed(1)}" fill="none" stroke="rgba(155,135,255,.08)" stroke-width="1"/>`
    ).join('');

    return `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" style="width:160px;height:160px">
      ${grid}${axes}
      <polygon points="${poly}" fill="rgba(155,135,255,.18)" stroke="rgba(155,135,255,.65)" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
  }

  function _refreshRadar() {
    const el = document.getElementById('pe-radar');
    if (!el) return;
    const vals = {};
    ALL_IDS.forEach(id => { vals[id] = _getValue(id); });
    el.innerHTML = _buildRadar(vals);
  }

  function _getValue(id) {
    const pending = _dirty[id];
    if (pending !== undefined) return pending;
    return typeof Settings !== 'undefined' ? Settings.get(id) : _getDefault(id);
  }

  function _getDefault(id) {
    for (const g of SCHEMA) for (const d of g.items) if (d.id === id) return d.def;
    return null;
  }

  // ── Personality summary ───────────────────────────────────────────────────
  function _getSummary() {
    const idle   = _getValue('idleSpeed')     || 5;
    const aff    = _getValue('affectionLevel')|| 5;
    const talk   = _getValue('talkative')     || 5;
    const grumpy = _getValue('emo_grumpy')    || 5;
    const shy    = _getValue('emo_shy')       || 5;
    const style  = _getValue('whisperStyle')  || 'cute';

    const energy  = idle  < 4 ? 'calm'      : idle  > 7 ? 'hyper'       : 'lively';
    const warmth  = aff   < 4 ? 'reserved'  : aff   > 7 ? 'very cuddly' : 'affectionate';
    const chat    = talk  < 4 ? 'quiet'     : talk  > 7 ? 'very chatty' : 'talkative';
    const temper  = grumpy< 4 ? 'patient'   : grumpy> 7 ? 'short-tempered' : 'balanced';
    const shyness = shy   < 4 ? 'bold'      : shy   > 7 ? 'quite shy'   : 'a little shy';

    const styleTag = { cute:'🌸 affectionate', stoic:'🪨 stoic', chaotic:'🌀 chaotic', poetic:'🌙 poetic' }[style] || '';

    return `A ${energy}, ${warmth} companion. ${chat.charAt(0).toUpperCase()+chat.slice(1)}, ${temper}, and ${shyness}. Speaks in a ${styleTag} voice.`;
  }

  function _refreshSummary() {
    const el = document.getElementById('pe-summary');
    if (el) el.textContent = _getSummary();
  }

  // ── DOM builder ───────────────────────────────────────────────────────────
  function _buildOverlay() {
    if (document.getElementById('pe-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'pe-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div id="pe-panel">

        <!-- Header -->
        <div id="pe-header">
          <div id="pe-header-left">
            <div id="pe-title">✦ personality studio</div>
            <div id="pe-sub">shape who your companion truly is</div>
          </div>
          <button id="pe-close-btn" aria-label="Close">✕</button>
        </div>

        <!-- Presets bar -->
        <div id="pe-presets-bar">
          <span class="pe-presets-label">Presets</span>
          <div id="pe-preset-chips">
            ${Object.entries(PRESETS).map(([k,p]) =>
              `<button class="pe-preset-chip" data-preset="${k}" title="${p.desc}">${p.label}</button>`
            ).join('')}
          </div>
          <div id="pe-preset-actions">
            <button id="pe-export-btn" class="pe-action-btn" title="Export personality to JSON">⬆ Export</button>
            <button id="pe-import-btn" class="pe-action-btn" title="Import personality JSON">⬇ Import</button>
          </div>
        </div>

        <!-- Main two-col layout: nav + content -->
        <div id="pe-main">

          <!-- Sticky group nav -->
          <nav id="pe-nav">
            ${SCHEMA.map(g =>
              `<button class="pe-nav-item" data-target="${g.id}">${g.group}</button>`
            ).join('')}
            <div class="pe-nav-sep"></div>
            <button class="pe-nav-item pe-nav-radar" data-target="g_radar">🕸 Radar</button>
          </nav>

          <!-- Scrollable body -->
          <div id="pe-body">
            ${SCHEMA.map(g => `
              <section class="pe-group" id="${g.id}">
                <div class="pe-gh">${g.group}</div>
                <div class="pe-group-items" id="${g.id}_items"></div>
              </section>
            `).join('')}

            <!-- Radar section -->
            <section class="pe-group" id="g_radar">
              <div class="pe-gh">🕸  Emotion Radar</div>
              <div class="pe-radar-wrap">
                <div id="pe-radar"></div>
                <div id="pe-summary-box">
                  <div class="pe-summary-label">personality summary</div>
                  <div id="pe-summary"></div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <!-- Footer -->
        <div id="pe-footer">
          <button id="pe-reset-btn" class="pe-reset">↺ reset all</button>
          <div id="pe-footer-mid">
            <span id="pe-change-indicator"></span>
          </div>
          <button id="pe-done-btn" class="pe-done">done ✦</button>
        </div>
      </div>

      <!-- Hidden import file input -->
      <input type="file" id="pe-import-file" accept=".json" style="display:none">
    `;

    document.body.appendChild(overlay);
    _injectStyles();
    _wireEvents();
  }

  // ── Populate controls ─────────────────────────────────────────────────────
  function _populate() {
    SCHEMA.forEach(group => {
      const container = document.getElementById(`${group.id}_items`);
      if (!container) return;
      container.innerHTML = '';
      group.items.forEach(dim => {
        container.appendChild(_buildRow(dim));
      });
    });
    _refreshRadar();
    _refreshSummary();
  }

  function _buildRow(dim) {
    const row  = document.createElement('div');
    row.className = 'pe-row';
    row.dataset.id = dim.id;

    const cur = _getValue(dim.id) ?? dim.def;

    // Label + tip
    const labelWrap = document.createElement('div');
    labelWrap.className = 'pe-lbl-wrap';
    labelWrap.innerHTML = `<div class="pe-lbl">${dim.label}</div>${
      dim.tip ? `<div class="pe-tip">${dim.tip}</div>` : ''}`;
    row.appendChild(labelWrap);

    // Control
    const ctrl = document.createElement('div');
    ctrl.className = 'pe-ctrl';

    if (dim.type === 's') {
      ctrl.innerHTML = `
        <div class="pe-sw">
          <span class="pe-el">${dim.ll || ''}</span>
          <div class="pe-sl-wrap">
            <input type="range" class="pe-sl" data-id="${dim.id}"
              min="${dim.min}" max="${dim.max}" step="1" value="${cur}">
            <div class="pe-sl-fill" style="width:${((cur-dim.min)/(dim.max-dim.min))*100}%"></div>
          </div>
          <span class="pe-val">${cur}</span>
          <span class="pe-el pe-er">${dim.rl || ''}</span>
        </div>`;

      const sl   = ctrl.querySelector('.pe-sl');
      const fill = ctrl.querySelector('.pe-sl-fill');
      const valEl = ctrl.querySelector('.pe-val');

      sl.addEventListener('input', () => {
        const v = parseInt(sl.value, 10);
        valEl.textContent = v;
        fill.style.width = `${((v - dim.min) / (dim.max - dim.min)) * 100}%`;
        _liveApply(dim, v);
        _refreshRadar();
        _refreshSummary();
        _flashChangeIndicator();
      });

    } else if (dim.type === 't') {
      const toggleId = `pe-tog-${dim.id}`;
      ctrl.innerHTML = `
        <label class="pe-toggle" for="${toggleId}">
          <input type="checkbox" id="${toggleId}" data-id="${dim.id}" ${cur ? 'checked' : ''}>
          <span class="pe-track"><span class="pe-thumb"></span></span>
          <span class="pe-tog-lbl">${cur ? 'On' : 'Off'}</span>
        </label>`;
      const cb  = ctrl.querySelector('input[type=checkbox]');
      const lbl = ctrl.querySelector('.pe-tog-lbl');
      cb.addEventListener('change', () => {
        lbl.textContent = cb.checked ? 'On' : 'Off';
        _liveApply(dim, cb.checked);
        _flashChangeIndicator();
      });

    } else if (dim.type === 'c') {
      const cr = document.createElement('div');
      cr.className = 'pe-choices';
      dim.choices.forEach(ch => {
        const btn = document.createElement('button');
        btn.className = 'pe-choice' + (cur === ch.v ? ' active' : '');
        btn.dataset.val = ch.v;
        btn.innerHTML = `${ch.l}${ch.desc ? `<span class="pe-choice-desc">${ch.desc}</span>` : ''}`;
        btn.addEventListener('click', () => {
          cr.querySelectorAll('.pe-choice').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          _liveApply(dim, ch.v);
          _refreshSummary();
          _flashChangeIndicator();
        });
        cr.appendChild(btn);
      });
      ctrl.appendChild(cr);
    }

    row.appendChild(ctrl);
    return row;
  }

  // ── Nav scrollspy ─────────────────────────────────────────────────────────
  function _initScrollspy() {
    const body = document.getElementById('pe-body');
    if (!body) return;
    body.addEventListener('scroll', _updateNav, { passive: true });
    _updateNav();
  }

  function _updateNav() {
    const body = document.getElementById('pe-body');
    if (!body) return;
    const scrollTop = body.scrollTop + 40;
    let active = null;
    SCHEMA.forEach(g => {
      const el = document.getElementById(g.id);
      if (el && el.offsetTop <= scrollTop) active = g.id;
    });
    const radarEl = document.getElementById('g_radar');
    if (radarEl && radarEl.offsetTop <= scrollTop) active = 'g_radar';

    document.querySelectorAll('.pe-nav-item').forEach(btn => {
      btn.classList.toggle('pe-nav-active', btn.dataset.target === active);
    });
  }

  // ── Flash change indicator ────────────────────────────────────────────────
  let _changeFlashTimer = null;
  function _flashChangeIndicator() {
    const el = document.getElementById('pe-change-indicator');
    if (!el) return;
    el.textContent = '● unsaved changes';
    el.classList.add('visible');
    clearTimeout(_changeFlashTimer);
    _changeFlashTimer = setTimeout(() => {
      el.classList.remove('visible');
    }, 2000);
  }

  // ── Preset apply ─────────────────────────────────────────────────────────
  function _applyPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    const vals = preset.vals;

    // Apply immediately + debounce-save each key
    Object.entries(vals).forEach(([id, v]) => {
      const dim = _findDim(id);
      if (!dim) return;
      _liveApply(dim, v);
    });

    // Flush all saves immediately for presets (skip debounce)
    Object.keys(_saveTimers).forEach(id => {
      clearTimeout(_saveTimers[id]);
      const v = _dirty[id];
      if (v !== undefined && typeof Settings !== 'undefined') {
        Settings.set(id, v);
        delete _dirty[id];
      }
    });

    // Re-render all controls to reflect new values
    setTimeout(() => {
      _populate();
      // Animate the selected preset chip
      document.querySelectorAll('.pe-preset-chip').forEach(c => {
        c.classList.toggle('pe-preset-active', c.dataset.preset === key);
      });
    }, 10);
  }

  function _findDim(id) {
    for (const g of SCHEMA) for (const d of g.items) if (d.id === id) return d;
    return null;
  }

  // ── Export / Import ───────────────────────────────────────────────────────
  function _exportPersonality() {
    if (typeof Settings === 'undefined') return;
    const snap = {};
    ALL_IDS.forEach(id => { snap[id] = Settings.get(id); });
    const payload = JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      source: 'DeskBuddy Personality Studio',
      personality: snap,
    }, null, 2);

    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(payload);
    a.download = `deskbuddy-personality-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function _importPersonality(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        const vals = data.personality || data.settings || {};
        Object.entries(vals).forEach(([id, v]) => {
          const dim = _findDim(id);
          if (dim) _liveApply(dim, v);
        });
        setTimeout(_populate, 20);
      } catch (err) {
        console.warn('[PE] Import failed:', err);
      }
    };
    reader.readAsText(file);
  }

  // ── Open / Close ──────────────────────────────────────────────────────────
  function open() {
    if (_open) return;
    _open = true;
    const el = document.getElementById('pe-overlay');
    if (!el) { _buildOverlay(); setTimeout(open, 30); return; }

    _populate();
    el.classList.add('pe-open');
    el.setAttribute('aria-hidden', 'false');
    setTimeout(_initScrollspy, 50);
    setTimeout(_updateNav, 80);
  }

  function close() {
    if (!_open) return;
    _open = false;

    // Flush any pending debounced saves immediately
    Object.keys(_saveTimers).forEach(id => {
      clearTimeout(_saveTimers[id]);
      const v = _dirty[id];
      if (v !== undefined && typeof Settings !== 'undefined') {
        Settings.set(id, v);
      }
    });
    _dirty = {};
    _saveTimers = {};

    const el = document.getElementById('pe-overlay');
    if (el) {
      el.classList.remove('pe-open');
      el.setAttribute('aria-hidden', 'true');
    }
  }

  // ── Wire events ───────────────────────────────────────────────────────────
  function _wireEvents() {
    // Close button
    document.getElementById('pe-close-btn')?.addEventListener('click', close);
    document.getElementById('pe-done-btn')?.addEventListener('click', close);

    // Click outside panel to close
    document.getElementById('pe-overlay')?.addEventListener('click', e => {
      if (e.target.id === 'pe-overlay') close();
    });

    // Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _open) close();
    });

    // Nav items → scroll to section
    document.querySelectorAll('.pe-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        const body   = document.getElementById('pe-body');
        if (target && body) {
          body.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' });
        }
      });
    });

    // Presets
    document.getElementById('pe-preset-chips')?.addEventListener('click', e => {
      const chip = e.target.closest('.pe-preset-chip');
      if (chip) _applyPreset(chip.dataset.preset);
    });

    // Reset all
    document.getElementById('pe-reset-btn')?.addEventListener('click', () => {
      if (!confirm('Reset all personality settings to defaults?')) return;
      ALL_IDS.forEach(id => {
        const dim = _findDim(id);
        if (!dim) return;
        if (typeof Settings !== 'undefined') Settings.set(id, dim.def);
        if (typeof dim.onApply === 'function') dim.onApply(dim.def);
      });
      setTimeout(_populate, 20);
    });

    // Export
    document.getElementById('pe-export-btn')?.addEventListener('click', _exportPersonality);

    // Import
    document.getElementById('pe-import-btn')?.addEventListener('click', () => {
      document.getElementById('pe-import-file')?.click();
    });
    document.getElementById('pe-import-file')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) _importPersonality(file);
      e.target.value = '';
    });
  }

  // ── Public init (called from renderer.js) ─────────────────────────────────
  function init() {
    _buildOverlay();

    // Wire the open button in the settings panel
    document.getElementById('pe-open-btn')?.addEventListener('click', open);

    // Apply saved personality values to Brain on init
    const dimsToBrain = SCHEMA.flatMap(g => g.items.filter(d => d.onApply));
    dimsToBrain.forEach(dim => {
      const v = (typeof Settings !== 'undefined') ? Settings.get(dim.id) : dim.def;
      if (v != null && typeof dim.onApply === 'function') {
        try { dim.onApply(v); } catch (_) {}
      }
    });
  }

  // ── CSS injection ─────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('pe-styles')) return;
    const style = document.createElement('style');
    style.id = 'pe-styles';
    style.textContent = `
/* ── PE Overlay ── */
#pe-overlay {
  position: fixed; inset: 0; z-index: 9200;
  background: rgba(4,3,14,.72);
  backdrop-filter: blur(6px) saturate(1.4);
  display: none; align-items: center; justify-content: center;
  -webkit-app-region: no-drag;
}
#pe-overlay.pe-open { display: flex; }

#pe-panel {
  width: min(760px,96vw); max-height: 88vh;
  display: flex; flex-direction: column;
  background: rgba(10,8,24,.94);
  border: 1px solid rgba(155,135,255,.16);
  border-radius: 22px; overflow: hidden;
  box-shadow: 0 40px 100px rgba(0,0,0,.80),
              0 0 0 .5px rgba(255,255,255,.08) inset,
              0 0 60px rgba(120,100,255,.06) inset;
  backdrop-filter: blur(50px) saturate(2);
  animation: peIn .28s cubic-bezier(.34,1.48,.64,1) both;
}
@keyframes peIn {
  from { opacity:0; transform:scale(.95) translateY(18px) }
  to   { opacity:1; transform:scale(1)   translateY(0)    }
}

/* ── Header ── */
#pe-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 18px 22px 12px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  background: rgba(10,8,24,.98);
  flex-shrink: 0;
}
#pe-title {
  font: 700 11px/1 'Segoe UI',sans-serif; letter-spacing: .14em;
  text-transform: uppercase; color: rgba(155,135,255,.70);
}
#pe-sub {
  font: 10px/1 'Segoe UI',sans-serif;
  color: rgba(155,135,255,.35); margin-top: 4px;
}
#pe-close-btn {
  background: none; border: none;
  color: rgba(255,255,255,.32); font-size: 15px; cursor: pointer;
  padding: 2px 6px; border-radius: 6px; transition: color .15s;
}
#pe-close-btn:hover { color: rgba(255,255,255,.72); }

/* ── Presets bar ── */
#pe-presets-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 22px 8px; flex-shrink: 0;
  border-bottom: 1px solid rgba(255,255,255,.05);
  background: rgba(10,8,24,.90);
}
.pe-presets-label {
  font: 10px/1 'Segoe UI',sans-serif;
  color: rgba(155,135,255,.38); white-space: nowrap;
}
#pe-preset-chips { display: flex; gap: 5px; flex: 1; flex-wrap: wrap; }
.pe-preset-chip {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(155,135,255,.14);
  border-radius: 8px; color: rgba(175,160,255,.55);
  font: 11px/1 'Segoe UI',sans-serif;
  padding: 5px 10px; cursor: pointer; transition: all .14s;
  white-space: nowrap;
}
.pe-preset-chip:hover {
  background: rgba(155,135,255,.12);
  border-color: rgba(155,135,255,.30);
  color: rgba(210,200,255,.85);
}
.pe-preset-chip.pe-preset-active {
  background: rgba(155,135,255,.20);
  border-color: rgba(155,135,255,.45);
  color: rgba(220,210,255,.95);
}
#pe-preset-actions { display: flex; gap: 5px; }
.pe-action-btn {
  background: none; border: 1px solid rgba(155,135,255,.14);
  border-radius: 8px; color: rgba(155,135,255,.45);
  font: 10px/1 'Segoe UI',sans-serif;
  padding: 4px 9px; cursor: pointer; transition: all .14s;
}
.pe-action-btn:hover {
  border-color: rgba(155,135,255,.35);
  color: rgba(190,175,255,.75);
}

/* ── Main two-col layout ── */
#pe-main {
  display: flex; flex: 1; min-height: 0;
}

/* ── Sticky nav ── */
#pe-nav {
  width: 130px; flex-shrink: 0;
  background: rgba(8,6,20,.70);
  border-right: 1px solid rgba(255,255,255,.05);
  overflow-y: auto; padding: 12px 0;
  scrollbar-width: none;
}
#pe-nav::-webkit-scrollbar { display: none; }
.pe-nav-item {
  display: block; width: 100%; text-align: left;
  background: none; border: none;
  padding: 8px 16px; cursor: pointer;
  font: 11px/1.3 'Segoe UI',sans-serif;
  color: rgba(155,135,255,.40);
  transition: all .14s; border-left: 2px solid transparent;
}
.pe-nav-item:hover { color: rgba(190,175,255,.75); background: rgba(155,135,255,.05); }
.pe-nav-item.pe-nav-active {
  color: rgba(210,200,255,.90);
  border-left-color: rgba(155,135,255,.65);
  background: rgba(155,135,255,.08);
}
.pe-nav-sep { height: 1px; background: rgba(255,255,255,.05); margin: 8px 12px; }
.pe-nav-radar { color: rgba(155,135,255,.35) !important; }
.pe-nav-radar.pe-nav-active { color: rgba(210,200,255,.85) !important; }

/* ── Scrollable body ── */
#pe-body {
  flex: 1; overflow-y: auto; padding: 16px 20px 24px;
  scrollbar-width: thin;
  scrollbar-color: rgba(155,135,255,.12) transparent;
}
#pe-body::-webkit-scrollbar { width: 4px; }
#pe-body::-webkit-scrollbar-track { background: transparent; }
#pe-body::-webkit-scrollbar-thumb { background: rgba(155,135,255,.15); border-radius: 4px; }

/* ── Group sections ── */
.pe-group { margin-bottom: 28px; }
.pe-group:last-child { margin-bottom: 8px; }
.pe-gh {
  font: 700 10px/1 'Segoe UI',sans-serif;
  letter-spacing: .14em; text-transform: uppercase;
  color: rgba(155,135,255,.50);
  padding-bottom: 8px; margin-bottom: 12px;
  border-bottom: 1px solid rgba(155,135,255,.10);
}

/* ── Rows ── */
.pe-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 10px 12px; margin-bottom: 4px;
  border-radius: 10px; transition: background .14s;
}
.pe-row:hover { background: rgba(155,135,255,.04); }
.pe-lbl-wrap { flex-shrink: 0; width: 160px; }
.pe-lbl {
  font: 500 12px/1 'Segoe UI',sans-serif;
  color: rgba(210,200,255,.85);
}
.pe-tip {
  font: 10px/1.4 'Segoe UI',sans-serif;
  color: rgba(155,135,255,.35);
  margin-top: 4px;
}
.pe-ctrl { flex: 1; }

/* ── Slider ── */
.pe-sw {
  display: flex; align-items: center; gap: 7px; width: 100%;
}
.pe-el {
  font: 9px/1 'Segoe UI',sans-serif;
  color: rgba(155,135,255,.35);
  white-space: nowrap; min-width: 56px;
}
.pe-er { text-align: right; }
.pe-sl-wrap {
  flex: 1; position: relative; height: 18px;
  display: flex; align-items: center;
}
.pe-sl {
  width: 100%; position: relative; z-index: 2;
  -webkit-appearance: none; appearance: none;
  background: transparent; height: 18px; cursor: pointer;
}
.pe-sl::-webkit-slider-runnable-track {
  height: 3px; border-radius: 3px;
  background: rgba(155,135,255,.15);
}
.pe-sl::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: rgba(155,135,255,.85);
  box-shadow: 0 0 6px rgba(155,135,255,.55), 0 0 0 2px rgba(10,8,24,1);
  margin-top: -5.5px; cursor: pointer;
  transition: background .12s, box-shadow .12s;
}
.pe-sl:hover::-webkit-slider-thumb {
  background: rgba(190,175,255,1);
  box-shadow: 0 0 10px rgba(155,135,255,.80), 0 0 0 2px rgba(10,8,24,1);
}
.pe-sl::-moz-range-track {
  height: 3px; border-radius: 3px;
  background: rgba(155,135,255,.15);
}
.pe-sl::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: rgba(155,135,255,.85);
  border: 2px solid rgba(10,8,24,1);
  box-shadow: 0 0 6px rgba(155,135,255,.55);
  cursor: pointer;
}
.pe-sl-fill {
  position: absolute; left: 0; top: 50%;
  transform: translateY(-50%);
  height: 3px; border-radius: 3px;
  background: linear-gradient(90deg,rgba(120,100,255,.70),rgba(180,140,255,.90));
  pointer-events: none; z-index: 1;
  transition: width .04s;
}
.pe-val {
  font: 300 13px/1 'Segoe UI',sans-serif;
  color: rgba(220,210,255,.80);
  min-width: 16px; text-align: center;
}

/* ── Toggle ── */
.pe-toggle {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
}
.pe-toggle input[type=checkbox] { display: none; }
.pe-track {
  width: 36px; height: 20px; border-radius: 10px;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(155,135,255,.14);
  position: relative; transition: background .18s, border-color .18s;
  flex-shrink: 0;
}
.pe-toggle input:checked + .pe-track {
  background: rgba(155,135,255,.32);
  border-color: rgba(155,135,255,.50);
}
.pe-thumb {
  position: absolute; top: 3px; left: 3px;
  width: 12px; height: 12px; border-radius: 50%;
  background: rgba(180,165,255,.70);
  box-shadow: 0 1px 4px rgba(0,0,0,.50);
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), background .18s;
}
.pe-toggle input:checked ~ .pe-track .pe-thumb,
.pe-toggle input:checked + .pe-track .pe-thumb {
  transform: translateX(16px);
  background: rgba(210,200,255,1);
}
.pe-tog-lbl {
  font: 11px/1 'Segoe UI',sans-serif;
  color: rgba(155,135,255,.45);
}

/* ── Choice chips ── */
.pe-choices { display: flex; gap: 5px; flex-wrap: wrap; }
.pe-choice {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(155,135,255,.14);
  border-radius: 8px; color: rgba(175,160,255,.55);
  font: 11px/1.3 'Segoe UI',sans-serif;
  padding: 6px 12px; cursor: pointer;
  transition: all .14s; text-align: left;
  display: flex; flex-direction: column; gap: 2px;
}
.pe-choice:hover {
  background: rgba(155,135,255,.10);
  border-color: rgba(155,135,255,.28);
  color: rgba(200,188,255,.85);
}
.pe-choice.active {
  background: rgba(155,135,255,.20);
  border-color: rgba(155,135,255,.48);
  color: rgba(220,210,255,.95);
  box-shadow: 0 0 10px rgba(155,135,255,.15);
}
.pe-choice-desc {
  font: 9.5px/1.3 'Segoe UI',sans-serif;
  color: rgba(155,135,255,.40);
  display: block;
}
.pe-choice.active .pe-choice-desc { color: rgba(155,135,255,.55); }

/* ── Radar ── */
.pe-radar-wrap {
  display: flex; align-items: center; gap: 20px;
  flex-wrap: wrap; padding: 8px 0;
}
#pe-radar { flex-shrink: 0; }
#pe-summary-box {
  flex: 1; min-width: 180px;
}
.pe-summary-label {
  font: 700 9px/1 'Segoe UI',sans-serif;
  letter-spacing: .12em; text-transform: uppercase;
  color: rgba(155,135,255,.38); margin-bottom: 8px;
}
#pe-summary {
  font: 12.5px/1.6 'Segoe UI',sans-serif;
  color: rgba(200,190,255,.72);
}

/* ── Footer ── */
#pe-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 22px 16px;
  border-top: 1px solid rgba(255,255,255,.06);
  background: rgba(10,8,24,.98);
  flex-shrink: 0;
}
#pe-footer-mid { flex: 1; text-align: center; }
#pe-change-indicator {
  font: 10px/1 'Segoe UI',sans-serif;
  color: rgba(155,135,255,.45);
  opacity: 0; transition: opacity .3s;
}
#pe-change-indicator.visible { opacity: 1; }
.pe-reset {
  padding: 8px 16px; border-radius: 10px; cursor: pointer;
  font: 12px/1 'Segoe UI',sans-serif;
  background: none; border: 1px solid rgba(255,255,255,.08);
  color: rgba(200,185,255,.40); transition: all .14s;
}
.pe-reset:hover {
  border-color: rgba(255,80,80,.30);
  color: rgba(255,140,140,.60);
}
.pe-done {
  padding: 8px 20px; border-radius: 10px; cursor: pointer;
  font: 600 12px/1 'Segoe UI',sans-serif;
  background: rgba(155,135,255,.16);
  border: 1px solid rgba(155,135,255,.32);
  color: rgba(220,210,255,.90); transition: all .14s;
}
.pe-done:hover {
  background: rgba(155,135,255,.28);
  box-shadow: 0 0 14px rgba(155,135,255,.20);
}

/* ── Open button (in settings panel) ── */
#pe-open-btn {
  padding: 7px 14px; border-radius: 10px; cursor: pointer;
  font: 600 12px/1 'Segoe UI',sans-serif;
  background: rgba(155,135,255,.14);
  border: 1px solid rgba(155,135,255,.28);
  color: rgba(210,200,255,.80);
  transition: all .18s;
}
#pe-open-btn:hover {
  background: rgba(155,135,255,.26);
  box-shadow: 0 0 14px rgba(155,135,255,.22);
  transform: translateY(-1px);
}

@media (max-width: 600px) {
  #pe-panel { width: 98vw; max-height: 92vh; }
  #pe-nav { display: none; }
  .pe-lbl-wrap { width: 120px; }
}
    `;
    document.head.appendChild(style);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return { init, open, close };

})();
