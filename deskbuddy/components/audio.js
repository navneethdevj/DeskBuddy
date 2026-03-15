/**
 * Audio — Web Audio API creature sounds. No files. No libraries.
 *
 * Two sound triggers:
 *  1. Emotion transitions — window._emotionChanged set by brain.js
 *  2. User expression reactions — perception.userSmiling / userSurprised
 *     Concept: https://github.com/justadudewhohacks/face-api.js
 *     face-api fires on expression detection — we do the same via blendshapes.
 *
 * CRITICAL: Sounds only play when window.perception.facePresent === true.
 * If face is not detected — complete silence. No random sounds ever.
 * Max gain: 0.12 on any oscillator.
 */
const Audio = (() => {

  let ctx           = null;
  let ready         = false;
  let lastChange    = null;
  let cooldowns     = {};
  let lastSmiling   = false;
  let lastSurprised = false;

  const COOLDOWN_MS = 800;

  function init() {
    const start = () => {
      if (ready) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Resume suspended AudioContext (required by Chromium autoplay policy)
        if (ctx.state === 'suspended') ctx.resume();
        ready = true;
        setInterval(_pollEmotion,      150);  // check emotion changes
        setInterval(_pollExpressions,  400);  // check user face expressions
      } catch(e) { console.warn('[Audio] Init failed:', e); }
    };
    document.addEventListener('keydown',   start, { once: true });
    document.addEventListener('mousedown', start, { once: true });
    document.addEventListener('click',     start, { once: true });
    // Electron may allow autoplay without gesture — try after short delay
    setTimeout(start, 500);
  }

  // Poll emotion transitions written by brain.js
  function _pollEmotion() {
    // STRICT: no sounds without face
    if (!window.perception?.facePresent) return;

    const c = window._emotionChanged;
    if (!c || c === lastChange) return;
    lastChange = c;
    _playForTransition(c.from, c.to);
  }

  // React to user facial expressions — face-api.js concept
  // face-api detects happy/surprised via neural net
  // We detect the same via MediaPipe mouthSmile + jawOpen blendshapes
  function _pollExpressions() {
    // STRICT: no sounds without face
    if (!window.perception?.facePresent) return;

    const p = window.perception;

    if (p.userSmiling && !lastSmiling) {
      // User just smiled — DeskBuddy chirps back happily
      // face-api equivalent: expression "happy" confidence crossed threshold
      _happyChirp(0.8);
    }

    if (p.userSurprised && !lastSurprised) {
      // User looks surprised — DeskBuddy does a cute surprised squeak
      // face-api equivalent: expression "surprised" confidence crossed threshold
      _surpriseSqueak(0.6);
    }

    lastSmiling   = p.userSmiling;
    lastSurprised = p.userSurprised;
  }

  function _playForTransition(from, to) {
    switch(to) {
      case 'curious':    _curiousTrill();      break;
      case 'suspicious': _suspiciousHum();     break;
      case 'pouty':      _poutyWhine();        break;
      case 'grumpy':     _grumpyGrumble();     break;
      case 'scared':     _scaredEep();         break;
      case 'sad':        _sadWhimper();        break;
      case 'sleepy':     _sleepyMurmur();      break;
      case 'overjoyed':  _overjoyedFanfare();  break;
      case 'happy':      _contentCoo();        break;
      case 'focused':
      case 'idle':
        // Returning after scary absence → happy relief chirp
        if (from === 'scared' || from === 'sad' || from === 'crying') {
          _reliefChirp();
        }
        break;
    }
  }

  // Guard: cooldown prevents same sound from playing repeatedly
  function _ok(type) {
    if (!ready || !ctx) return false;
    // Resume if context got suspended (tab switch, etc.)
    if (ctx.state === 'suspended') { ctx.resume(); return false; }
    const now = Date.now();
    if (cooldowns[type] && now - cooldowns[type] < COOLDOWN_MS) return false;
    cooldowns[type] = now;
    return true;
  }

  // ── CUTE SOUND RECIPES ────────────────────────────────────────────────────
  // Designed to sound like a tiny adorable creature. Higher pitches, warmer
  // triangle waves, musical intervals, gentle vibrato. All gain ≤ 0.12.
  // Every ramp is anchored with setValueAtTime for correct scheduling.

  // Cute ascending "twee-dee!" chirp — smile reaction & happy moments
  function _happyChirp(vol) {
    if (!_ok('happy')) return;
    vol = Math.min((vol || 1) * 0.12, 0.12);
    try {
      const t = ctx.currentTime;
      // Two-note ascending chirp with musical third interval
      [[1047, 1319, 0, vol], [1319, 1568, 0.09, vol * 0.9]].forEach(([f1, f2, d, g]) => {
        const o = new OscillatorNode(ctx, { type: 'triangle', frequency: f1 });
        o.frequency.setValueAtTime(f1, t + d);
        o.frequency.linearRampToValueAtTime(f2, t + d + 0.10);
        const gn = new GainNode(ctx, { gain: 0 });
        gn.gain.setValueAtTime(0, t + d);
        gn.gain.linearRampToValueAtTime(g, t + d + 0.008);
        gn.gain.setValueAtTime(g, t + d + 0.06);
        gn.gain.linearRampToValueAtTime(0, t + d + 0.11);
        o.connect(gn).connect(ctx.destination);
        o.start(t + d); o.stop(t + d + 0.13);
      });
    } catch(_) {}
  }

  // Gentle "ooh?" trill — curious creature peeking with vibrato
  function _curiousTrill() {
    if (!_ok('curious')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type: 'triangle', frequency: 880 });
      o.frequency.setValueAtTime(880, t);
      o.frequency.linearRampToValueAtTime(1100, t + 0.25);
      // Gentle vibrato for warmth
      const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 12 });
      const lg = new GainNode(ctx, { gain: 30 });
      lfo.connect(lg).connect(o.frequency);
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.02);
      g.gain.setValueAtTime(0.09, t + 0.18);
      g.gain.linearRampToValueAtTime(0, t + 0.28);
      o.connect(g).connect(ctx.destination);
      lfo.start(t); o.start(t); lfo.stop(t + 0.30); o.stop(t + 0.30);
    } catch(_) {}
  }

  // Soft falling "mmm..." — sleepy creature drifting off
  function _sleepyMurmur() {
    if (!_ok('sleepy')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: 330 });
      o.frequency.setValueAtTime(330, t);
      o.frequency.linearRampToValueAtTime(220, t + 0.60);
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.08);
      g.gain.setValueAtTime(0.07, t + 0.30);
      g.gain.linearRampToValueAtTime(0, t + 0.65);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.68);
    } catch(_) {}
  }

  // Low questioning "hmm..." — suspicious squint
  function _suspiciousHum() {
    if (!_ok('suspicious')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: 280 });
      o.frequency.setValueAtTime(280, t);
      o.frequency.linearRampToValueAtTime(260, t + 0.15);
      o.frequency.setValueAtTime(260, t + 0.15);
      o.frequency.linearRampToValueAtTime(290, t + 0.35);
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.03);
      g.gain.setValueAtTime(0.08, t + 0.30);
      g.gain.linearRampToValueAtTime(0, t + 0.40);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.42);
    } catch(_) {}
  }

  // Cute descending "mweh..." — pouty whine
  function _poutyWhine() {
    if (!_ok('pouty')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type: 'triangle', frequency: 660 });
      o.frequency.setValueAtTime(660, t);
      o.frequency.linearRampToValueAtTime(440, t + 0.25);
      o.frequency.setValueAtTime(440, t + 0.25);
      o.frequency.linearRampToValueAtTime(380, t + 0.35);
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.01);
      g.gain.setValueAtTime(0.09, t + 0.20);
      g.gain.linearRampToValueAtTime(0, t + 0.36);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.38);
    } catch(_) {}
  }

  // Double low "hmph hmph" — grumpy grumble
  function _grumpyGrumble() {
    if (!_ok('grumpy')) return;
    try {
      const t = ctx.currentTime;
      [0, 0.20].forEach((off, i) => {
        const freq = 200 - i * 15;
        const o = new OscillatorNode(ctx, { type: 'triangle', frequency: freq });
        o.frequency.setValueAtTime(freq, t + off);
        o.frequency.linearRampToValueAtTime(freq - 30, t + off + 0.12);
        const g = new GainNode(ctx, { gain: 0 });
        g.gain.setValueAtTime(0, t + off);
        g.gain.linearRampToValueAtTime(0.10, t + off + 0.01);
        g.gain.setValueAtTime(0.10, t + off + 0.06);
        g.gain.linearRampToValueAtTime(0, t + off + 0.14);
        o.connect(g).connect(ctx.destination);
        o.start(t + off); o.stop(t + off + 0.16);
      });
    } catch(_) {}
  }

  // Tiny "eep!" — scared creature startled
  function _scaredEep() {
    if (!_ok('scared')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: 800 });
      o.frequency.setValueAtTime(800, t);
      o.frequency.exponentialRampToValueAtTime(1600, t + 0.06);
      o.frequency.setValueAtTime(1600, t + 0.06);
      o.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.10, t + 0.005);
      g.gain.setValueAtTime(0.10, t + 0.04);
      g.gain.linearRampToValueAtTime(0, t + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.14);
    } catch(_) {}
  }

  // Cute surprised squeak — when user raises eyebrows
  function _surpriseSqueak(vol) {
    if (!_ok('surprise')) return;
    vol = Math.min((vol || 1) * 0.10, 0.12);
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type: 'triangle', frequency: 900 });
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(1400, t + 0.08);
      o.frequency.setValueAtTime(1400, t + 0.08);
      o.frequency.linearRampToValueAtTime(1100, t + 0.15);
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.005);
      g.gain.setValueAtTime(vol, t + 0.06);
      g.gain.linearRampToValueAtTime(0, t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.17);
    } catch(_) {}
  }

  // Sad descending whimper "oooh..." with emotional wobble
  function _sadWhimper() {
    if (!_ok('sad')) return;
    try {
      const t = ctx.currentTime;
      // Two overlapping tones for richer, sadder sound
      [[550, 380, 0, 0.07], [440, 310, 0.05, 0.06]].forEach(([f1, f2, d, vol]) => {
        const o = new OscillatorNode(ctx, { type: 'sine', frequency: f1 });
        o.frequency.setValueAtTime(f1, t + d);
        o.frequency.linearRampToValueAtTime(f2, t + d + 0.45);
        // Gentle vibrato for emotional wobble
        const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 5 });
        const lg = new GainNode(ctx, { gain: 15 });
        lfo.connect(lg).connect(o.frequency);
        const g = new GainNode(ctx, { gain: 0 });
        g.gain.setValueAtTime(0, t + d);
        g.gain.linearRampToValueAtTime(vol, t + d + 0.03);
        g.gain.setValueAtTime(vol, t + d + 0.25);
        g.gain.linearRampToValueAtTime(0, t + d + 0.50);
        o.connect(g).connect(ctx.destination);
        lfo.start(t + d); o.start(t + d);
        lfo.stop(t + d + 0.52); o.stop(t + d + 0.52);
      });
    } catch(_) {}
  }

  // Triumphant ascending triple chirp "dee-dee-DEE!" — overjoyed
  function _overjoyedFanfare() {
    if (!_ok('overjoyed')) return;
    try {
      const t = ctx.currentTime;
      [[1047, 1175, 0.10, 0], [1319, 1397, 0.11, 0.10], [1568, 1760, 0.12, 0.20]].forEach(([f1, f2, g, d]) => {
        const o = new OscillatorNode(ctx, { type: 'triangle', frequency: f1 });
        o.frequency.setValueAtTime(f1, t + d);
        o.frequency.linearRampToValueAtTime(f2, t + d + 0.09);
        const gn = new GainNode(ctx, { gain: 0 });
        gn.gain.setValueAtTime(0, t + d);
        gn.gain.linearRampToValueAtTime(g, t + d + 0.008);
        gn.gain.setValueAtTime(g, t + d + 0.05);
        gn.gain.linearRampToValueAtTime(0, t + d + 0.095);
        o.connect(gn).connect(ctx.destination);
        o.start(t + d); o.stop(t + d + 0.12);
      });
    } catch(_) {}
  }

  // Gentle warm "coo" — content/happy state transition
  function _contentCoo() {
    if (!_ok('content')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type: 'triangle', frequency: 660 });
      o.frequency.setValueAtTime(660, t);
      o.frequency.linearRampToValueAtTime(720, t + 0.08);
      o.frequency.setValueAtTime(720, t + 0.08);
      o.frequency.linearRampToValueAtTime(680, t + 0.18);
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.015);
      g.gain.setValueAtTime(0.08, t + 0.12);
      g.gain.linearRampToValueAtTime(0, t + 0.20);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.22);
    } catch(_) {}
  }

  // Ascending warm relief sigh — returning after being scared/sad
  function _reliefChirp() {
    if (!_ok('relief')) return;
    try {
      const t = ctx.currentTime;
      [[550, 0, 0.12, 0.08], [660, 0.10, 0.12, 0.09], [880, 0.20, 0.15, 0.10]].forEach(([f, d, dur, vol]) => {
        const o = new OscillatorNode(ctx, { type: 'triangle', frequency: f });
        o.frequency.setValueAtTime(f, t + d);
        const g = new GainNode(ctx, { gain: 0 });
        g.gain.setValueAtTime(0, t + d);
        g.gain.linearRampToValueAtTime(vol, t + d + 0.01);
        g.gain.setValueAtTime(vol, t + d + dur * 0.5);
        g.gain.linearRampToValueAtTime(0, t + d + dur);
        o.connect(g).connect(ctx.destination);
        o.start(t + d); o.stop(t + d + dur + 0.02);
      });
    } catch(_) {}
  }

  return { init };
})();
