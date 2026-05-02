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
  let _timeGainMult = 1.0;  // time-of-day gain modifier (0.8 at NIGHT)

  // ── Mute preset system ─────────────────────────────────────────────────────

  // Category A — tick sounds (highest frequency)
  // Category B — emotion/personality sounds (medium frequency)
  // Category C — session lifecycle sounds (infrequent, high meaning)
  // Category D — break/reminder sounds (explicit intent)
  const SOUND_CATEGORIES = {
    focused_tick:       'A',
    drifting_tick:      'A',
    distracted_tick:    'A',
    happy_coo:          'B',
    curious_ooh:        'B',
    suspicious_squint:  'B',
    pouty_mweh:         'B',
    grumpy_hmph:        'B',
    scared_eep:         'B',
    sad_whimper:        'B',
    crying_sob:         'B',
    overjoyed_chirp:    'B',
    excited_chirp:      'B',
    shy_squeak:         'B',
    love_purr:          'B',
    startled_gasp:      'B',
    stretch_coo:        'B',
    wink_blip:          'B',
    giggle:             'B',
    yawn:               'B',
    sulking:            'B',
    userLeft:           'B',
    welcomeBack:        'B',
    relief:             'B',
    surprise:           'B',
    session_start:      'C',
    session_complete:   'C',
    session_fail:       'C',
    refocus:            'C',
    break_start:        'D',
    break_end:          'D',
    break_over:         'D',
  };

  const PRESET_ALLOWS = {
    ALL_ON:          new Set(['A', 'B', 'C', 'D']),
    ESSENTIAL:       new Set(['C', 'D']),
    REMINDERS_ONLY:  new Set(['D']),
    ALL_OFF:         new Set(),
  };

  let _mutePreset = 'ALL_ON';
  let _ticksEnabled = true;   // independent toggle for timer tick sounds

  const cooldowns = {};

  // Per-sound minimum gap between plays (ms).
  // Tick sounds: short gap so rapid timer ticks feel alive, not robotic.
  // Emotion sounds: longer gaps to prevent overlap during animated sequences.
  const COOLDOWN = {
    // Tick sounds — short gaps keep rhythm alive
    focused_tick:      800,
    drifting_tick:     800,
    distracted_tick:   800,
    // Companion emotion sounds
    happy_coo:        1200,
    curious_ooh:      1200,
    suspicious_squint:1200,
    pouty_mweh:       1200,
    grumpy_hmph:      1200,
    scared_eep:       1200,
    sad_whimper:      1200,
    crying_sob:       1200,
    overjoyed_chirp:  1200,
    excited_chirp:    1200,
    shy_squeak:       1200,
    love_purr:        3000,
    startled_gasp:    1200,
    stretch_coo:      3000,
    wink_blip:        1200,
    // Session lifecycle sounds — no cooldown (explicit, infrequent, never spam)
    session_start:    0,
    session_complete: 0,
    session_fail:     0,
    refocus:          0,
    break_start:      0,
    break_end:        0,
    break_over:       0,
    // Polling-triggered sounds
    giggle:            800,
    surprise:          800,
    relief:            800,
    yawn:             1200,
    focused:          1200,
    sulking:          1200,
    userLeft:          800,
    welcomeBack:       800,
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
   * Checks the current mute preset before dispatching.
   * Unknown names are silently ignored (future-proof).
   */
  function play(name) {
    // Category filter — check if current preset allows this sound's category
    const cat = SOUND_CATEGORIES[name];
    if (cat && !PRESET_ALLOWS[_mutePreset].has(cat)) return;

    const dispatch = {
      focused_tick:       _focused_tick,
      drifting_tick:      _drifting_tick,
      distracted_tick:    _distracted_tick,
      stretch_coo:        _stretch_coo,
      wink_blip:          _wink_blip,
      happy_coo:          _happy_coo,
      overjoyed_chirp:    _overjoyed_chirp,
      suspicious_squint:  _suspicious_squint,
      love_purr:          _love_purr,
      curious_ooh:        _curious_ooh,
      excited_chirp:      _excited_chirp,
      startled_gasp:      _startled_gasp,
      shy_squeak:         _shy_squeak,
      sad_whimper:        _sad_whimper,
      scared_eep:         _scared_eep,
      welcomeBack:        _welcomeBack,
      session_start:      _session_start,
      session_complete:   _session_complete,
      session_fail:       _session_fail,
      refocus:            _refocus,
      break_start:        _break_start,
      break_end:          _break_end,
      break_over:         _break_over,
    };
    if (dispatch[name]) dispatch[name]();
  }

  function setMutePreset(preset) {
    if (!PRESET_ALLOWS[preset]) return;
    _mutePreset = preset;
    // For ALL_OFF, zero masterGain immediately (silences anything playing now)
    if (preset === 'ALL_OFF') {
      if (masterGain) masterGain.gain.value = 0;
    } else {
      // Restore masterGain if we were ALL_OFF (and not manually muted)
      if (!_muted && masterGain) masterGain.gain.value = _savedGain * _timeGainMult;
    }
    // Update the companion mouth visual
    _applyMuteVisual(preset);
  }

  function getMutePreset() { return _mutePreset; }

  function setVolume(v) {
    _savedGain = Math.max(0, Math.min(1, v));
    if (masterGain && !_muted) masterGain.gain.value = _savedGain * _timeGainMult;
  }

  function mute() {
    _muted = true;
    if (masterGain) masterGain.gain.value = 0;
  }

  function unmute() {
    _muted = false;
    if (masterGain) masterGain.gain.value = _savedGain * _timeGainMult;
  }

  /**
   * setNightGainMult(m) — called by Brain.applyTimePeriod().
   * m = 0.8 for NIGHT (quieter late-night environment), 1.0 for all others.
   */
  function setNightGainMult(m) {
    _timeGainMult = Math.max(0, Math.min(1, m));
    if (masterGain && !_muted) masterGain.gain.value = _savedGain * _timeGainMult;
  }

  /**
   * _applyMuteVisual(preset) — toggle the .muted-all-off class on the companion
   * so CSS can show a crossed-out mouth when ALL_OFF is active.
   */
  function _applyMuteVisual(preset) {
    const companion = document.querySelector('.companion');
    if (!companion) return;
    if (preset === 'ALL_OFF') {
      companion.classList.add('muted-all-off');
    } else {
      companion.classList.remove('muted-all-off');
    }
  }

  // ── Guard ──────────────────────────────────────────────────────────────────

  function _ok(type) {
    if (!ready || !ctx) return false;
    // Resume suspended context — browser may suspend after inactivity
    if (ctx.state === 'suspended') { ctx.resume(); return false; }
    // Honour the independent ticks toggle for all category-A tick sounds
    if (!_ticksEnabled && SOUND_CATEGORIES[type] === 'A') return false;
    const now = Date.now();
    const ms  = (COOLDOWN[type] !== undefined) ? COOLDOWN[type] : 800;
    if (ms > 0 && cooldowns[type] && now - cooldowns[type] < ms) return false;
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
      lfo.onended = () => {
        try { lfoG.disconnect(); } catch (_) {}
        try { lfo.disconnect(); } catch (_) {}
      };
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
   * Character: soft felt clock — gentle tap of a padded wooden mechanism.
   * "Yes, keep going." Barely-there, pleasant, never sharp.
   *
   * Recipe:
   *   • 340 Hz sine through a lowpass at 900 Hz — removes all brightness/harshness
   *   • Very fast AD (2ms attack + 28ms decay) — crisp but cushioned
   *   • Whisper-level gain (0.052) — heard but never felt
   *   • Optional tap transient: brief 680 Hz harmonic at 0.014 gain, same shape
   */
  function _focused_tick() {
    if (!_ok('focused_tick')) return;
    try {
      const t = ctx.currentTime;
      // Soft fundamental — warm muffled "tok"
      _osc('sine', 340, t, 0.030, 0.052, {
        attack: 0.002, decay: 0.028, sustain: 0,
        filter: { type: 'lowpass', frequency: 900, Q: 0.8 },
      });
      // Faint harmonic tap — adds subtle definition without metallic edge
      _osc('sine', 680, t, 0.022, 0.014, {
        attack: 0.002, decay: 0.020, sustain: 0,
        filter: { type: 'lowpass', frequency: 1100, Q: 0.7 },
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
      lfo.onended = () => {
        try { lg.disconnect(); } catch (_) {}
        try { lfo.disconnect(); } catch (_) {}
      };
    }

    // Tremolo — amplitude flutter for emotional quality
    if (trem > 0) {
      const tLfo = new OscillatorNode(ctx, { type: 'sine', frequency: trem });
      const tg   = new GainNode(ctx, { gain: tremD });
      tLfo.connect(tg);
      tg.connect(master.gain);
      tLfo.start(time); tLfo.stop(time + dur + 0.02);
      tLfo.onended = () => {
        try { tg.disconnect(); } catch (_) {}
        try { tLfo.disconnect(); } catch (_) {}
      };
    }

    // Route through masterGain — not directly to destination
    master.connect(masterGain);
    osc1.start(time); osc1.stop(time + dur + 0.02);
    osc2.start(time); osc2.stop(time + dur + 0.02);
    osc1.onended = () => {
      try { g1.disconnect();     } catch (_) {}
      try { g2.disconnect();     } catch (_) {}
      try { master.disconnect(); } catch (_) {}
      try { osc1.disconnect();   } catch (_) {}
      try { osc2.disconnect();   } catch (_) {}
    };
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
    src.onended = () => {
      try { bp.disconnect(); } catch (_) {}
      try { g.disconnect(); } catch (_) {}
      try { src.disconnect(); } catch (_) {}
    };
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
    // Category B — only play if preset allows emotion sounds
    if (!PRESET_ALLOWS[_mutePreset].has('B')) return;
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
    // welcomeBack and userLeft are category B
    if (PRESET_ALLOWS[_mutePreset].has('B')) {
      if (present && !_lastFacePresent)   _welcomeBack();
      if (!present && _lastFacePresent)   _userLeft();
    }
    _lastFacePresent = present;
  }

  function _playForTransition(from, to) {
    // All emotion transition sounds are category B
    if (!PRESET_ALLOWS[_mutePreset].has('B')) return;
    switch (to) {
      case 'curious':    _curious_ooh();        break;
      case 'suspicious': _suspicious_squint();  break;
      case 'pouty':      _pouty_mweh();         break;
      case 'grumpy':     _grumpy_hmph();        break;
      case 'scared':     _scared_eep();         break;
      case 'sad':        _sad_whimper();        break;
      case 'crying':     _crying_sob();         break;
      case 'sleepy':     _sleepyYawn();         break;
      case 'overjoyed':  _overjoyed_chirp();    break;
      case 'sulking':    _sulkingSigh();        break;
      case 'happy':      _happy_coo();          break;
      case 'focused':    _focusedHum();         break;
      case 'excited':    _excited_chirp();      break;
      case 'shy':        _shy_squeak();         break;
      case 'love':       _love_purr();          break;
      case 'startled':   _startled_gasp();      break;
      case 'ecstatic':   _overjoyed_chirp();    break;  // golden joy — reuse overjoyed chirp
      case 'dazed':      _love_purr();          break;  // soft contented purr on daze entry
      case 'idle':
        if (from === 'scared' || from === 'sad' || from === 'crying') _reliefSigh();
        break;
      case 'forgiven':
        _reliefSigh();
        break;
    }
  }

  // ── Emotion voice sounds ───────────────────────────────────────────────────
  // Each function targets one emotional truth identifiable by ear alone.
  // All source gain nodes ≤ 0.12. All route through masterGain.

  // Giggle — detuned-pair fairy bell cascade (triggered by userSmiling).
  // Each bell is a chorus pair (±4 Hz apart) — creates magical shimmer beating.
  // 2× and 3× overtones on each bell. Flutter vibrato on the final bell.
  function _giggle() {
    if (!_ok('giggle')) return;
    try {
      const t = ctx.currentTime;
      // Airy breath — tiny gasp of pure delight
      _breath(t, 0.030, 0.008, 4500);

      // Bell 1: chorus pair 976+984 Hz — music-box ping, 70ms
      _osc('sine', 976, t, 0.070, 0.055, { attack: 0.002, decay: 0.068, sustain: 0 });
      _osc('sine', 984, t, 0.070, 0.050, { attack: 0.002, decay: 0.068, sustain: 0 });
      _osc('triangle', 1960, t + 0.002, 0.048, 0.022, { attack: 0.002, decay: 0.046, sustain: 0 });
      _osc('triangle', 2940, t + 0.004, 0.032, 0.010, { attack: 0.002, decay: 0.030, sustain: 0 });

      // Bell 2: chorus pair 1176+1184 Hz at +105ms — slightly brighter
      _osc('sine', 1176, t + 0.105, 0.075, 0.055, { attack: 0.002, decay: 0.073, sustain: 0 });
      _osc('sine', 1184, t + 0.105, 0.075, 0.050, { attack: 0.002, decay: 0.073, sustain: 0 });
      _osc('triangle', 2360, t + 0.107, 0.052, 0.022, { attack: 0.002, decay: 0.050, sustain: 0 });
      _osc('triangle', 3540, t + 0.109, 0.034, 0.010, { attack: 0.002, decay: 0.032, sustain: 0 });
      _breath(t + 0.108, 0.028, 0.006, 4200);

      // Bell 3: chorus pair 1434+1446 Hz at +210ms — 13Hz flutter vibrato, 110ms
      _osc('sine', 1434, t + 0.210, 0.110, 0.055, {
        attack: 0.002, decay: 0.108, sustain: 0, vibRate: 13, vibDepth: 12,
      });
      _osc('sine', 1446, t + 0.210, 0.110, 0.050, {
        attack: 0.002, decay: 0.108, sustain: 0, vibRate: 13, vibDepth: 15,
      });
      _osc('triangle', 2880, t + 0.212, 0.078, 0.022, { attack: 0.002, decay: 0.076, sustain: 0 });
      // 3× shimmer — fairy-dust glitter at the very top
      _osc('triangle', 4320, t + 0.215, 0.050, 0.010, { attack: 0.002, decay: 0.048, sustain: 0 });
      _breath(t + 0.212, 0.050, 0.008, 4800);
    } catch (e) {}
  }

  /**
   * HAPPY_COO — warm upward vocal coo triggered by smile detection.
   * Axes: 490→700 Hz sine glide / detuned body layer / bright uptick tail
   */
  function _happy_coo() {
    if (!_ok('happy_coo')) return;
    try {
      const t = ctx.currentTime;
      // Warm upward vocal coo — main sine glide: 490→700 Hz, 190ms
      _osc('sine', 490, t, 0.190, 0.072, {
        attack: 0.018, decay: 0.172, sustain: 0, slideTo: 700,
      });
      // Body layer — slightly detuned sine (+6 Hz) for natural warmth
      _osc('sine', 496, t + 0.005, 0.185, 0.038, {
        attack: 0.020, decay: 0.165, sustain: 0, slideTo: 706,
      });
      // Playful uptick — bright little pip at the end (220ms after onset)
      _osc('sine', 760, t + 0.220, 0.100, 0.048, {
        attack: 0.010, decay: 0.090, sustain: 0, slideTo: 920,
      });
    } catch (e) {}
  }

  /**
   * CURIOUS_OOH — "oh? I wonder..." — a question mark in sound form.
   * Axes: 380→560 Hz slide / sine+triangle blend / 200ms + 60ms tail / late vibrato onset
   */
  function _curious_ooh() {
    if (!_ok('curious_ooh')) return;
    try {
      const t = ctx.currentTime;
      // Main: two nodes summed — sine for warmth, triangle for texture
      // Vibrato kicks in at 100ms: LFO starts at t+0.100
      _osc('sine', 380, t, 0.200, 0.07, {
        attack: 0.020, release: 0.050,
        slideTo: 560,
        vibRate: 7, vibDepth: 12,
      });
      _osc('triangle', 380, t, 0.200, 0.035, {
        attack: 0.020, release: 0.050,
        slideTo: 560,
      });
      // Tail "?" punctuation — separate short note, no vibrato
      _osc('sine', 620, t + 0.230, 0.060, 0.04, {
        attack: 0.006, decay: 0.054, sustain: 0,
      });
    } catch (e) {}
  }

  /**
   * SUSPICIOUS_SQUINT — "I see you. Don't." — flat, deliberate, no warmth.
   * Axes: 340→310 Hz (descending) / sawtooth / two separate pulses / lowpass, no vibrato
   */
  function _suspicious_squint() {
    if (!_ok('suspicious_squint')) return;
    try {
      const t = ctx.currentTime;
      // Pulse 1: 340 Hz, 90ms — attack 5ms, decay 85ms
      _osc('sawtooth', 340, t, 0.090, 0.065, {
        attack: 0.005, decay: 0.085, sustain: 0,
        filter: { type: 'lowpass', frequency: 1200, Q: 1.5 },
      });
      // [60ms silence]
      // Pulse 2: 310 Hz, 70ms — lower = more skeptical
      _osc('sawtooth', 310, t + 0.150, 0.070, 0.065, {
        attack: 0.005, decay: 0.065, sustain: 0,
        filter: { type: 'lowpass', frequency: 1200, Q: 1.5 },
      });
    } catch (e) {}
  }

  /**
   * POUTY_MWEH — sulky, slightly nasal — "you're ignoring me".
   * Axes: 420→300 Hz / triangle / 280ms slow descent / bandpass (nasal) + irregular wobble
   */
  function _pouty_mweh() {
    if (!_ok('pouty_mweh')) return;
    try {
      const t = ctx.currentTime;
      // Breath onset — "m" consonant
      _noise(t, 0.030, 0.008, { highPass: 2000 });
      // Main: triangle slid down, bandpass for nasal character, irregular vibrato (moody)
      _osc('triangle', 420, t + 0.010, 0.280, 0.075, {
        attack: 0.030, release: 0.080,
        slideTo: 300,
        vibRate: 3, vibDepth: 15,
        filter: { type: 'bandpass', frequency: 800, Q: 3.5 },
      });
    } catch (e) {}
  }

  /**
   * GRUMPY_HMPH — final warning. Short, weighted, done with it.
   * Axes: 280 Hz (+ 140 Hz bass) / sawtooth / sharp attack 3ms / lowpass + final pitch drop
   */
  function _grumpy_hmph() {
    if (!_ok('grumpy_hmph')) return;
    try {
      const t = ctx.currentTime;
      // Main body: 280 Hz, 110ms — sharp attack, sustain, then drop to 200 Hz in last 30ms
      _osc('sawtooth', 280, t, 0.110, 0.09, {
        attack: 0.003, release: 0.057,
        slideTo: 200,
        filter: { type: 'lowpass', frequency: 900, Q: 2.0 },
      });
      // Bass reinforcement: 140 Hz at 0.5× — physical weight
      _osc('sawtooth', 140, t, 0.110, 0.045, {
        attack: 0.003, release: 0.057,
        slideTo: 100,
        filter: { type: 'lowpass', frequency: 900, Q: 2.0 },
      });
    } catch (e) {}
  }

  /**
   * SCARED_EEP — sudden realisation of being alone — tiny creature's gasp.
   * Axes: 600→980 Hz upward slide / sine / 2ms instant attack / fast tremolo 18Hz
   */
  function _scared_eep() {
    if (!_ok('scared_eep')) return;
    try {
      const t = ctx.currentTime;
      // Rapid upward slide (gasp shape) — fastest attack in system
      _osc('sine', 600, t, 0.060, 0.065, {
        attack: 0.002, decay: 0.058, sustain: 0,
        slideTo: 980,
      });
      // Second partial at 1200 Hz — adds sharpness of shock
      _osc('sine', 1200, t + 0.010, 0.040, 0.030, {
        attack: 0.010, decay: 0.030, sustain: 0,
      });
      // Fear shiver: inline tremolo via LFO connected to a gain node wrapping the osc
      // (handled by _osc's filter param — tremolo done via treRate/treDepth on _formant;
      //  for _osc we use a separate short tremolo osc)
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: 600 });
      const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 18 });
      const lfoG = new GainNode(ctx, { gain: 0.15 * 0.065 });
      const g   = new GainNode(ctx, { gain: 0 });
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.exponentialRampToValueAtTime(980, t + 0.060);
      lfo.connect(lfoG); lfoG.connect(g.gain);
      osc.connect(g); g.connect(masterGain);
      g.gain.setValueAtTime(0.065, t);
      g.gain.linearRampToValueAtTime(0, t + 0.060);
      lfo.start(t); lfo.stop(t + 0.070);
      osc.start(t); osc.stop(t + 0.070);
      lfo.onended = () => {
        try { lfoG.disconnect(); } catch(_) {}
        try { lfo.disconnect(); } catch(_) {}
      };
      osc.onended = () => {
        try { g.disconnect(); } catch(_) {}
        try { osc.disconnect(); } catch(_) {}
      };
    } catch (e) {}
  }

  /**
   * SAD_WHIMPER — waiting, missing you — not dramatic. Intimate.
   * Axes: 360→280 Hz / sine / 40ms soft attack, 400ms total / slow vibrato + breath layer
   */
  function _sad_whimper() {
    if (!_ok('sad_whimper')) return;
    try {
      const t = ctx.currentTime;
      // Main: slow heavy descent, soft onset (sadness doesn't start sharp)
      _osc('sine', 360, t, 0.400, 0.07, {
        attack: 0.040, release: 0.160,
        slideTo: 280,
        vibRate: 4, vibDepth: 6,
      });
      // Quiet breath underneath — barely-there intimacy
      _noise(t + 0.040, 0.320, 0.006, { lowPass: 400 });
    } catch (e) {}
  }

  /**
   * CRYING_SOB — full emotional breakdown — can't stop.
   * Two-phase: stutter/gasp pulses → sustained cry. Only two-phase structure in system.
   * Axes: 320→190 Hz / triangle+sine phases / highest tremolo depth / descending stutter
   */
  function _crying_sob() {
    if (!_ok('crying_sob')) return;
    try {
      const t = ctx.currentTime;
      // Phase 1: 3 stuttering pulses, each 70ms, 40ms gap — descending pitch
      const phase1Pitches = [320, 295, 270];
      phase1Pitches.forEach((freq, i) => {
        const off = i * 0.110; // 70ms note + 40ms gap
        _osc('triangle', freq, t + off, 0.070, 0.08, {
          attack: 0.005, decay: 0.065, sustain: 0,
        });
        // Tremolo shiver — 22Hz, depth 0.25 — sobbing shake
        const osc = new OscillatorNode(ctx, { type: 'triangle', frequency: freq });
        const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 22 });
        const lfoG = new GainNode(ctx, { gain: 0.25 * 0.06 });
        const g    = new GainNode(ctx, { gain: 0.06 });
        lfo.connect(lfoG); lfoG.connect(g.gain);
        osc.connect(g); g.connect(masterGain);
        g.gain.setValueAtTime(0.06, t + off);
        g.gain.linearRampToValueAtTime(0, t + off + 0.070);
        lfo.start(t + off); lfo.stop(t + off + 0.080);
        osc.start(t + off); osc.stop(t + off + 0.080);
        lfo.onended = () => {
          try { lfoG.disconnect(); } catch(_) {}
          try { lfo.disconnect(); } catch(_) {}
        };
        osc.onended = () => {
          try { g.disconnect(); } catch(_) {}
          try { osc.disconnect(); } catch(_) {}
        };
      });
      // Phase 2: sustained cry — sine 310→190 Hz over 600ms
      const p2 = t + 0.360;
      _osc('sine', 310, p2, 0.600, 0.08, {
        attack: 0.020, release: 0.280,
        slideTo: 190,
        vibRate: 5, vibDepth: 20,
      });
      // Breath within cry
      _noise(p2 + 0.050, 0.080, 0.010, { bandPass: 600 });
    } catch (e) {}
  }

  /**
   * OVERJOYED_CHIRP — detuned-pair fairy glitter shower — can't contain happiness!
   * Five ascending chorus-pair chimes, each with 2× shimmer. Top two also get 3× shimmer.
   * Ends with a fairy trill (rapid high alternating pips) — pure "wheee!" energy.
   * Axes: 636+644→1474+1482 Hz / sine pairs / cascade / 2× each, 3× top two / trill ending
   */
  function _overjoyed_chirp() {
    if (!_ok('overjoyed_chirp')) return;
    try {
      const t = ctx.currentTime;
      // Five ascending chorus pairs (base frequencies, +8 Hz detuned partner each)
      const bases   = [636, 796, 976, 1196, 1474];
      const offsets = [0, 0.052, 0.107, 0.165, 0.228];
      bases.forEach((freq, i) => {
        const o      = offsets[i];
        const dur    = i === 4 ? 0.150 : 0.065;
        const isLast = i === 4;
        const opts1  = isLast
          ? { attack: 0.002, decay: dur - 0.002, sustain: 0, vibRate: 11, vibDepth: 13 }
          : { attack: 0.002, decay: dur - 0.002, sustain: 0 };
        const opts2  = isLast
          ? { attack: 0.002, decay: dur - 0.002, sustain: 0, vibRate: 11, vibDepth: 16 }
          : { attack: 0.002, decay: dur - 0.002, sustain: 0 };
        // Chorus pair
        _osc('sine', freq,     t + o, dur, 0.055, opts1);
        _osc('sine', freq + 8, t + o, dur, 0.050, opts2);
        // 2× shimmer (progressively brighter up the cascade)
        const shimGain = 0.010 + i * 0.004;
        _osc('triangle', freq * 2, t + o + 0.002, dur * 0.65, shimGain, {
          attack: 0.002, decay: dur * 0.65 - 0.002, sustain: 0,
        });
        // 3× shimmer on top two chimes — fairy-dust glitter at the peak
        if (i >= 3) {
          _osc('triangle', freq * 3, t + o + 0.003, dur * 0.45, 0.010, {
            attack: 0.002, decay: dur * 0.45 - 0.002, sustain: 0,
          });
        }
      });
      // Breath of pure delight at the cascade peak
      _breath(t + 0.228, 0.060, 0.009, 4800);
      // Fairy trill — rapid "wheee!": three quick alternating high pips
      _osc('sine', 1800, t + 0.390, 0.032, 0.042, { attack: 0.002, decay: 0.030, sustain: 0 });
      _osc('sine', 2160, t + 0.426, 0.032, 0.042, { attack: 0.002, decay: 0.030, sustain: 0 });
      _osc('sine', 1800, t + 0.462, 0.032, 0.038, { attack: 0.002, decay: 0.030, sustain: 0 });
      _osc('sine', 2160, t + 0.498, 0.038, 0.034, { attack: 0.002, decay: 0.036, sustain: 0 });
    } catch (e) {}
  }

  /**
   * EXCITED_CHIRP — three-pip detuned fairy burst — rapid energy, can't sit still!
   * Two chorus-pair pips + a third exclamation pip at the top. Fast flutter vibrato.
   * Axes: 1096+1104 → 1314+1326 → 1700 Hz / triangle pairs / 2× shimmer each
   */
  function _excited_chirp() {
    if (!_ok('excited_chirp')) return;
    try {
      const t = ctx.currentTime;
      // Pip 1: chorus pair 1096+1104 Hz, 50ms — bright spring ping
      _osc('triangle', 1096, t, 0.050, 0.052, { attack: 0.002, decay: 0.048, sustain: 0 });
      _osc('triangle', 1104, t, 0.050, 0.048, { attack: 0.002, decay: 0.048, sustain: 0 });
      _osc('sine', 2200, t + 0.002, 0.036, 0.018, { attack: 0.002, decay: 0.034, sustain: 0 });

      // [28ms gap]
      // Pip 2: chorus pair 1314+1326 Hz, 60ms — jittery 22Hz flutter
      _osc('triangle', 1314, t + 0.078, 0.060, 0.052, {
        attack: 0.002, decay: 0.058, sustain: 0, vibRate: 22, vibDepth: 20,
      });
      _osc('triangle', 1326, t + 0.078, 0.060, 0.048, {
        attack: 0.002, decay: 0.058, sustain: 0, vibRate: 22, vibDepth: 24,
      });
      _osc('sine', 2640, t + 0.080, 0.044, 0.016, { attack: 0.002, decay: 0.042, sustain: 0 });

      // Pip 3: exclamation high pip 1700 Hz — surprised fairy delight
      _osc('sine', 1700, t + 0.150, 0.040, 0.042, { attack: 0.002, decay: 0.038, sustain: 0 });
      _osc('triangle', 3400, t + 0.152, 0.028, 0.012, { attack: 0.002, decay: 0.026, sustain: 0 });
    } catch (e) {}
  }

  /**
   * SHY_SQUEAK — caught by direct eye contact — barely audible embarrassment.
   * QUIETEST sound in system (0.045). Hesitant 30ms attack, nervous fast-small vibrato.
   * Axes: 500→580 Hz / sine / 30ms slow attack / fast 9Hz vibrato, tiny depth
   */
  function _shy_squeak() {
    if (!_ok('shy_squeak')) return;
    try {
      const t = ctx.currentTime;
      _osc('sine', 500, t, 0.120, 0.045, {
        attack: 0.030, release: 0.060,
        slideTo: 580,
        vibRate: 9, vibDepth: 6,
      });
    } catch (e) {}
  }

  /**
   * LOVE_PURR — being touched — warm, melting, content. LONGEST sound: 600ms.
   * Multi-harmonic stack (root + 2nd + 3rd). Slowest vibrato. Slow breathing tremolo.
   * Axes: 220 Hz (lowest base) / sine harmonics / 600ms ADSR / slowest vibrato 3.5Hz
   */
  function _love_purr() {
    if (!_ok('love_purr')) return;
    try {
      const t = ctx.currentTime;
      const dur = 0.600;
      const atk = 0.050;
      const rel = 0.200;
      const susEnd = t + dur - rel;

      // Root: 220 Hz
      const oscR = new OscillatorNode(ctx, { type: 'sine', frequency: 220 });
      const gR   = new GainNode(ctx, { gain: 0 });
      // 2nd harmonic: 440 Hz at 0.4× root gain
      const osc2 = new OscillatorNode(ctx, { type: 'sine', frequency: 440 });
      const g2   = new GainNode(ctx, { gain: 0 });
      // 3rd harmonic: 660 Hz at 0.15× root gain
      const osc3 = new OscillatorNode(ctx, { type: 'sine', frequency: 660 });
      const g3   = new GainNode(ctx, { gain: 0 });

      // Envelopes
      const rootGain = 0.08;
      [
        [gR,  rootGain],
        [g2,  rootGain * 0.40],
        [g3,  rootGain * 0.15],
      ].forEach(([g, peak]) => {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + atk);
        g.gain.setValueAtTime(peak, susEnd);
        g.gain.linearRampToValueAtTime(0, t + dur);
      });

      // Vibrato on root: 3.5Hz, depth 8Hz (gentle purr)
      const vib  = new OscillatorNode(ctx, { type: 'sine', frequency: 3.5 });
      const vibG = new GainNode(ctx, { gain: 8 });
      vib.connect(vibG); vibG.connect(oscR.frequency);

      // Tremolo across all: 0.5Hz, depth 0.08 (slow breathing)
      const mix = new GainNode(ctx, { gain: 1 });
      gR.connect(mix); g2.connect(mix); g3.connect(mix);
      const trem  = new OscillatorNode(ctx, { type: 'sine', frequency: 0.5 });
      const tremG = new GainNode(ctx, { gain: 0.08 });
      trem.connect(tremG); tremG.connect(mix.gain);
      mix.connect(masterGain);

      oscR.connect(gR); osc2.connect(g2); osc3.connect(g3);

      // Crystal shimmer: 1320 Hz sine fades in after 200ms — fairy-dust texture on the purr
      const oscS  = new OscillatorNode(ctx, { type: 'sine', frequency: 1320 });
      const gS    = new GainNode(ctx, { gain: 0 });
      oscS.connect(gS); gS.connect(masterGain);
      gS.gain.setValueAtTime(0, t + 0.200);
      gS.gain.linearRampToValueAtTime(0.015, t + 0.380);
      gS.gain.linearRampToValueAtTime(0, t + dur);
      oscS.start(t + 0.180); oscS.stop(t + dur + 0.02);
      oscS.onended = () => { try { gS.disconnect(); } catch(_) {} };
      // High shimmer: 1980 Hz for extra glitter sparkle
      const oscH  = new OscillatorNode(ctx, { type: 'sine', frequency: 1980 });
      const gH    = new GainNode(ctx, { gain: 0 });
      oscH.connect(gH); gH.connect(masterGain);
      gH.gain.setValueAtTime(0, t + 0.250);
      gH.gain.linearRampToValueAtTime(0.010, t + 0.420);
      gH.gain.linearRampToValueAtTime(0, t + dur);
      oscH.start(t + 0.230); oscH.stop(t + dur + 0.02);
      oscH.onended = () => { try { gH.disconnect(); } catch(_) {} };

      [oscR, osc2, osc3, vib, trem].forEach(o => { o.start(t); o.stop(t + dur + 0.02); });
      oscR.onended = () => {
        try { mix.disconnect(); gR.disconnect(); g2.disconnect(); g3.disconnect(); } catch(_) {}
      };
    } catch (e) {}
  }

  /**
   * STARTLED_GASP — sudden fright then quick recovery — "oh! — oh. okay."
   * Noise+tone simultaneous onset → 120ms silence (held breath) → recovery sine.
   * Axes: 700→460→420 Hz / noise+sine then sine / intentional mid-pause / catching-breath vibrato
   */
  function _startled_gasp() {
    if (!_ok('startled_gasp')) return;
    try {
      const t = ctx.currentTime;
      // Part 1: noise burst (highpass 3000 Hz) + sine 700 Hz — simultaneous
      _noise(t, 0.050, 0.022, { highPass: 3000 });
      _osc('sine', 700, t, 0.040, 0.065, {
        attack: 0.002, decay: 0.038, sustain: 0,
      });
      // [120ms silence — the held breath]
      // Part 2: recovery — 460→420 Hz, 100ms, attack 30ms, vibrato 5Hz/5Hz
      _osc('sine', 460, t + 0.170, 0.100, 0.05, {
        attack: 0.030, decay: 0.070, sustain: 0,
        slideTo: 420,
        vibRate: 5, vibDepth: 5,
      });
    } catch (e) {}
  }

  /**
   * STRETCH_COO — full body stretch — physical contentment. Longest: 900ms.
   * Rise then fall with vibrato fade-in (unique: others start with vibrato). Breath in fall.
   * Axes: 280→420→240 Hz / sine / 900ms two-phase / vibrato fades IN from 200ms mark
   */
  function _stretch_coo() {
    if (!_ok('stretch_coo')) return;
    try {
      const t = ctx.currentTime;
      // Phase 1 (rise): 280→420 Hz over 500ms, attack 80ms
      // Vibrato fades in from 200ms using gainNode ramp on LFO gain
      const osc1 = new OscillatorNode(ctx, { type: 'sine', frequency: 280 });
      const g1   = new GainNode(ctx, { gain: 0 });
      const lfo1 = new OscillatorNode(ctx, { type: 'sine', frequency: 4 });
      const lfoG = new GainNode(ctx, { gain: 0 }); // starts silent, fades in
      lfo1.connect(lfoG); lfoG.connect(osc1.frequency);
      lfoG.gain.setValueAtTime(0, t);
      lfoG.gain.linearRampToValueAtTime(10, t + 0.500); // fade in over full phase
      osc1.frequency.setValueAtTime(280, t);
      osc1.frequency.linearRampToValueAtTime(420, t + 0.500);
      g1.gain.setValueAtTime(0, t);
      g1.gain.linearRampToValueAtTime(0.07, t + 0.080);
      g1.gain.setValueAtTime(0.07, t + 0.500);
      g1.gain.linearRampToValueAtTime(0, t + 0.530);
      osc1.connect(g1); g1.connect(masterGain);

      // Phase 2 (fall+sigh): 420→240 Hz over 400ms, decay out
      const p2 = t + 0.520;
      const osc2 = new OscillatorNode(ctx, { type: 'sine', frequency: 420 });
      const g2   = new GainNode(ctx, { gain: 0 });
      const lfo2 = new OscillatorNode(ctx, { type: 'sine', frequency: 4 });
      const lfoG2 = new GainNode(ctx, { gain: 10 }); // already present in phase 2
      lfo2.connect(lfoG2); lfoG2.connect(osc2.frequency);
      osc2.frequency.setValueAtTime(420, p2);
      osc2.frequency.linearRampToValueAtTime(240, p2 + 0.400);
      g2.gain.setValueAtTime(0.07, p2);
      g2.gain.linearRampToValueAtTime(0, p2 + 0.380);
      osc2.connect(g2); g2.connect(masterGain);
      // Breath noise under phase 2 — quiet sigh
      _noise(p2, 0.380, 0.009, { lowPass: 800 });

      [osc1, lfo1].forEach(o => { o.start(t);  o.stop(t  + 0.530); });
      [osc2, lfo2].forEach(o => { o.start(p2); o.stop(p2 + 0.400); });
      osc1.onended = () => { try { g1.disconnect(); } catch(_) {} };
      osc2.onended = () => { try { g2.disconnect(); } catch(_) {} };
    } catch (e) {}
  }

  /**
   * WINK_BLIP — one cheeky wink — personality punctuation. SHORTEST: 35ms.
   * Highest single-note frequency in system. Mid-note pitch wobble at 20ms.
   * Axes: 900 Hz (+40Hz wobble) / sine / 35ms 2ms-attack / mid-note frequency spike
   */
  function _wink_blip() {
    if (!_ok('wink_blip')) return;
    try {
      const t = ctx.currentTime;
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: 900 });
      const g   = new GainNode(ctx, { gain: 0 });
      osc.connect(g); g.connect(masterGain);
      // Envelope: 2ms attack, 33ms decay
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.002);
      g.gain.linearRampToValueAtTime(0, t + 0.035);
      // Pitch wobble: +40Hz at 20ms mark, back to 900 Hz by 30ms
      osc.frequency.setValueAtTime(900, t);
      osc.frequency.setValueAtTime(940, t + 0.020);
      osc.frequency.linearRampToValueAtTime(900, t + 0.030);
      osc.start(t); osc.stop(t + 0.040);
      osc.onended = () => {
        try { g.disconnect(); } catch(_) {}
        try { osc.disconnect(); } catch(_) {}
      };
    } catch (e) {}
  }

  // ── SESSION SOUNDS ─────────────────────────────────────────────────────────
  // These are lifecycle signals, not emotional expressions. Character is cleaner
  // and more deliberate than emotion sounds — precise tones, no breathiness.
  // All have COOLDOWN=0 because they are infrequent and must always play.

  /**
   * SESSION_START — "alright, let's do this — I'm here with you"
   * Clean two-step ascending signal. Shimmer on note 2.
   * Axes: 440→660 Hz / sine / A+D then A+S+R / shimmer on note 2 peak
   */
  function _session_start() {
    if (!_ok('session_start')) return;
    try {
      const t = ctx.currentTime;
      // Note 1: sine 440 Hz, 200ms. Attack 20ms, decay 180ms.
      _osc('sine', 440, t, 0.200, 0.07, {
        attack: 0.020, decay: 0.180, sustain: 0,
      });
      // [100ms gap]
      // Note 2: sine 660 Hz, 300ms. Attack 15ms, sustain 150ms, release 135ms.
      _osc('sine', 660, t + 0.300, 0.300, 0.07, {
        attack: 0.015, release: 0.135,
      });
      // Shimmer: triangle 1320 Hz, starts at note 2 peak (~15ms in), 150ms, gain 0.03
      _osc('triangle', 1320, t + 0.315, 0.150, 0.03, {
        attack: 0.005, decay: 0.145, sustain: 0,
      });
    } catch (e) {}
  }

  /**
   * SESSION_COMPLETE — "you did it!! I'm so proud!"
   * Triumphant ascending three-note cascade with sparkle at peak.
   * Axes: 440→550→660 Hz / sine / staggered cascade / vibrato + double sparkle on note 3
   */
  function _session_complete() {
    if (!_ok('session_complete')) return;
    try {
      const t = ctx.currentTime;
      // Note 1: sine 440 Hz, 180ms. t=0
      _osc('sine', 440, t, 0.180, 0.075, {
        attack: 0.010, release: 0.080,
      });
      // Note 2: sine 550 Hz, 180ms. t=150ms
      _osc('sine', 550, t + 0.150, 0.180, 0.075, {
        attack: 0.010, release: 0.080,
      });
      // Note 3: sine 660 Hz, 350ms. t=300ms. Vibrato: 7Hz, depth 12Hz.
      _osc('sine', 660, t + 0.300, 0.350, 0.09, {
        attack: 0.010, release: 0.120,
        vibRate: 7, vibDepth: 12,
      });
      // Sparkle at note 3 peak: 1320 Hz + 1650 Hz, 80ms each, gain 0.025
      _osc('triangle', 1320, t + 0.310, 0.080, 0.025, {
        attack: 0.005, decay: 0.075, sustain: 0,
      });
      _osc('triangle', 1650, t + 0.310, 0.080, 0.025, {
        attack: 0.005, decay: 0.075, sustain: 0,
      });
    } catch (e) {}
  }

  /**
   * SESSION_FAIL — "we didn't make it. It's okay. Try again."
   * Descending, soft, forgiving. Not harsh — user already feels bad.
   * Axes: 330→220 Hz / triangle / two-note A+S+R / lowpass both + sad vibrato on note 2
   */
  function _session_fail() {
    if (!_ok('session_fail')) return;
    try {
      const t = ctx.currentTime;
      // Note 1: triangle 330 Hz, 300ms. Attack 40ms, sustain 160ms, release 100ms.
      _osc('triangle', 330, t, 0.300, 0.065, {
        attack: 0.040, release: 0.100,
        filter: { type: 'lowpass', frequency: 1000, Q: 1.0 },
      });
      // [150ms gap]
      // Note 2: triangle 220 Hz, 400ms. Attack 30ms, sustain 200ms, release 170ms.
      // Vibrato 3.5Hz, depth 7Hz (sad)
      _osc('triangle', 220, t + 0.450, 0.400, 0.065, {
        attack: 0.030, release: 0.170,
        vibRate: 3.5, vibDepth: 7,
        filter: { type: 'lowpass', frequency: 1000, Q: 1.0 },
      });
    } catch (e) {}
  }

  /**
   * REFOCUS — "oh good, you're back. I knew you would."
   * Sunrise after clouds — warm ascending glide with vibrato fading in.
   * Axes: 320→480 Hz / sine / 300ms glide + harmonic overlay / vibrato ramps IN from start
   */
  function _refocus() {
    if (!_ok('refocus')) return;
    try {
      const t = ctx.currentTime;
      // Main: sine 320→480 Hz over 300ms. Attack 30ms, release 80ms.
      // Vibrato fades IN: lfoGain ramps 0→8 over the full 300ms
      const osc1  = new OscillatorNode(ctx, { type: 'sine', frequency: 320 });
      const g1    = new GainNode(ctx, { gain: 0 });
      const lfo1  = new OscillatorNode(ctx, { type: 'sine', frequency: 5 });
      const lfoG1 = new GainNode(ctx, { gain: 0 });
      lfo1.connect(lfoG1); lfoG1.connect(osc1.frequency);
      lfoG1.gain.setValueAtTime(0, t);
      lfoG1.gain.linearRampToValueAtTime(8, t + 0.300);
      osc1.frequency.setValueAtTime(320, t);
      osc1.frequency.exponentialRampToValueAtTime(480, t + 0.300);
      g1.gain.setValueAtTime(0, t);
      g1.gain.linearRampToValueAtTime(0.07, t + 0.030);
      g1.gain.setValueAtTime(0.07, t + 0.220);
      g1.gain.linearRampToValueAtTime(0, t + 0.300);
      osc1.connect(g1); g1.connect(masterGain);
      // Harmonic: sine 640 Hz, 200ms, starts at 100ms of main, gain 0.035
      _osc('sine', 640, t + 0.100, 0.200, 0.035, {
        attack: 0.015, release: 0.080,
      });
      [osc1, lfo1].forEach(o => { o.start(t); o.stop(t + 0.320); });
      osc1.onended = () => { try { g1.disconnect(); lfoG1.disconnect(); lfo1.disconnect(); } catch(_) {} };
    } catch (e) {}
  }

  /**
   * BREAK_START — "okay, rest. I'll wait."
   * Single descending note — permission to stop, calm.
   * Axes: 520→380 Hz / sine / 250ms / vibrato gently enters at tail only
   */
  function _break_start() {
    if (!_ok('break_start')) return;
    try {
      const t = ctx.currentTime;
      // Sine 520→380 Hz over 250ms. Vibrato kicks in at 150ms (tail only).
      const osc  = new OscillatorNode(ctx, { type: 'sine', frequency: 520 });
      const g    = new GainNode(ctx, { gain: 0 });
      const lfo  = new OscillatorNode(ctx, { type: 'sine', frequency: 4 });
      const lfoG = new GainNode(ctx, { gain: 0 });
      lfo.connect(lfoG); lfoG.connect(osc.frequency);
      lfoG.gain.setValueAtTime(0, t + 0.150);
      lfoG.gain.linearRampToValueAtTime(5, t + 0.250);
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(380, t + 0.250);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.025);
      g.gain.setValueAtTime(0.06, t + 0.025);
      g.gain.linearRampToValueAtTime(0, t + 0.250);
      osc.connect(g); g.connect(masterGain);
      [osc, lfo].forEach(o => { o.start(t); o.stop(t + 0.270); });
      osc.onended = () => { try { g.disconnect(); lfoG.disconnect(); } catch(_) {} };
    } catch (e) {}
  }

  /**
   * BREAK_END — "ready when you are — soft nudge back"
   * Two gentle ascending steps. Not urgent, just present.
   * Axes: 400→520 Hz / sine / two-note A+D then A+S+R / no modulation
   */
  function _break_end() {
    if (!_ok('break_end')) return;
    try {
      const t = ctx.currentTime;
      // Note 1: sine 400 Hz, 160ms. Attack 15ms, decay 145ms.
      _osc('sine', 400, t, 0.160, 0.065, {
        attack: 0.015, decay: 0.145, sustain: 0,
      });
      // [80ms gap]
      // Note 2: sine 520 Hz, 220ms. Attack 12ms, sustain 120ms, release 88ms.
      _osc('sine', 520, t + 0.240, 0.220, 0.065, {
        attack: 0.012, release: 0.088,
      });
    } catch (e) {}
  }

  /**
   * BREAK_OVER — "hey, break time's up!"
   * Three ascending alert tones with a short gap between each.
   * More prominent than break_end — meant to be heard from across the room.
   * Axes: 440→554→659 Hz (A4→C#5→E5) / sine / quick A+R per note
   */
  function _break_over() {
    if (!_ok('break_over')) return;
    try {
      const t = ctx.currentTime;
      // Note 1: A4 440 Hz, 180ms
      _osc('sine', 440, t,        0.18, 0.10, { attack: 0.010, release: 0.070 });
      // Note 2: C#5 554 Hz, 180ms (after 60ms gap)
      _osc('sine', 554, t + 0.24, 0.18, 0.10, { attack: 0.010, release: 0.070 });
      // Note 3: E5 659 Hz, 280ms (after 60ms gap) — held longer for emphasis
      _osc('sine', 659, t + 0.48, 0.28, 0.10, { attack: 0.010, release: 0.120 });
    } catch (e) {}
  }

  // ── Retained ported sounds (no new spec in Chunk 3) ───────────────────────

  // Sleepy yawn — long realistic "aaaahhh~mmm"
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

  // Sulking sigh — long heavy "haahh..." deflating breath
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

  // Surprise gasp — "oh!" with startled breath (triggered by userSurprised)
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

  // User returned — detuned-pair fairy greeting cascade with full shimmer stack and trill.
  // Three ascending chorus-pair chimes, stacked 2×+3× overtones, ends with ascending trill.
  function _welcomeBack() {
    if (!_ok('welcomeBack')) return;
    try {
      const t = ctx.currentTime;
      // Airy gasp of joy
      _breath(t, 0.032, 0.012, 4200);

      // Chime 1: chorus pair 636+644 Hz, 90ms
      _osc('sine', 636, t + 0.018, 0.090, 0.055, { attack: 0.004, decay: 0.086, sustain: 0 });
      _osc('sine', 644, t + 0.018, 0.090, 0.050, { attack: 0.004, decay: 0.086, sustain: 0 });
      _osc('triangle', 1280, t + 0.020, 0.062, 0.022, { attack: 0.003, decay: 0.059, sustain: 0 });
      _osc('triangle', 1920, t + 0.022, 0.042, 0.012, { attack: 0.003, decay: 0.039, sustain: 0 });

      // Chime 2: chorus pair 836+844 Hz, 100ms at +125ms
      _osc('sine', 836, t + 0.125, 0.100, 0.055, { attack: 0.004, decay: 0.096, sustain: 0 });
      _osc('sine', 844, t + 0.125, 0.100, 0.050, { attack: 0.004, decay: 0.096, sustain: 0 });
      _osc('triangle', 1680, t + 0.127, 0.070, 0.022, { attack: 0.003, decay: 0.067, sustain: 0 });
      _osc('triangle', 2520, t + 0.129, 0.048, 0.012, { attack: 0.003, decay: 0.045, sustain: 0 });
      _breath(t + 0.130, 0.028, 0.007, 4500);

      // Chime 3: chorus pair 1076+1084 Hz, 155ms at +240ms — flutter vibrato + full shimmer
      _osc('sine', 1076, t + 0.240, 0.155, 0.055, {
        attack: 0.004, decay: 0.151, sustain: 0, vibRate: 9, vibDepth: 13,
      });
      _osc('sine', 1084, t + 0.240, 0.155, 0.050, {
        attack: 0.004, decay: 0.151, sustain: 0, vibRate: 9, vibDepth: 16,
      });
      _osc('triangle', 2160, t + 0.242, 0.108, 0.022, { attack: 0.003, decay: 0.105, sustain: 0 });
      _osc('triangle', 3240, t + 0.244, 0.075, 0.014, { attack: 0.003, decay: 0.072, sustain: 0 });
      // Sparkle breath at the peak
      _breath(t + 0.246, 0.055, 0.009, 5000);

      // Ascending fairy trill — "yay you're back!" three glitter pips
      _osc('sine', 1680, t + 0.410, 0.030, 0.038, { attack: 0.002, decay: 0.028, sustain: 0 });
      _osc('sine', 2016, t + 0.444, 0.030, 0.035, { attack: 0.002, decay: 0.028, sustain: 0 });
      _osc('sine', 2400, t + 0.478, 0.036, 0.030, { attack: 0.002, decay: 0.034, sustain: 0 });
    } catch (e) {}
  }

  // Relief sigh — gentle "ahh~" on recovery from scared/sad/crying/forgiven
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

  // ── Public surface ─────────────────────────────────────────────────────────

  function setTicksEnabled(v) { _ticksEnabled = !!v; }

  return { init, play, setVolume, mute, unmute, setNightGainMult, setMutePreset, getMutePreset, setTicksEnabled };

})();
