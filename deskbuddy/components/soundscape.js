/**
 * Soundscape — Ambient background drone for DeskBuddy.
 *
 * Generates a continuous low-frequency drone that creates a subtle sense of
 * presence and helps the user enter a focused state. Inspired by binaural
 * study soundscapes and Lo-Fi ambient pads.
 *
 * Architecture:
 *   Two detuned oscillators → lowpass filter → droneGain → masterGain-bypass gain → ctx.destination
 *   A slow LFO wobbles the filter cutoff to keep it alive and organic.
 *
 * Time-period tints (setTimeTint):
 *   MORNING   58 Hz — slightly brighter, livelier start to the day
 *   AFTERNOON 55 Hz — neutral baseline
 *   EVENING   52 Hz — warmer, slightly lower
 *   NIGHT     49 Hz — deep, melancholic; harmonic detuned -5 cents in FOCUSED
 *
 * Volume is intentionally kept very low (droneGain ≤ 0.05) — it should be
 * felt rather than heard, sitting below the emotion sounds.
 */
const Soundscape = (() => {

  // ── Base frequencies per time period ────────────────────────────────────────
  const PERIOD_FREQ = {
    MORNING:   58,
    AFTERNOON: 55,
    EVENING:   52,
    NIGHT:     49,
  };

  // Harmonic ratios for a 3-partial chord (root, fifth, minor-seventh)
  const HARMONIC_RATIOS = [1.0, 1.5, 1.78];

  // How much the NIGHT period detunes the harmonic in cents (−5¢ → melancholic)
  const NIGHT_HARMONIC_DETUNE_CENTS = -5;

  // ── Module state ─────────────────────────────────────────────────────────────
  let _ctx       = null;
  let _out       = null;   // output gain node that connects to ctx.destination
  let _ready     = false;
  let _running   = false;

  // Active oscillator nodes (recreated on tint change)
  let _oscs      = [];     // OscillatorNode[]
  let _gains     = [];     // GainNode[] (per-partial)
  let _filter    = null;   // BiquadFilterNode (shared lowpass)
  let _lfo       = null;   // LFO oscillator
  let _lfoGain   = null;   // LFO gain into filter freq

  let _currentPeriod = 'AFTERNOON';
  let _baseFreq      = PERIOD_FREQ['AFTERNOON'];

  // ── Internal helpers ─────────────────────────────────────────────────────────

  /**
   * Cents offset → frequency multiplier.
   * 100 cents = 1 semitone. f_new = f * 2^(cents/1200)
   */
  function _centsToMult(cents) {
    return Math.pow(2, cents / 1200);
  }

  /** Smoothly ramp a gain node to a target value over `timeS` seconds. */
  function _rampGain(gainNode, target, timeS) {
    if (!_ctx) return;
    const now = _ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(target, now + timeS);
  }

  /** Smoothly ramp an oscillator frequency over `timeS` seconds. */
  function _rampFreq(oscNode, target, timeS) {
    if (!_ctx || target <= 0) return;
    const now = _ctx.currentTime;
    oscNode.frequency.cancelScheduledValues(now);
    oscNode.frequency.setValueAtTime(oscNode.frequency.value, now);
    oscNode.frequency.linearRampToValueAtTime(target, now + timeS);
  }

  /**
   * Build the drone graph from scratch.
   * Called on first start and on tint change if ctx exists.
   * Fades in over 3 seconds for a non-jarring entry.
   */
  function _buildGraph(period) {
    if (!_ctx) return;

    _tearDownGraph();

    const base   = PERIOD_FREQ[period] || PERIOD_FREQ['AFTERNOON'];
    const isNight = period === 'NIGHT';

    // Shared lowpass to soften partials
    _filter = new BiquadFilterNode(_ctx, { type: 'lowpass', frequency: 260, Q: 0.6 });

    // LFO gently wobbles the filter cutoff (±18 Hz, 0.07 Hz cycle)
    _lfo = new OscillatorNode(_ctx, { type: 'sine', frequency: 0.07 });
    _lfoGain = new GainNode(_ctx, { gain: 18 });
    _lfo.connect(_lfoGain);
    _lfoGain.connect(_filter.frequency);
    _lfo.start();

    // Three partials
    for (let i = 0; i < HARMONIC_RATIOS.length; i++) {
      let freq = base * HARMONIC_RATIOS[i];

      // NIGHT: detune the harmonic (index 1) by −5 cents
      if (isNight && i === 1) {
        freq *= _centsToMult(NIGHT_HARMONIC_DETUNE_CENTS);
      }

      // Each partial has two slightly-detuned oscillators for warmth
      const osc1 = new OscillatorNode(_ctx, { type: 'sine', frequency: freq });
      const osc2 = new OscillatorNode(_ctx, { type: 'sine', frequency: freq * _centsToMult(4) });

      // Per-partial gain envelope — higher partials quieter
      const partialGainValues = [0.034, 0.018, 0.011];
      const gNode = new GainNode(_ctx, { gain: 0 });  // start at 0 for fade-in

      osc1.connect(gNode);
      osc2.connect(gNode);
      gNode.connect(_filter);

      osc1.start();
      osc2.start();

      // Fade in over 3 s
      _rampGain(gNode, partialGainValues[i], 3.0);

      _oscs.push(osc1, osc2);
      _gains.push(gNode);
    }

    _filter.connect(_out);
  }

  /** Gracefully fade out and disconnect existing graph nodes. */
  function _tearDownGraph() {
    if (!_ctx) return;

    // Fade out existing gains then disconnect
    const fadeTime = 1.5;
    _gains.forEach(g => {
      try { _rampGain(g, 0, fadeTime); } catch (e) {}
    });

    const oscs  = _oscs.slice();
    const gains = _gains.slice();
    const filt  = _filter;
    const lfo   = _lfo;
    const lfoG  = _lfoGain;

    setTimeout(() => {
      oscs.forEach(o => { try { o.stop(); o.disconnect(); } catch (e) {} });
      gains.forEach(g => { try { g.disconnect(); } catch (e) {} });
      if (filt) try { filt.disconnect(); } catch (e) {}
      if (lfo)  try { lfo.stop(); lfo.disconnect(); } catch (e) {}
      if (lfoG) try { lfoG.disconnect(); } catch (e) {}
    }, (fadeTime + 0.1) * 1000);

    _oscs  = [];
    _gains = [];
    _filter = null;
    _lfo    = null;
    _lfoGain = null;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * init() — set up AudioContext and output gain, connect to destination.
   * Deferred until first user gesture (same strategy as sounds.js).
   * Safe to call multiple times.
   */
  function init() {
    if (_ready) return;

    const start = () => {
      if (_ready) return;
      try {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
        _out = new GainNode(_ctx, { gain: 1.0 });
        _out.connect(_ctx.destination);
        if (_ctx.state === 'suspended') _ctx.resume();
        _ready = true;

        // Start drone immediately (AFTERNOON default)
        _running = true;
        _buildGraph(_currentPeriod);
      } catch (e) {
        console.warn('[Soundscape] Init failed:', e);
      }
    };

    document.addEventListener('keydown',   start, { once: true });
    document.addEventListener('mousedown', start, { once: true });
    document.addEventListener('click',     start, { once: true });
    // Fallback for Electron — often no explicit user gesture before timer starts
    setTimeout(start, 600);
  }

  /**
   * setTimeTint(period) — crossfade the drone to match the given time period.
   * period: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT'
   * Safe to call repeatedly; no-ops if period hasn't changed.
   */
  function setTimeTint(period) {
    if (!PERIOD_FREQ[period]) return;
    if (period === _currentPeriod && _running) return;

    _currentPeriod = period;
    _baseFreq      = PERIOD_FREQ[period];

    // Apply period data-attribute to body for CSS hooks
    document.body.dataset.timePeriod = period;

    if (!_ready || !_running) return;

    // If AudioContext suspended (browser policy), resume
    if (_ctx.state === 'suspended') _ctx.resume();

    // Rebuild graph with new frequencies (includes internal fade out/in)
    _buildGraph(period);
  }

  /**
   * stop() — fade out and silence the drone entirely.
   * Used when the app is backgrounded or user mutes all audio.
   */
  function stop() {
    if (!_running) return;
    _running = false;
    _tearDownGraph();
  }

  /**
   * resume() — restart the drone after stop().
   */
  function resume() {
    if (_running) return;
    _running = true;
    if (_ready) _buildGraph(_currentPeriod);
  }

  return { init, setTimeTint, stop, resume };

})();
