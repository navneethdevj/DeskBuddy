/**
 * Audio — Web Audio API sound synthesis.
 * No audio files. No libraries. Pure oscillators.
 * All sounds are non-verbal creature sounds — cute, expressive, tiny.
 * Max gain: 0.15. All audio in try/catch — failure is always silent.
 *
 * window._emotionChanged = { from, to } is written by brain.js
 * whenever emotion transitions. Audio polls it every 200ms.
 */
const Audio = (() => {

  let ctx       = null;
  let ready     = false;
  let pitchMod  = 1.00;
  let cooldowns = {};
  let lastChange = null;

  const COOLDOWN_MS = 1000;

  function init() {
    const start = () => {
      if (ready) return;
      try {
        ctx   = new (window.AudioContext || window.webkitAudioContext)();
        ready = true;
        setInterval(_poll, 200);
      } catch (e) {}
    };
    document.addEventListener('keydown',   start, { once: true });
    document.addEventListener('mousedown', start, { once: true });
  }

  function setPitchMod(mod) { pitchMod = mod || 1.0; }

  function _poll() {
    const c = window._emotionChanged;
    if (!c || c === lastChange) return;
    lastChange = c;
    _playFor(c.from, c.to);
  }

  function _playFor(from, to) {
    switch (to) {
      case 'focused':
      case 'idle':
        if (from === 'overjoyed') forgivingSigh();
        else if (from && from !== 'focused' && from !== 'idle') happyChirp();
        break;
      case 'curious':      curiousTrill();      break;
      case 'embarrassed':  embarrassedSqueak(); break;
      case 'suspicious':   suspiciousHum();     break;
      case 'pouty':        poutyHuff();         break;
      case 'grumpy':       grumpyDoubleHuff();  break;
      case 'scared':       scaredYelp();        break;
      case 'sad':          sadWhimper();        break;
      case 'overjoyed':    overjoyedFanfare();  break;
      case 'sleepy':       sleepyMurmur();      break;
      // sulking: silence — the stare is the message
    }
  }

  function _ok(type) {
    if (!ready || !ctx) return false;
    const now = Date.now();
    if (cooldowns[type] && now - cooldowns[type] < COOLDOWN_MS) return false;
    cooldowns[type] = now;
    return true;
  }

  const hz = f => f * pitchMod;

  // ── happy chirp — "bwip-bwip!" ─────────────────────────────────────
  function happyChirp(vol) {
    if (!_ok('happyChirp')) return;
    vol = (vol || 1) * 0.11;
    try {
      const t = ctx.currentTime;
      [[hz(520), hz(720), 0, vol], [hz(630), hz(850), 0.08, vol*0.85]].forEach(([f1,f2,d,g]) => {
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

  // ── curious trill — "brrip?" ────────────────────────────────────────
  function curiousTrill(vol) {
    if (!_ok('curiousTrill')) return;
    vol = (vol || 1) * 0.10;
    try {
      const t = ctx.currentTime;
      const o   = new OscillatorNode(ctx, { type:'sine', frequency:hz(480) });
      const lfo = new OscillatorNode(ctx, { type:'sine', frequency:16 });
      const lg  = new GainNode(ctx, { gain:55 });
      lfo.connect(lg).connect(o.frequency);
      o.frequency.linearRampToValueAtTime(hz(545), t+0.26);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(vol, t+0.015); g.gain.linearRampToValueAtTime(0, t+0.28);
      o.connect(g).connect(ctx.destination);
      lfo.start(t); o.start(t); lfo.stop(t+0.29); o.stop(t+0.29);
    } catch(_) {}
  }

  // ── sleepy murmur — "mmmhh..." ──────────────────────────────────────
  function sleepyMurmur(vol) {
    if (!_ok('sleepyMurmur')) return;
    vol = (vol || 1) * 0.08;
    try {
      const t = ctx.currentTime;
      const o   = new OscillatorNode(ctx, { type:'sine', frequency:hz(175) });
      const lfo = new OscillatorNode(ctx, { type:'sine', frequency:1.4 });
      const lg  = new GainNode(ctx, { gain:7 });
      lfo.connect(lg).connect(o.frequency);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(vol, t+0.12); g.gain.linearRampToValueAtTime(0, t+0.70);
      o.connect(g).connect(ctx.destination);
      lfo.start(t); o.start(t); lfo.stop(t+0.71); o.stop(t+0.71);
    } catch(_) {}
  }

  // ── embarrassed squeak — "EEP—wiwiwi" ──────────────────────────────
  function embarrassedSqueak() {
    if (!_ok('embarrassedSqueak')) return;
    try {
      const t = ctx.currentTime;
      const o1 = new OscillatorNode(ctx, { type:'sine', frequency:hz(900) });
      o1.frequency.linearRampToValueAtTime(hz(620), t+0.085);
      const g1 = new GainNode(ctx, { gain:0 });
      g1.gain.linearRampToValueAtTime(0.11, t+0.005); g1.gain.linearRampToValueAtTime(0, t+0.085);
      o1.connect(g1).connect(ctx.destination); o1.start(t); o1.stop(t+0.09);

      const o2  = new OscillatorNode(ctx, { type:'sine', frequency:hz(490) });
      const lfo = new OscillatorNode(ctx, { type:'sine', frequency:22 });
      const lg  = new GainNode(ctx, { gain:42 });
      lfo.connect(lg).connect(o2.frequency);
      const g2 = new GainNode(ctx, { gain:0 });
      g2.gain.linearRampToValueAtTime(0.07, t+0.113); g2.gain.linearRampToValueAtTime(0, t+0.28);
      o2.connect(g2).connect(ctx.destination);
      lfo.start(t+0.103); o2.start(t+0.103); lfo.stop(t+0.29); o2.stop(t+0.29);
    } catch(_) {}
  }

  // ── suspicious hum ──────────────────────────────────────────────────
  function suspiciousHum() {
    if (!_ok('suspiciousHum')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:hz(145) });
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.09, t+0.04);
      g.gain.linearRampToValueAtTime(0.09, t+0.38); g.gain.linearRampToValueAtTime(0, t+0.45);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+0.46);
    } catch(_) {}
  }

  // ── pouty huff — "hrmmph." ──────────────────────────────────────────
  function poutyHuff() {
    if (!_ok('poutyHuff')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'triangle', frequency:hz(215) });
      o.frequency.linearRampToValueAtTime(hz(138), t+0.32);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.10, t+0.008); g.gain.linearRampToValueAtTime(0, t+0.32);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+0.33);
    } catch(_) {}
  }

  // ── grumpy double-huff — "brrt. brrt." ─────────────────────────────
  function grumpyDoubleHuff() {
    if (!_ok('grumpyDoubleHuff')) return;
    try {
      const t = ctx.currentTime;
      [0, 0.225].forEach((off, i) => {
        const o = new OscillatorNode(ctx, { type:'triangle', frequency:hz(228 + i*7) });
        const g = new GainNode(ctx, { gain:0 });
        g.gain.linearRampToValueAtTime(0.12, t+off+0.008); g.gain.linearRampToValueAtTime(0, t+off+0.195);
        o.connect(g).connect(ctx.destination); o.start(t+off); o.stop(t+off+0.20);
      });
    } catch(_) {}
  }

  // ── scared yelp — "wheep!" ──────────────────────────────────────────
  function scaredYelp() {
    if (!_ok('scaredYelp')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:hz(590) });
      o.frequency.exponentialRampToValueAtTime(hz(1080), t+0.115);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.12, t+0.005); g.gain.linearRampToValueAtTime(0, t+0.115);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+0.12);
    } catch(_) {}
  }

  // ── sad whimper ─────────────────────────────────────────────────────
  function sadWhimper(vol) {
    if (!_ok('sadWhimper')) return;
    vol = (vol || 1) * 0.07;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:hz(345) });
      o.frequency.linearRampToValueAtTime(hz(218), t+0.52);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(vol, t+0.02); g.gain.linearRampToValueAtTime(0, t+0.54);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+0.55);
    } catch(_) {}
  }

  // ── overjoyed fanfare — "bwip! bwip! BWIP!" ────────────────────────
  function overjoyedFanfare() {
    if (!_ok('overjoyedFanfare')) return;
    try {
      const t = ctx.currentTime;
      [[hz(520),hz(705),0.10,0],[hz(645),hz(875),0.12,0.17],[hz(775),hz(1065),0.14,0.32]].forEach(([f1,f2,g,d]) => {
        const o = new OscillatorNode(ctx, { type:'sine', frequency:f1 });
        o.frequency.exponentialRampToValueAtTime(f2, t+d+0.09);
        const gn = new GainNode(ctx, { gain:0 });
        gn.gain.linearRampToValueAtTime(g, t+d+0.008); gn.gain.linearRampToValueAtTime(0, t+d+0.095);
        o.connect(gn).connect(ctx.destination); o.start(t+d); o.stop(t+d+0.10);
      });
    } catch(_) {}
  }

  // ── forgiving sigh — "haaahhh..." ──────────────────────────────────
  function forgivingSigh() {
    if (!_ok('forgivingSigh')) return;
    try {
      const t = ctx.currentTime;
      const o = new OscillatorNode(ctx, { type:'sine', frequency:hz(375) });
      o.frequency.linearRampToValueAtTime(hz(192), t+0.75);
      const g = new GainNode(ctx, { gain:0 });
      g.gain.linearRampToValueAtTime(0.09, t+0.025); g.gain.linearRampToValueAtTime(0, t+0.75);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+0.76);
    } catch(_) {}
  }

  // ── crying ambient (looped, managed by brain.js) ────────────────────
  let _cryO1 = null, _cryO2 = null, _cryG = null;

  function startCryingAmbient() {
    if (!ready || !ctx || _cryO1) return;
    try {
      _cryG  = new GainNode(ctx, { gain:0 });
      _cryG.connect(ctx.destination);
      _cryO1 = new OscillatorNode(ctx, { type:'sine', frequency:161 });
      _cryO2 = new OscillatorNode(ctx, { type:'sine', frequency:166 });
      _cryO1.connect(_cryG); _cryO2.connect(_cryG);
      _cryO1.start(); _cryO2.start();
      _cryG.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 3.0);
    } catch(_) {}
  }

  function stopCryingAmbient() {
    if (!_cryG || !ctx) return;
    try {
      _cryG.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
      setTimeout(() => {
        try { _cryO1?.stop(); _cryO2?.stop(); } catch(_) {}
        _cryO1 = _cryO2 = _cryG = null;
      }, 1000);
    } catch(_) {}
  }

  return {
    init, setPitchMod,
    happyChirp, curiousTrill, sleepyMurmur, embarrassedSqueak,
    suspiciousHum, poutyHuff, grumpyDoubleHuff, scaredYelp,
    sadWhimper, overjoyedFanfare, forgivingSigh,
    startCryingAmbient, stopCryingAmbient
  };
})();
