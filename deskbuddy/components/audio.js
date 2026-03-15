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

  const COOLDOWN_MS = 1200;

  function init() {
    // AudioContext must be created on user interaction (browser security policy)
    const start = () => {
      if (ready) return;
      try {
        ctx   = new (window.AudioContext || window.webkitAudioContext)();
        ready = true;
        setInterval(_pollEmotion,      150);  // check emotion changes
        setInterval(_pollExpressions,  500);  // check user face expressions
      } catch(e) { console.warn('[Audio] Init failed:', e); }
    };
    document.addEventListener('keydown',   start, { once: true });
    document.addEventListener('mousedown', start, { once: true });
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
      // User just smiled — DeskBuddy chirps back
      // face-api equivalent: expression "happy" confidence crossed threshold
      _happyChirp(0.7);
    }

    if (p.userSurprised && !lastSurprised) {
      // User looks surprised — DeskBuddy startles
      // face-api equivalent: expression "surprised" confidence crossed threshold
      _scaredYelp(0.45);
    }

    lastSmiling   = p.userSmiling;
    lastSurprised = p.userSurprised;
  }

  function _playForTransition(from, to) {
    switch(to) {
      case 'curious':    _curiousTrill();      break;
      case 'suspicious': _suspiciousHum();     break;
      case 'pouty':      _poutyHuff();         break;
      case 'grumpy':     _grumpyDoubleHuff();  break;
      case 'scared':     _scaredYelp(1.0);    break;
      case 'sad':        _sadWhimper();        break;
      case 'sleepy':     _sleepyMurmur();      break;
      case 'overjoyed':  _overjoyedFanfare();  break;
      case 'focused':
      case 'idle':
        // Returning after scary absence → happy relief chirp
        if (from === 'scared' || from === 'sad' || from === 'crying') {
          _happyChirp(1.0);
        }
        break;
    }
  }

  // Guard: cooldown prevents same sound from playing repeatedly
  function _ok(type) {
    if (!ready || !ctx) return false;
    const now = Date.now();
    if (cooldowns[type] && now - cooldowns[type] < COOLDOWN_MS) return false;
    cooldowns[type] = now;
    return true;
  }

  // ── SOUND RECIPES ─────────────────────────────────────────────────────────
  // All synthesized from oscillators. Max gain: 0.12.

  function _happyChirp(vol) {
    if (!_ok('happy')) return;
    vol = (vol || 1) * 0.10;
    try {
      const t = ctx.currentTime;
      [[520,720,0,vol],[630,850,0.08,vol*0.85]].forEach(([f1,f2,d,g]) => {
        const o = new OscillatorNode(ctx, { type:'sine', frequency:f1 });
        o.frequency.linearRampToValueAtTime(f2, t+d+0.12);
        const gn = new GainNode(ctx, { gain:0 });
        gn.gain.linearRampToValueAtTime(g, t+d+0.01);
        gn.gain.linearRampToValueAtTime(0, t+d+0.12);
        o.connect(gn).connect(ctx.destination);
        o.start(t+d); o.stop(t+d+0.14);
      });
    } catch(_) {}
  }

  function _curiousTrill() {
    if (!_ok('curious')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:480 });
      const lfo = new OscillatorNode(ctx, { type:'sine', frequency:16 });
      const lg = new GainNode(ctx, { gain:55 });
      lfo.connect(lg).connect(o.frequency);
      o.frequency.linearRampToValueAtTime(545, t+0.26);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.09, t+0.015);
      g.gain.linearRampToValueAtTime(0, t+0.28);
      o.connect(g).connect(ctx.destination);
      lfo.start(t); o.start(t); lfo.stop(t+0.29); o.stop(t+0.29);
    } catch(_) {}
  }

  function _sleepyMurmur() {
    if (!_ok('sleepy')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:175 });
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.07, t+0.12);
      g.gain.linearRampToValueAtTime(0, t+0.70);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t+0.71);
    } catch(_) {}
  }

  function _suspiciousHum() {
    if (!_ok('suspicious')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:145 });
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.08, t+0.04);
      g.gain.linearRampToValueAtTime(0.08, t+0.38);
      g.gain.linearRampToValueAtTime(0, t+0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t+0.46);
    } catch(_) {}
  }

  function _poutyHuff() {
    if (!_ok('pouty')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'triangle', frequency:215 });
      o.frequency.linearRampToValueAtTime(138, t+0.32);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.09, t+0.008);
      g.gain.linearRampToValueAtTime(0, t+0.32);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t+0.33);
    } catch(_) {}
  }

  function _grumpyDoubleHuff() {
    if (!_ok('grumpy')) return;
    try {
      const t = ctx.currentTime;
      [0, 0.225].forEach((off, i) => {
        const o = new OscillatorNode(ctx, { type:'triangle', frequency: 228 + i*7 });
        const g = new GainNode(ctx, { gain:0 });
        g.gain.linearRampToValueAtTime(0.11, t+off+0.008);
        g.gain.linearRampToValueAtTime(0, t+off+0.195);
        o.connect(g).connect(ctx.destination);
        o.start(t+off); o.stop(t+off+0.20);
      });
    } catch(_) {}
  }

  function _scaredYelp(vol) {
    if (!_ok('scared')) return;
    vol = (vol || 1) * 0.10;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:590 });
      o.frequency.exponentialRampToValueAtTime(1080, t+0.115);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(vol, t+0.005);
      g.gain.linearRampToValueAtTime(0, t+0.115);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t+0.12);
    } catch(_) {}
  }

  function _sadWhimper() {
    if (!_ok('sad')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:345 });
      o.frequency.linearRampToValueAtTime(218, t+0.52);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.07, t+0.02);
      g.gain.linearRampToValueAtTime(0, t+0.54);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t+0.55);
    } catch(_) {}
  }

  function _overjoyedFanfare() {
    if (!_ok('overjoyed')) return;
    try {
      const t = ctx.currentTime;
      [[520,705,0.10,0],[645,875,0.12,0.17],[775,1065,0.11,0.32]].forEach(([f1,f2,g,d]) => {
        const o = new OscillatorNode(ctx, { type:'sine', frequency:f1 });
        o.frequency.exponentialRampToValueAtTime(f2, t+d+0.09);
        const gn = new GainNode(ctx, { gain:0 });
        gn.gain.linearRampToValueAtTime(g, t+d+0.008);
        gn.gain.linearRampToValueAtTime(0, t+d+0.095);
        o.connect(gn).connect(ctx.destination);
        o.start(t+d); o.stop(t+d+0.10);
      });
    } catch(_) {}
  }

  return { init };
})();
