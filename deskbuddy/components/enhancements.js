/**
 * DeskBuddy Enhancements Module
 * ──────────────────────────────────────────────────────────────────
 * New features added without touching the core modules:
 *
 *  1. QuickPresets  — one-click session duration chips (5/15/25/45/60/90m)
 *  2. FocusQuotes   — rotating motivational quotes during active sessions
 *  3. StreakCounter  — consecutive days with at least 1 completed session
 *  4. AmbientPlayer — in-app ambient sound mini-player (rain/café/nature/space)
 *  5. MoodPicker    — emoji mood stamp at session end
 *  6. PulseIndicator — subtle live indicator showing focus quality in PiP
 *
 * Usage: called once from renderer.js main() after all modules are loaded.
 *   Enhancements.init();
 */
const Enhancements = (() => {

  // ── 1. Quick Preset Chips ─────────────────────────────────────────────────
  // Inject duration preset chips into the session-idle panel.

  const PRESETS = [
    { label: '5m',  mins: 5  },
    { label: '15m', mins: 15 },
    { label: '25m', mins: 25, badge: '✦' },  // Pomodoro classic
    { label: '45m', mins: 45 },
    { label: '1h',  mins: 60 },
    { label: '90m', mins: 90 },
  ];

  function _getDurationSeconds() {
    const h = parseInt(document.getElementById('duration-h')?.value, 10) || 0;
    const m = parseInt(document.getElementById('duration-m')?.value, 10) || 0;
    const s = parseInt(document.getElementById('duration-s')?.value, 10) || 0;
    return h * 3600 + m * 60 + s;
  }

  function _setDurationSeconds(totalSecs) {
    totalSecs = Math.max(0, Math.min(86399, Math.round(totalSecs)));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const hEl = document.getElementById('duration-h');
    const mEl = document.getElementById('duration-m');
    const sEl = document.getElementById('duration-s');
    if (hEl) hEl.value = String(h);
    if (mEl) mEl.value = String(m);
    if (sEl) sEl.value = String(s);
  }

  function _initQuickPresets() {
    // Find injection point — before the start button
    const startBtn = document.getElementById('start-session');
    if (!startBtn) return;
    const parent = startBtn.parentNode;
    if (!parent) return;

    // Don't double-init
    if (document.getElementById('enh-quick-presets')) return;

    const row = document.createElement('div');
    row.id = 'enh-quick-presets';
    row.className = 'enh-quick-presets';

    PRESETS.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'enh-preset-chip';
      btn.dataset.mins = p.mins;
      btn.innerHTML = p.badge
        ? `${p.label}<span class="enh-preset-badge">${p.badge}</span>`
        : p.label;
      btn.title = `Set duration to ${p.label}`;
      btn.addEventListener('click', () => {
        _setDurationSeconds(p.mins * 60);
        // Pulse active state
        row.querySelectorAll('.enh-preset-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Brief haptic-style animation
        btn.classList.add('pop');
        setTimeout(() => btn.classList.remove('pop'), 320);
      });
      row.appendChild(btn);
    });

    parent.insertBefore(row, startBtn);

    // Highlight whichever preset matches the current duration
    _syncPresetHighlight(row);

    // Keep in sync when user manually adjusts the steppers
    ['duration-h','duration-m','duration-s'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => _syncPresetHighlight(row));
    });
    document.getElementById('duration-inc')?.addEventListener('click', () =>
      setTimeout(() => _syncPresetHighlight(row), 20));
    document.getElementById('duration-dec')?.addEventListener('click', () =>
      setTimeout(() => _syncPresetHighlight(row), 20));
  }

  function _syncPresetHighlight(row) {
    if (!row) return;
    const curMins = Math.round(_getDurationSeconds() / 60);
    row.querySelectorAll('.enh-preset-chip').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.mins) === curMins);
    });
  }


  // ── 2. Focus Quotes ───────────────────────────────────────────────────────
  // Rotate through motivational quotes during active sessions.

  const QUOTES = [
    { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { text: "Focus is the ability to say no to a thousand things.", author: "Steve Jobs" },
    { text: "Small steps every day lead to giant leaps.", author: "" },
    { text: "One task at a time. That's how mountains move.", author: "" },
    { text: "Deep work is the superpower of the 21st century.", author: "Cal Newport" },
    { text: "Where focus goes, energy flows.", author: "" },
    { text: "The work is always worth it.", author: "" },
    { text: "Clarity comes from action, not thought.", author: "" },
    { text: "Every expert was once a beginner.", author: "" },
    { text: "Your future self is watching. Make them proud.", author: "" },
    { text: "Progress, not perfection.", author: "" },
    { text: "Difficult roads lead to beautiful destinations.", author: "" },
    { text: "You don't have to be perfect to be great.", author: "" },
    { text: "Consistency beats intensity every time.", author: "" },
    { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
    { text: "The mind is a powerful thing. Feed it well.", author: "" },
    { text: "Silence is the greatest weapon of the focused mind.", author: "" },
    { text: "Take a breath. You're doing better than you think.", author: "" },
  ];

  let _quoteEl = null;
  let _quoteInterval = null;
  let _quoteIdx = Math.floor(Math.random() * QUOTES.length);

  function _initFocusQuotes() {
    // Create the quote element and inject into session-active panel
    const activePanel = document.getElementById('session-active');
    if (!activePanel || document.getElementById('enh-focus-quote')) return;

    const container = document.createElement('div');
    container.id = 'enh-focus-quote';
    container.className = 'enh-focus-quote';
    container.innerHTML = `
      <div class="enh-quote-text"></div>
      <div class="enh-quote-author"></div>
    `;
    _quoteEl = container;

    // Insert at the bottom of the active panel
    activePanel.appendChild(container);

    // Show first quote immediately
    _showNextQuote();
  }

  function _showNextQuote() {
    if (!_quoteEl) return;
    const q = QUOTES[_quoteIdx % QUOTES.length];
    _quoteIdx = (_quoteIdx + 1) % QUOTES.length;

    const textEl = _quoteEl.querySelector('.enh-quote-text');
    const authorEl = _quoteEl.querySelector('.enh-quote-author');

    // Fade out → update → fade in
    _quoteEl.classList.add('enh-quote-fading');
    setTimeout(() => {
      if (textEl)   textEl.textContent   = `"${q.text}"`;
      if (authorEl) authorEl.textContent = q.author ? `— ${q.author}` : '';
      _quoteEl.classList.remove('enh-quote-fading');
    }, 400);
  }

  function _startQuotes() {
    if (_quoteInterval) return;
    _showNextQuote();
    _quoteInterval = setInterval(_showNextQuote, 45000); // rotate every 45s
  }

  function _stopQuotes() {
    if (_quoteInterval) { clearInterval(_quoteInterval); _quoteInterval = null; }
  }


  // ── 3. Streak Counter ─────────────────────────────────────────────────────
  // Counts consecutive calendar days with at least one completed session.

  function _calcStreak() {
    if (typeof Session === 'undefined' || !Session.getHistory) return 0;
    const history = Session.getHistory();
    if (!history.length) return 0;

    // Build a Set of date strings for days with completed sessions
    const completedDays = new Set();
    history.forEach(s => {
      if (s.outcome === 'COMPLETED' && s.date) {
        completedDays.add(new Date(s.date).toDateString());
      }
    });

    // Walk backward from today counting consecutive days
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      if (completedDays.has(d.toDateString())) {
        streak++;
      } else if (i > 0) {
        // Gap found — stop (allow today to not have a session yet)
        break;
      }
    }
    return streak;
  }

  function _initStreakCounter() {
    // Find the session idle panel to add streak widget
    const idlePanel = document.getElementById('session-idle');
    if (!idlePanel || document.getElementById('enh-streak')) return;

    const streak = _calcStreak();
    if (streak < 2) return; // only show when streaks are meaningful

    const el = document.createElement('div');
    el.id = 'enh-streak';
    el.className = 'enh-streak';
    el.innerHTML = `
      <span class="enh-streak-flame">🔥</span>
      <span class="enh-streak-count">${streak}</span>
      <span class="enh-streak-label">day streak</span>
    `;
    el.title = `You've had ${streak} consecutive day${streak !== 1 ? 's' : ''} with a completed session!`;

    // Insert at the top of idle panel
    idlePanel.insertBefore(el, idlePanel.firstChild);
  }


  // ── 4. Ambient Mini-Player ─────────────────────────────────────────────────
  // Looping ambient sounds: rain, café, nature, lofi beats.
  // Uses the Web Audio API oscillators/noise for sounds that work offline.
  // No external files required.

  const AMBIENT_PRESETS = [
    { id: 'off',    label: '○',    title: 'Off'         },
    { id: 'rain',   label: '🌧',   title: 'Rain'        },
    { id: 'cafe',   label: '☕',   title: 'Café'        },
    { id: 'forest', label: '🌿',   title: 'Forest'      },
    { id: 'space',  label: '✦',    title: 'Deep Space'  },
  ];

  let _ambientCtx = null;
  let _ambientNodes = [];
  let _ambientCurrent = 'off';
  let _ambientVol = 0.18;

  function _getAudioCtx() {
    if (!_ambientCtx) {
      _ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_ambientCtx.state === 'suspended') _ambientCtx.resume();
    return _ambientCtx;
  }

  function _stopAmbient() {
    _ambientNodes.forEach(n => {
      try { n.stop?.(); } catch (_) {}
      try { n.disconnect(); } catch (_) {}
    });
    _ambientNodes = [];
  }

  function _makeNoise(ctx, gain, type = 'pink') {
    // Pink noise via filtered white noise
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + white*0.0555179; b1 = 0.99332*b1 + white*0.0750759;
      b2 = 0.96900*b2 + white*0.1538520; b3 = 0.86650*b3 + white*0.3104856;
      b4 = 0.55000*b4 + white*0.5329522; b5 = -0.7616*b5 - white*0.0168980;
      data[i] = (b0+b1+b2+b3+b4+b5+b6 + white*0.5362) / 7;
      b6 = white * 0.115926;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    src.start();
    return src;
  }

  function _playRain() {
    const ctx = _getAudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = _ambientVol * 1.2;
    masterGain.connect(ctx.destination);

    // Heavy rain: pink noise through a high-pass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.7;
    filter.connect(masterGain);

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 1.0;
    noiseGain.connect(filter);

    const noise = _makeNoise(ctx, noiseGain);
    _ambientNodes.push(noise, noiseGain, filter, masterGain);
  }

  function _playCafe() {
    const ctx = _getAudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = _ambientVol * 0.9;
    masterGain.connect(ctx.destination);

    // Café: pink noise (murmur) + subtle low hum
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.4;
    noiseGain.connect(noiseFilter);
    noiseFilter.connect(masterGain);
    const noise = _makeNoise(ctx, noiseGain);

    // Low rumble
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 55;
    oscGain.gain.value = 0.04;
    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start();

    _ambientNodes.push(noise, noiseGain, noiseFilter, osc, oscGain, masterGain);
  }

  function _playForest() {
    const ctx = _getAudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = _ambientVol;
    masterGain.connect(ctx.destination);

    // Gentle breeze: band-pass pink noise at ~600 Hz
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.5;
    filter.connect(masterGain);
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.6;
    noiseGain.connect(filter);
    const noise = _makeNoise(ctx, noiseGain);

    // Sporadic high chirp (bird-like) using LFO modulation
    const chirp = ctx.createOscillator();
    const chirpGain = ctx.createGain();
    chirp.type = 'sine';
    chirp.frequency.value = 2400;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.15;
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain);
    lfoGain.connect(chirpGain.gain);
    chirpGain.gain.value = 0.0;
    chirp.connect(chirpGain);
    chirpGain.connect(masterGain);
    chirp.start(); lfo.start();

    _ambientNodes.push(noise, noiseGain, filter, chirp, chirpGain, lfo, lfoGain, masterGain);
  }

  function _playSpace() {
    const ctx = _getAudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = _ambientVol * 0.7;
    masterGain.connect(ctx.destination);

    // Deep space drone: detuned oscillators
    [[55, 0.018],[73, 0.014],[110, 0.010],[165, 0.006]].forEach(([freq, vol]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.value = vol;
      osc.connect(g); g.connect(masterGain);
      osc.start();
      _ambientNodes.push(osc, g);
    });

    // Very subtle noise undercurrent
    const ng = ctx.createGain(); ng.gain.value = 0.04;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 180;
    ng.connect(flt); flt.connect(masterGain);
    _ambientNodes.push(_makeNoise(ctx, ng), ng, flt, masterGain);
  }

  function _playAmbient(id) {
    _stopAmbient();
    _ambientCurrent = id;
    if (id === 'off') return;
    try {
      if (id === 'rain')   _playRain();
      if (id === 'cafe')   _playCafe();
      if (id === 'forest') _playForest();
      if (id === 'space')  _playSpace();
    } catch (e) {
      console.warn('[Enhancements] Ambient audio failed:', e);
    }
  }

  function _initAmbientPlayer() {
    // Inject compact ambient player widget into the settings Sound section
    // OR into the active session panel as a quick toggle row
    const soundSection = document.getElementById('mute-preset-select')?.closest('.settings-subsection-body');
    if (!soundSection || document.getElementById('enh-ambient-player')) return;

    const row = document.createElement('div');
    row.id = 'enh-ambient-player';
    row.className = 'settings-row enh-ambient-row';
    row.innerHTML = `
      <div>
        <div class="settings-row-label">Ambient sounds</div>
        <div class="settings-row-sublabel" id="enh-ambient-label">Off</div>
      </div>
      <div class="enh-ambient-chips" id="enh-ambient-chips"></div>
    `;

    const chipsContainer = row.querySelector('#enh-ambient-chips');
    AMBIENT_PRESETS.forEach(preset => {
      const btn = document.createElement('button');
      btn.className = 'enh-ambient-chip';
      btn.dataset.ambient = preset.id;
      btn.textContent = preset.label;
      btn.title = preset.title;
      btn.classList.toggle('active', preset.id === _ambientCurrent);
      btn.addEventListener('click', () => {
        _playAmbient(preset.id);
        chipsContainer.querySelectorAll('.enh-ambient-chip').forEach(b =>
          b.classList.toggle('active', b.dataset.ambient === preset.id));
        const lbl = document.getElementById('enh-ambient-label');
        if (lbl) lbl.textContent = preset.id === 'off' ? 'Off' : preset.title;
        // Persist
        if (typeof Settings !== 'undefined') Settings.set('ambientPreset', preset.id);
      });
      chipsContainer.appendChild(btn);
    });

    // Volume slider (separate from main volume)
    const volRow = document.createElement('div');
    volRow.className = 'settings-row';
    volRow.innerHTML = `
      <div class="settings-row-label">Ambient volume</div>
      <input type="range" id="enh-ambient-vol" class="settings-slider" min="0" max="100" step="5" value="${Math.round(_ambientVol*100)}">
    `;
    volRow.querySelector('#enh-ambient-vol').addEventListener('input', e => {
      _ambientVol = parseInt(e.target.value) / 100;
      // Update currently playing ambient
      _ambientNodes.forEach(n => {
        if (n.gain && n.constructor.name === 'GainNode' && n === _ambientNodes[_ambientNodes.length - 1]) {
          n.gain.value = _ambientVol;
        }
      });
      if (typeof Settings !== 'undefined') Settings.set('ambientVolume', _ambientVol);
    });

    soundSection.appendChild(row);
    soundSection.appendChild(volRow);

    // Restore saved preset
    if (typeof Settings !== 'undefined') {
      const saved = Settings.get('ambientPreset');
      const savedVol = Settings.get('ambientVolume');
      if (savedVol != null) _ambientVol = savedVol;
      if (saved && saved !== 'off') {
        _playAmbient(saved);
        chipsContainer.querySelectorAll('.enh-ambient-chip').forEach(b =>
          b.classList.toggle('active', b.dataset.ambient === saved));
        const lbl = document.getElementById('enh-ambient-label');
        const preset = AMBIENT_PRESETS.find(p => p.id === saved);
        if (lbl && preset) lbl.textContent = preset.title;
      }
    }
  }


  // ── 5. Mood Picker ────────────────────────────────────────────────────────
  // Quick emoji mood stamp on the session complete share card.

  const MOODS = [
    { emoji: '🔥', label: 'On fire' },
    { emoji: '✨', label: 'Sparkling' },
    { emoji: '😌', label: 'Calm' },
    { emoji: '💪', label: 'Strong' },
    { emoji: '🧠', label: 'Brainy' },
    { emoji: '😴', label: 'Tired' },
    { emoji: '😤', label: 'Determined' },
    { emoji: '🎯', label: 'Focused' },
  ];

  function _initMoodPicker() {
    // Attach to outcome screen (completed state shows share card)
    // Add a mood row below the share card title
    const shareArea = document.getElementById('session-outcome') ||
                      document.querySelector('.share-card-header');
    if (!shareArea || document.getElementById('enh-mood-picker')) return;

    const row = document.createElement('div');
    row.id = 'enh-mood-picker';
    row.className = 'enh-mood-picker';
    row.setAttribute('aria-label', 'How are you feeling?');
    row.innerHTML = `<div class="enh-mood-label">How are you feeling?</div><div class="enh-mood-emojis" id="enh-mood-emojis"></div>`;

    const grid = row.querySelector('#enh-mood-emojis');
    MOODS.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'enh-mood-btn';
      btn.textContent = m.emoji;
      btn.title = m.label;
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.enh-mood-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        btn.classList.add('pop');
        setTimeout(() => btn.classList.remove('pop'), 350);
      });
      grid.appendChild(btn);
    });

    // Inject after the outcome label
    const outcomeLabel = document.getElementById('outcome-label');
    if (outcomeLabel?.parentNode) {
      outcomeLabel.parentNode.insertBefore(row, outcomeLabel.nextSibling);
    }
  }


  // ── 6. Pulse Indicator ────────────────────────────────────────────────────
  // In PiP mode: a tiny colored ring segment on #world that shows focus quality.
  // Green = focused, amber = drifting, red = distracted.

  let _pulseEl = null;

  function _initPulseIndicator() {
    const world = document.getElementById('world');
    if (!world || document.getElementById('enh-pulse')) return;

    const el = document.createElement('div');
    el.id = 'enh-pulse';
    el.className = 'enh-pulse';
    world.appendChild(el);
    _pulseEl = el;
  }

  function _updatePulse() {
    if (!_pulseEl) return;
    const timerState = document.body.dataset.timerState || 'FOCUSED';
    const stateMap = {
      FOCUSED:    'enh-pulse-focused',
      DRIFTING:   'enh-pulse-drifting',
      DISTRACTED: 'enh-pulse-distracted',
      CRITICAL:   'enh-pulse-critical',
    };
    const cls = stateMap[timerState] || '';
    ['enh-pulse-focused','enh-pulse-drifting','enh-pulse-distracted','enh-pulse-critical']
      .forEach(c => _pulseEl.classList.toggle(c, c === cls));
    _pulseEl.style.display = document.body.classList.contains('pip-mode') && timerState !== 'FAILED' ? '' : 'none';
  }


  // ── Main init ─────────────────────────────────────────────────────────────

  function init() {
    // Wait for DOM to be ready — called after _wireUI
    setTimeout(() => {
      _initQuickPresets();
      _initFocusQuotes();
      _initStreakCounter();
      _initAmbientPlayer();
      _initMoodPicker();
      _initPulseIndicator();

      // Wire session state → quotes + pulse
      if (typeof Session !== 'undefined' && Session.onSessionStateChange) {
        Session.onSessionStateChange((newState) => {
          if (newState === 'ACTIVE') {
            _startQuotes();
          } else {
            _stopQuotes();
          }
          _updatePulse();
        });
      }

      // Poll pulse every 1s (cheap)
      setInterval(_updatePulse, 1000);

      // Refresh streak counter when history panel is opened
      document.getElementById('hp-icon')?.addEventListener('click', () => {
        const existing = document.getElementById('enh-streak');
        if (existing) existing.remove();
        _initStreakCounter();
      });

    }, 600); // give existing init a head start
  }

  return { init };
})();
