/**
 * Sounds — Procedural audio engine for DeskBuddy.
 *
 * Full replacement for audio.js. Three responsibilities:
 *   1. Emotion voice sounds — formant synthesis, triggered by brain state changes.
 *   2. Timer tick sounds    — played by Timer via Sounds.play(name).
 *   3. Master volume control — all audio routed through a single gain node.
 *
 * Design rules:
 *   - Web Audio API only. No files, no libraries.
 *   - Max gain on any individual source gain node: 0.12. Ever.
 *   - Every sound must be uniquely identifiable by ear with no visual context.
 *   - Nothing should be irritating. If it could annoy, it has a per-sound cooldown.
 *   - AudioContext created on first user gesture (browser autoplay policy).
 *
 * Architecture:
 *   source nodes → per-sound gainNode (≤0.12) → masterGain → destination
 *   masterGain enables setVolume/mute without touching individual sounds.
 */
const Sounds = (() => {

  let ctx         = null;
  let masterGain  = null;
  let ready       = false;
  let _muted      = false;
  let _savedGain  = 0.7;

  const cooldowns = {};

  // Per-sound minimum gap between plays (ms).
  // Tick sounds: short gap so rapid timer ticks feel alive, not robotic.
  // Emotion sounds: longer gaps to prevent overlap during animated sequences.
  const COOLDOWN = {
    focused_tick:    800,
    drifting_tick:   800,
    distracted_tick: 800,
    giggle:          800,
    coo:             800,
    curious:         800,
    yawn:            800,
    suspicious:      800,
    pouty:           800,
    grumpy:          800,
    scared:          800,
    sad:             800,
    crying:          800,
    overjoyed:       800,
    sulking:         800,
    focused:         800,
    excited:        1200,
    shy:            1200,
    love:           3000,
    startled:       1200,
    surprise:        800,
    relief:          800,
    userLeft:        800,
    welcomeBack:     800,
  };

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    const start = () => {
      if (ready) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = new GainNode(ctx, { gain: _savedGain });
        masterGain.connect(ctx.destination);
        if (ctx.state === 'suspended') ctx.resume();
        ready = true;
        setInterval(_pollEmotion,      150);
        setInterval(_pollExpressions,  400);
        setInterval(_pollFacePresence, 300);
      } catch (e) { console.warn('[Sounds] Init failed:', e); }
    };
    // Start on first gesture — browser autoplay policy requires user interaction
    document.addEventListener('keydown',   start, { once: true });
    document.addEventListener('mousedown', start, { once: true });
    document.addEventListener('click',     start, { once: true });
    // Fallback: Electron window often has no explicit interaction before Timer starts
    setTimeout(start, 500);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * play(name) — trigger a named sound by string.
   * Used by Timer to fire tick sounds without coupling to internals.
   * Unknown names are silently ignored (future-proof).
   */
  function play(name) {
    const dispatch = {
      focused_tick:    _focused_tick,
      drifting_tick:   _drifting_tick,
      distracted_tick: _distracted_tick,
    };
    if (dispatch[name]) dispatch[name]();
  }

  function setVolume(v) {
    _savedGain = Math.max(0, Math.min(1, v));
    if (masterGain && !_muted) masterGain.gain.value = _savedGain;
  }

  function mute() {
    _muted = true;
    if (masterGain) masterGain.gain.value = 0;
  }

  function unmute() {
    _muted = false;
    if (masterGain) masterGain.gain.value = _savedGain;
  }

  // ── Guard ──────────────────────────────────────────────────────────────────

  function _ok(type) {
    if (!ready || !ctx) return false;
    // Resume suspended context — browser may suspend after inactivity
    if (ctx.state === 'suspended') { ctx.resume(); return false; }
    const now = Date.now();
    const ms  = COOLDOWN[type] || 800;
    if (cooldowns[type] && now - cooldowns[type] < ms) return false;
    cooldowns[type] = now;
    return true;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * _connect(node, gainValue)
   * Connects node → gainNode → masterGain → destination.
   * Returns gainNode for envelope control.
   * onended cleanup prevents node accumulation in long sessions.
   */
  function _connect(node, gainValue) {
    const gainNode = new GainNode(ctx, { gain: gainValue });
    node.connect(gainNode);
    gainNode.connect(masterGain);
    node.onended = () => {
      try { gainNode.disconnect(); } catch (e) {}
      try { node.disconnect(); } catch (e) {}
    };
    return gainNode;
  }

  /**
   * _osc(type, freq, startTime, duration, gainValue, options)
   * Single oscillator with full ADSR envelope, optional pitch slide,
   * optional vibrato LFO, optional biquad filter.
   *
   * options:
   *   attack  — seconds to ramp from 0 to gainValue
   *   decay   — seconds to ramp from peak to sustainLevel (0 = skip)
   *   sustain — level after decay (fraction of gainValue; ignored if decay=0)
   *   release — seconds to ramp to 0 at end of duration
   *   slideTo — end frequency (exponential ramp over full duration)
   *   vibRate — LFO frequency (Hz) for frequency vibrato
   *   vibDepth— LFO gain (Hz deviation)
   *   filter  — { type, frequency, Q } — biquad filter inserted before gainNode
   */
  function _osc(type, freq, startTime, duration, gainValue, options) {
    const o       = options || {};
    const attack  = o.attack  || 0.004;
    const decay   = o.decay   || 0;
    const release = o.release || 0;

    const osc      = new OscillatorNode(ctx, { type, frequency: freq });
    const gainNode = new GainNode(ctx, { gain: 0 });
    let   filter   = null;

    if (o.filter) {
      filter = new BiquadFilterNode(ctx, {
        type:      o.filter.type || 'lowpass',
        frequency: o.filter.frequency,
        Q:         o.filter.Q || 1.0,
      });
      osc.connect(filter);
      filter.connect(gainNode);
    } else {
      osc.connect(gainNode);
    }
    gainNode.connect(masterGain);

    // Cleanup prevents memory leaks in sessions that fire hundreds of ticks
    osc.onended = () => {
      try { gainNode.disconnect(); } catch (e) {}
      if (filter) try { filter.disconnect(); } catch (e) {}
      try { osc.disconnect(); } catch (e) {}
    };

    // ADSR envelope
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(gainValue, startTime + attack);

    if (decay > 0) {
      // AD(S) path: ramp down after attack
      const sustainLevel = (o.sustain !== undefined) ? o.sustain : gainValue;
      const decayEnd     = startTime + attack + decay;
      gainNode.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
      // If sustain is non-zero and there is explicit release, hold then ramp out
      if (sustainLevel > 0 && release > 0) {
        const releaseStart = startTime + duration - release;
        if (releaseStart > decayEnd) {
          gainNode.gain.setValueAtTime(sustainLevel, releaseStart);
        }
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
      }
    } else {
      // Hold at peak until release begins
      if (release > 0) {
        const releaseStart = startTime + duration - release;
        gainNode.gain.setValueAtTime(gainValue, Math.max(startTime + attack, releaseStart));
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
      }
    }

    // Pitch slide — exponential ramp feels natural; linear sounds mechanical
    if (o.slideTo !== undefined) {
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(0.001, o.slideTo),
        startTime + duration
      );
    }

    // Vibrato — frequency LFO
    if (o.vibRate) {
      const lfo  = new OscillatorNode(ctx, { type: 'sine', frequency: o.vibRate });
      const lfoG = new GainNode(ctx, { gain: o.vibDepth || 5 });
      lfo.connect(lfoG);
      lfoG.connect(osc.frequency);
      lfo.start(startTime);
      lfo.stop(startTime + duration + 0.02);
    }

    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
    return gainNode;
  }

  /**
   * _noise(startTime, duration, gainValue, options)
   * White noise buffer with optional highpass, bandpass, or lowpass filter.
   * Used for breath sounds and percussive texture.
   * options: { highPass, bandPass, bandQ, lowPass, lowQ, attack, release }
   */
  function _noise(startTime, duration, gainValue, options) {
    const o        = options || {};
    const sRate    = ctx.sampleRate;
    const len      = Math.max(1, Math.floor(sRate * duration));
    const buffer   = ctx.createBuffer(1, len, sRate);
    const data     = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src      = ctx.createBufferSource();
    src.buffer     = buffer;

    // Build filter chain before gainNode
    let chain = src;

    if (o.highPass) {
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: o.highPass, Q: 0.7 });
      chain.connect(hp);
      chain = hp;
    }
    if (o.bandPass) {
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: o.bandPass, Q: o.bandQ || 0.7 });
      chain.connect(bp);
      chain = bp;
    }
    if (o.lowPass) {
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.lowPass, Q: o.lowQ || 0.7 });
      chain.connect(lp);
      chain = lp;
    }

    const gainNode   = new GainNode(ctx, { gain: 0 });
    const attack     = o.attack  || 0.010;
    const release    = o.release || (duration * 0.4);
    const relStart   = startTime + duration - release;

    chain.connect(gainNode);
    gainNode.connect(masterGain);

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(gainValue, startTime + attack);
    gainNode.gain.setValueAtTime(gainValue, relStart);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    src.onended = () => {
      try { gainNode.disconnect(); } catch (e) {}
      if (chain !== src) try { chain.disconnect(); } catch (e) {}
      try { src.disconnect(); } catch (e) {}
    };

    src.start(startTime);
    src.stop(startTime + duration + 0.01);
    return gainNode;
  }

  // ── TICK SOUNDS ────────────────────────────────────────────────────────────
  // Heard most frequently. Must be:
  //   (a) distinctly different from each other on all 4 axes
  //   (b) not annoying at the cadence of once per logical timer-second
  //
  // Four axes for distinctiveness:
  //   1. Base frequency    2. Waveform    3. Envelope    4. Modulation / filter
  //
  // FOCUSED    vs DRIFTING:    880→660 Hz / sine→triangle / 55→80ms / none→lowpass+droop
  // DRIFTING   vs DISTRACTED:  660→220 Hz / triangle→saw / 80→140ms / droop→heavy+echo

  /**
   * FOCUSED_TICK
   * Character: clean, bright — tiny clock in a cozy room. "Yes, keep going."
   * Axes: 880 Hz / sine / 4ms attack + 51ms decay (AD) / no filter, no modulation
   */
  function _focused_tick() {
    if (!_ok('focused_tick')) return;
    try {
      const t = ctx.currentTime;
      // Primary tone — pure sine for maximum clarity and minimum fatigue
      _osc('sine', 880, t, 0.055, 0.07, {
        attack: 0.004, decay: 0.051, sustain: 0,
      });
      // Harmonic at 2× for crystalline ring without added waveform complexity
      _osc('sine', 1760, t, 0.055, 0.025, {
        attack: 0.004, decay: 0.051, sustain: 0,
      });
    } catch (e) {}
  }

  /**
   * DRIFTING_TICK
   * Character: muffled, heard through a wall, slightly off. "Something's not right."
   * Axes: 660 Hz / triangle / 8ms attack + 72ms decay (AD) / lowpass 1800 Hz + pitch droop
   */
  function _drifting_tick() {
    if (!_ok('drifting_tick')) return;
    try {
      const t = ctx.currentTime;
      // Triangle (not sine) — softer overtone structure, feels muted
      // Pitch droop 660→620 Hz: subtle but makes each tick feel slightly uncertain
      _osc('triangle', 660, t, 0.080, 0.055, {
        attack: 0.008, decay: 0.072, sustain: 0,
        slideTo: 620,
        filter:  { type: 'lowpass', frequency: 1800, Q: 1.2 },
      });
    } catch (e) {}
  }

  /**
   * DISTRACTED_TICK
   * Character: heavy, underwater, laboured — a slowing heartbeat.
   * Feel: "This is getting bad." Mild guilt without being actively unpleasant.
   * Axes: 220 Hz / sawtooth / 20ms attack + 60ms hold + 60ms release / lowpass 600 Hz + echo
   */
  function _distracted_tick() {
    if (!_ok('distracted_tick')) return;
    try {
      const t = ctx.currentTime;
      // Sawtooth (harshest tone) through deep lowpass — thick, thuddy, subsonic feel
      _osc('sawtooth', 220, t, 0.140, 0.09, {
        attack: 0.020, release: 0.060,
        filter: { type: 'lowpass', frequency: 600, Q: 2.0 },
      });
      // Echo at 40ms delay, 0.3× gain — depth perception, feels like effort
      _osc('sawtooth', 220, t + 0.040, 0.140, 0.09 * 0.3, {
        attack: 0.020, release: 0.060,
        filter: { type: 'lowpass', frequency: 600, Q: 2.0 },
      });
    } catch (e) {}
  }

  // ── EMOTION SOUNDS ─────────────────────────────────────────────────────────
  // Formant synthesis (F1 body + F2 character + optional F3 shimmer) ported
  // from audio.js. Routing changed: master → masterGain instead of ctx.destination
  // so setVolume/mute apply to all audio uniformly.

  function _formant(f1, f2, time, dur, vol, opts) {
    const o       = opts || {};
    const vib     = o.vibRate   || 0;
    const vibD    = o.vibDepth  || 0;
    const trem    = o.tremRate  || 0;
    const tremD   = o.tremDepth || 0;
    const slide   = o.slideTo;
    const wave    = o.wave      || 'sine';
    const f2ratio = o.f2vol     || 0.35;
    const attack  = o.attack    || 0.015;
    const release = o.release   || (dur * 0.35);
    const susEnd  = time + dur - release;

    // F1 — warm body frequency
    const osc1 = new OscillatorNode(ctx, { type: wave, frequency: f1 });
    osc1.frequency.setValueAtTime(f1, time);
    if (slide) osc1.frequency.linearRampToValueAtTime(slide[0], time + dur * 0.9);

    // F2 — brightness / vowel character
    const osc2 = new OscillatorNode(ctx, { type: 'sine', frequency: f2 });
    osc2.frequency.setValueAtTime(f2, time);
    if (slide) osc2.frequency.linearRampToValueAtTime(slide[1], time + dur * 0.9);

    const g1 = new GainNode(ctx, { gain: 0 });
    const g2 = new GainNode(ctx, { gain: 0 });
    osc1.connect(g1);
    osc2.connect(g2);

    g1.gain.setValueAtTime(0, time);
    g1.gain.linearRampToValueAtTime(vol * (1 - f2ratio), time + attack);
    g1.gain.setValueAtTime(vol * (1 - f2ratio), susEnd);
    g1.gain.linearRampToValueAtTime(0, time + dur);

    g2.gain.setValueAtTime(0, time);
    g2.gain.linearRampToValueAtTime(vol * f2ratio, time + attack);
    g2.gain.setValueAtTime(vol * f2ratio, susEnd);
    g2.gain.linearRampToValueAtTime(0, time + dur);

    const master = new GainNode(ctx, { gain: 1 });
    g1.connect(master);
    g2.connect(master);

    // F3 shimmer — quiet high partial for sparkle on bright emotions
    if (o.f3) {
      const osc3 = new OscillatorNode(ctx, { type: 'sine', frequency: o.f3 });
      osc3.frequency.setValueAtTime(o.f3, time);
      if (slide && o.f3slide) osc3.frequency.linearRampToValueAtTime(o.f3slide, time + dur * 0.9);
      const g3 = new GainNode(ctx, { gain: 0 });
      osc3.connect(g3);
      g3.gain.setValueAtTime(0, time);
      g3.gain.linearRampToValueAtTime(vol * 0.12, time + attack);
      g3.gain.setValueAtTime(vol * 0.12, susEnd);
      g3.gain.linearRampToValueAtTime(0, time + dur);
      g3.connect(master);
      osc3.start(time); osc3.stop(time + dur + 0.02);
    }

    // Vibrato — frequency LFO for vocal liveliness
    if (vib > 0) {
      const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: vib });
      const lg  = new GainNode(ctx, { gain: vibD });
      lfo.connect(lg);
      lg.connect(osc1.frequency);
      lg.connect(osc2.frequency);
      lfo.start(time); lfo.stop(time + dur + 0.02);
    }

    // Tremolo — amplitude flutter for emotional quality
    if (trem > 0) {
      const tLfo = new OscillatorNode(ctx, { type: 'sine', frequency: trem });
      const tg   = new GainNode(ctx, { gain: tremD });
      tLfo.connect(tg);
      tg.connect(master.gain);
      tLfo.start(time); tLfo.stop(time + dur + 0.02);
    }

    // Route through masterGain — not directly to destination
    master.connect(masterGain);
    osc1.start(time); osc1.stop(time + dur + 0.02);
    osc2.start(time); osc2.stop(time + dur + 0.02);
    return master;
  }

  // Breathy noise shaped by a bandpass filter — aspiration / breath quality
  function _breath(time, dur, vol, freq) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);

    const src    = ctx.createBufferSource();
    src.buffer   = buf;
    const bpFreq = freq || 2500;
    const bp     = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: bpFreq, Q: 0.7 });
    const g      = new GainNode(ctx, { gain: 0 });

    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.setValueAtTime(vol, time + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, time + dur);

    src.connect(bp).connect(g).connect(masterGain);
    src.start(time); src.stop(time + dur + 0.01);
  }

  // ── Emotion polling (mirrors audio.js) ────────────────────────────────────

  let _lastChange      = null;
  let _lastSmiling     = false;
  let _lastSurprised   = false;
  let _lastFacePresent = undefined;

  function _pollEmotion() {
    const c = window._emotionChanged;
    if (!c || c === _lastChange) return;
    _lastChange = c;
    _playForTransition(c.from, c.to);
  }

  function _pollExpressions() {
    if (!window.perception?.facePresent) return;
    const p = window.perception;
    if (p.userSmiling && !_lastSmiling)     _giggle();
    if (p.userSurprised && !_lastSurprised) _surpriseGasp();
    _lastSmiling   = p.userSmiling;
    _lastSurprised = p.userSurprised;
  }

  function _pollFacePresence() {
    if (!ready) return;
    const present = !!window.perception?.facePresent;
    if (_lastFacePresent === undefined) { _lastFacePresent = present; return; }
    if (present && !_lastFacePresent)   _welcomeBack();
    if (!present && _lastFacePresent)   _userLeft();
    _lastFacePresent = present;
  }

  function _playForTransition(from, to) {
    switch (to) {
      case 'curious':    _curiousOoh();      break;
      case 'suspicious': _suspiciousNudge(); break;
      case 'pouty':      _poutyMweh();       break;
      case 'grumpy':     _grumpyHmph();      break;
      case 'scared':     _scaredEep();       break;
      case 'sad':        _sadAww();          break;
      case 'crying':     _cryingSob();       break;
      case 'sleepy':     _sleepyYawn();      break;
      case 'overjoyed':  _overjoyedSqueal(); break;
      case 'sulking':    _sulkingSigh();     break;
      case 'happy':      _contentCoo();      break;
      case 'focused':    _focusedHum();      break;
      case 'excited':    _excitedChirp();    break;
      case 'shy':        _shySqueak();       break;
      case 'love':       _lovePurr();        break;
      case 'startled':   _startledGasp();    break;
      case 'idle':
        if (from === 'scared' || from === 'sad' || from === 'crying') _reliefSigh();
        break;
      case 'forgiven':
        _reliefSigh();
        break;
    }
  }

  // ── Emotion voice sounds ───────────────────────────────────────────────────

  // Giggle — warm bubbly three-syllable "hehehe~" when user smiles
  function _giggle() {
    if (!_ok('giggle')) return;
    try {
      const t = ctx.currentTime;
      _formant(620, 1700, t, 0.09, 0.09, {
        wave: 'triangle', attack: 0.004, release: 0.03,
        tremRate: 26, tremDepth: 0.025, f3: 3200,
      });
      _formant(720, 1900, t + 0.11, 0.10, 0.10, {
        wave: 'triangle', attack: 0.004, release: 0.04,
        tremRate: 28, tremDepth: 0.025, f3: 3400,
      });
      _formant(800, 2100, t + 0.22, 0.13, 0.11, {
        wave: 'triangle', attack: 0.005, release: 0.05,
        tremRate: 30, tremDepth: 0.03, vibRate: 10, vibDepth: 8, f3: 3600,
      });
      _breath(t + 0.05, 0.04, 0.015, 3500);
      _breath(t + 0.16, 0.04, 0.012, 3800);
    } catch (e) {}
  }

  // Content coo — warm ascending "mmm~aah" for happiness
  function _contentCoo() {
    if (!_ok('coo')) return;
    try {
      const t = ctx.currentTime;
      _formant(380, 900, t, 0.18, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 10,
        slideTo: [480, 1150], attack: 0.03, release: 0.06,
      });
      _formant(500, 1250, t + 0.18, 0.25, 0.10, {
        wave: 'triangle', vibRate: 5.5, vibDepth: 14,
        slideTo: [550, 1350], attack: 0.02, release: 0.10,
        f3: 2800, f3slide: 3000,
      });
      _breath(t + 0.02, 0.06, 0.012, 3000);
    } catch (e) {}
  }

  // Curious "ooh?" — rising two-syllable wonder with wide eyes feel
  function _curiousOoh() {
    if (!_ok('curious')) return;
    try {
      const t = ctx.currentTime;
      _formant(350, 880, t, 0.12, 0.07, {
        wave: 'sine', attack: 0.01, release: 0.04,
        slideTo: [400, 1000],
      });
      _formant(420, 1050, t + 0.14, 0.28, 0.09, {
        wave: 'sine', vibRate: 5, vibDepth: 12,
        slideTo: [580, 1450], attack: 0.02, release: 0.10,
        f3: 2400, f3slide: 2900,
      });
    } catch (e) {}
  }

  // Sleepy yawn — long realistic "aaaahhh~mmm" with inhale and exhale phases
  function _sleepyYawn() {
    if (!_ok('yawn')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.15, 0.02, 1800);
      _formant(550, 1350, t + 0.12, 0.65, 0.08, {
        wave: 'sine', vibRate: 2.5, vibDepth: 18,
        slideTo: [280, 700], attack: 0.08, release: 0.30,
      });
      _breath(t + 0.15, 0.55, 0.025, 1600);
      _formant(280, 650, t + 0.70, 0.28, 0.05, {
        wave: 'sine', vibRate: 2, vibDepth: 8,
        slideTo: [220, 520], attack: 0.03, release: 0.15,
      });
      _breath(t + 0.80, 0.18, 0.018, 1200);
    } catch (e) {}
  }

  // Suspicious nudge — playful staccato "mm-MM!" chirps to get user to look back
  function _suspiciousNudge() {
    if (!_ok('suspicious')) return;
    try {
      const t = ctx.currentTime;
      _formant(400, 1050, t, 0.10, 0.09, {
        wave: 'triangle', attack: 0.005, release: 0.04,
        slideTo: [450, 1150],
      });
      _formant(520, 1350, t + 0.13, 0.12, 0.10, {
        wave: 'triangle', attack: 0.005, release: 0.05,
        slideTo: [580, 1500], f3: 2600,
      });
      _breath(t + 0.12, 0.04, 0.02, 3200);
    } catch (e) {}
  }

  // Pouty "mweeeh~" — exaggerated descending whine with trembling lip feel
  function _poutyMweh() {
    if (!_ok('pouty')) return;
    try {
      const t = ctx.currentTime;
      _formant(580, 1450, t, 0.08, 0.08, {
        wave: 'triangle', attack: 0.005, release: 0.03,
      });
      _formant(560, 1400, t + 0.08, 0.38, 0.10, {
        wave: 'triangle', vibRate: 7.5, vibDepth: 22,
        slideTo: [320, 820], attack: 0.01, release: 0.16,
        tremRate: 9, tremDepth: 0.025,
      });
      _formant(280, 700, t + 0.10, 0.30, 0.04, {
        wave: 'sine', vibRate: 7.5, vibDepth: 12,
        slideTo: [160, 410], attack: 0.02, release: 0.12,
      });
    } catch (e) {}
  }

  // Grumpy "hmph!" — deep percussive nasal puffs with low rumble
  function _grumpyHmph() {
    if (!_ok('grumpy')) return;
    try {
      const t = ctx.currentTime;
      _formant(180, 480, t, 0.10, 0.10, {
        wave: 'triangle', attack: 0.004, release: 0.04,
        slideTo: [150, 400],
      });
      _breath(t, 0.07, 0.03, 1500);
      _formant(160, 440, t + 0.16, 0.08, 0.09, {
        wave: 'triangle', attack: 0.003, release: 0.03,
        slideTo: [140, 380],
      });
      _breath(t + 0.16, 0.05, 0.028, 1200);
    } catch (e) {}
  }

  // Scared "eep!" — sharp trembling squeak with startled gasp
  function _scaredEep() {
    if (!_ok('scared')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.04, 0.03, 3800);
      _formant(850, 2300, t + 0.03, 0.11, 0.10, {
        wave: 'sine', attack: 0.003, release: 0.04,
        slideTo: [1100, 2700], tremRate: 18, tremDepth: 0.02, f3: 3500,
      });
      _formant(600, 1500, t + 0.16, 0.14, 0.05, {
        wave: 'sine', vibRate: 9, vibDepth: 20,
        slideTo: [480, 1200], attack: 0.01, release: 0.08,
        tremRate: 12, tremDepth: 0.015,
      });
    } catch (e) {}
  }

  // Sad "awww..." — long slow descending whimper with genuine melancholy
  function _sadAww() {
    if (!_ok('sad')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.06, 0.015, 1800);
      _formant(480, 1150, t + 0.03, 0.55, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 20,
        slideTo: [310, 760], attack: 0.04, release: 0.22,
        tremRate: 3.5, tremDepth: 0.018,
      });
      _formant(400, 960, t + 0.08, 0.45, 0.05, {
        wave: 'sine', vibRate: 5.5, vibDepth: 16,
        slideTo: [260, 640], attack: 0.04, release: 0.20,
      });
      _formant(310, 760, t + 0.52, 0.22, 0.04, {
        wave: 'sine', vibRate: 6, vibDepth: 14,
        slideTo: [250, 620], attack: 0.02, release: 0.12,
        tremRate: 5, tremDepth: 0.012,
      });
    } catch (e) {}
  }

  // Crying — rhythmic sobs "huh...huh...huh..." with breath between each
  function _cryingSob() {
    if (!_ok('crying')) return;
    try {
      const t = ctx.currentTime;
      [0, 0.24, 0.48, 0.70].forEach((off, i) => {
        const pitch    = 500 - i * 35;
        const loudness = 0.08 - i * 0.012;
        _formant(pitch, pitch * 2.2, t + off, 0.15, loudness, {
          wave: 'sine', vibRate: 6.5, vibDepth: 18,
          slideTo: [pitch - 60, (pitch - 60) * 2.2],
          attack: 0.006, release: 0.07,
          tremRate: 5, tremDepth: 0.012,
        });
        _breath(t + off + 0.12, 0.08, 0.018, 1600);
      });
    } catch (e) {}
  }

  // Overjoyed "eee~hee~!" — excited ascending four-note burst with sparkle
  function _overjoyedSqueal() {
    if (!_ok('overjoyed')) return;
    try {
      const t = ctx.currentTime;
      [
        [560, 1500, 0,    0.08, 0.09],
        [680, 1800, 0.08, 0.08, 0.10],
        [800, 2100, 0.16, 0.09, 0.11],
        [900, 2400, 0.25, 0.12, 0.11],
      ].forEach(n => {
        _formant(n[0], n[1], t + n[2], n[3], n[4], {
          wave: 'triangle', attack: 0.004, release: 0.03,
          tremRate: 24, tremDepth: 0.02, f3: n[1] + 1200,
        });
      });
      _breath(t + 0.04, 0.04, 0.012, 3800);
      _breath(t + 0.20, 0.04, 0.010, 4000);
    } catch (e) {}
  }

  // Sulking sigh — long heavy "haahh..." deflating breath with sad undertone
  function _sulkingSigh() {
    if (!_ok('sulking')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.40, 0.03, 1400);
      _formant(320, 800, t + 0.03, 0.45, 0.06, {
        wave: 'sine', vibRate: 3, vibDepth: 10,
        slideTo: [220, 560], attack: 0.05, release: 0.20,
      });
      _formant(240, 600, t + 0.40, 0.18, 0.03, {
        wave: 'sine', vibRate: 3.5, vibDepth: 8,
        slideTo: [200, 500], attack: 0.02, release: 0.10,
      });
    } catch (e) {}
  }

  // Focused hum — gentle contented "mmm~" background purr
  function _focusedHum() {
    if (!_ok('focused')) return;
    try {
      const t = ctx.currentTime;
      _formant(260, 620, t, 0.35, 0.04, {
        wave: 'sine', vibRate: 4, vibDepth: 6,
        slideTo: [290, 680], attack: 0.05, release: 0.14,
      });
      _formant(520, 1240, t + 0.05, 0.25, 0.015, {
        wave: 'sine', vibRate: 4, vibDepth: 4,
        slideTo: [580, 1360], attack: 0.04, release: 0.10,
      });
    } catch (e) {}
  }

  // Surprise gasp — quick "oh!" with startled breath and rising tone
  function _surpriseGasp() {
    if (!_ok('surprise')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.04, 0.025, 3200);
      _formant(500, 1300, t + 0.03, 0.12, 0.09, {
        wave: 'triangle', attack: 0.004, release: 0.05,
        slideTo: [720, 1850], f3: 2800,
      });
      _formant(680, 1750, t + 0.16, 0.08, 0.04, {
        wave: 'sine', attack: 0.005, release: 0.04,
        slideTo: [600, 1500],
      });
    } catch (e) {}
  }

  // User left — distinctly sad lonely whimper trailing off
  function _userLeft() {
    if (!_ok('userLeft')) return;
    try {
      const t = ctx.currentTime;
      _formant(460, 1100, t, 0.40, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 18,
        slideTo: [320, 780], attack: 0.03, release: 0.16,
        tremRate: 3, tremDepth: 0.012,
      });
      _formant(380, 920, t + 0.05, 0.35, 0.04, {
        wave: 'sine', vibRate: 5.5, vibDepth: 14,
        slideTo: [260, 640], attack: 0.03, release: 0.15,
      });
      _formant(320, 780, t + 0.42, 0.28, 0.05, {
        wave: 'sine', vibRate: 6, vibDepth: 12,
        slideTo: [240, 590], attack: 0.02, release: 0.15,
        tremRate: 4, tremDepth: 0.010,
      });
      _breath(t + 0.60, 0.15, 0.018, 1200);
    } catch (e) {}
  }

  // User returned — excited joyful multi-note greeting
  function _welcomeBack() {
    if (!_ok('welcomeBack')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.04, 0.015, 3500);
      _formant(460, 1200, t + 0.02, 0.10, 0.09, {
        wave: 'triangle', attack: 0.005, release: 0.04,
        slideTo: [540, 1400], f3: 2600,
      });
      _formant(600, 1550, t + 0.13, 0.11, 0.10, {
        wave: 'triangle', attack: 0.005, release: 0.05,
        vibRate: 7, vibDepth: 12, f3: 2900,
      });
      _formant(720, 1850, t + 0.25, 0.16, 0.11, {
        wave: 'triangle', attack: 0.005, release: 0.07,
        vibRate: 8, vibDepth: 15, f3: 3200,
        slideTo: [760, 1950],
      });
      _breath(t + 0.14, 0.03, 0.012, 3800);
    } catch (e) {}
  }

  // Relief sigh — gentle "ahh~" when recovering from scared/sad/crying
  function _reliefSigh() {
    if (!_ok('relief')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.08, 0.015, 2000);
      _formant(420, 1050, t + 0.04, 0.30, 0.07, {
        wave: 'sine', vibRate: 4.5, vibDepth: 10,
        slideTo: [380, 940], attack: 0.03, release: 0.12,
      });
    } catch (e) {}
  }

  // Excited chirp — rapid staccato rising "hee-hee-hee!" full of energy
  function _excitedChirp() {
    if (!_ok('excited')) return;
    try {
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        _formant(700 + i * 80, 1900 + i * 100, t + i * 0.10, 0.08, 0.09, {
          wave: 'triangle', attack: 0.004, release: 0.025,
          tremRate: 32, tremDepth: 0.03, f3: 3500 + i * 200,
        });
      }
      _breath(t + 0.02, 0.05, 0.012, 4000);
    } catch (e) {}
  }

  // Shy squeak — tiny barely-audible rising "mm?" — endearingly quiet
  function _shySqueak() {
    if (!_ok('shy')) return;
    try {
      const t = ctx.currentTime;
      _formant(480, 1200, t, 0.16, 0.05, {
        wave: 'sine', vibRate: 6, vibDepth: 8,
        slideTo: [540, 1380], attack: 0.025, release: 0.08,
      });
      _breath(t + 0.05, 0.04, 0.006, 3200);
    } catch (e) {}
  }

  // Love purr — warm rounded "mmh~" — content and affectionate
  function _lovePurr() {
    if (!_ok('love')) return;
    try {
      const t = ctx.currentTime;
      _formant(340, 840, t, 0.22, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 12,
        slideTo: [400, 980], attack: 0.04, release: 0.10,
      });
      _formant(460, 1120, t + 0.22, 0.22, 0.09, {
        wave: 'triangle', vibRate: 5.5, vibDepth: 14,
        slideTo: [500, 1200], attack: 0.02, release: 0.10,
        f3: 2600, f3slide: 2800,
      });
      _breath(t + 0.01, 0.07, 0.010, 2800);
    } catch (e) {}
  }

  // Startled gasp — sharp inhale "ah!" — wide-eyed surprise
  function _startledGasp() {
    if (!_ok('startled')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.06, 0.025, 3800);
      _formant(580, 1600, t + 0.03, 0.12, 0.08, {
        wave: 'triangle', attack: 0.003, release: 0.05,
        slideTo: [650, 1800],
      });
    } catch (e) {}
  }

  // ── Public surface ─────────────────────────────────────────────────────────

  return { init, play, setVolume, mute, unmute };

})();
