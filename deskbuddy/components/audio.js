/**
 * Audio — Cute non-verbal creature voice using Web Audio API formant synthesis.
 *
 * Sound triggers:
 *  1. Emotion transitions — window._emotionChanged set by brain.js
 *  2. User expression reactions — perception.userSmiling / userSurprised
 *  3. Face presence changes — user leaving / returning
 *
 * Voice design: Two-formant synthesis (F1 body + F2 character) with vibrato,
 * tremolo, and noise bursts for breathy quality. Sounds like a tiny adorable
 * creature making non-verbal vocalizations — giggles, coos, whimpers, yawns.
 *
 * Max gain: 0.12 on any node.
 */
const Audio = (() => {

  let ctx           = null;
  let ready         = false;
  let lastChange    = null;
  let cooldowns     = {};
  let lastSmiling   = false;
  let lastSurprised = false;
  let lastFacePresent = undefined; // track face leave/return

  const COOLDOWN_MS = 800;

  function init() {
    const start = () => {
      if (ready) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        ready = true;
        setInterval(_pollEmotion,       150);
        setInterval(_pollExpressions,   400);
        setInterval(_pollFacePresence,  300);
      } catch(e) { console.warn('[Audio] Init failed:', e); }
    };
    document.addEventListener('keydown',   start, { once: true });
    document.addEventListener('mousedown', start, { once: true });
    document.addEventListener('click',     start, { once: true });
    setTimeout(start, 500);
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  function _pollEmotion() {
    const c = window._emotionChanged;
    if (!c || c === lastChange) return;
    lastChange = c;
    _playForTransition(c.from, c.to);
  }

  function _pollExpressions() {
    if (!window.perception?.facePresent) return;
    const p = window.perception;
    if (p.userSmiling && !lastSmiling)     _giggle();
    if (p.userSurprised && !lastSurprised) _surpriseGasp();
    lastSmiling   = p.userSmiling;
    lastSurprised = p.userSurprised;
  }

  function _pollFacePresence() {
    if (!ready) return;
    const present = !!window.perception?.facePresent;
    if (lastFacePresent === undefined) { lastFacePresent = present; return; }
    if (present && !lastFacePresent)   _welcomeBack();
    if (!present && lastFacePresent)   _userLeft();
    lastFacePresent = present;
  }

  function _playForTransition(from, to) {
    switch(to) {
      case 'curious':    _curiousOoh();        break;
      case 'suspicious': _suspiciousHmm();     break;
      case 'pouty':      _poutyMweh();         break;
      case 'grumpy':     _grumpyHmph();        break;
      case 'scared':     _scaredEep();         break;
      case 'sad':        _sadAww();            break;
      case 'crying':     _cryingSob();         break;
      case 'sleepy':     _sleepyYawn();        break;
      case 'overjoyed':  _overjoyedSqueal();   break;
      case 'sulking':    _sulkingSigh();       break;
      case 'happy':      _contentCoo();        break;
      case 'focused':    _focusedHum();        break;
      case 'idle':
        if (from === 'scared' || from === 'sad' || from === 'crying') {
          _welcomeBack();
        }
        break;
    }
  }

  // ── Guard ──────────────────────────────────────────────────────────────────

  function _ok(type) {
    if (!ready || !ctx) return false;
    if (ctx.state === 'suspended') { ctx.resume(); return false; }
    const now = Date.now();
    if (cooldowns[type] && now - cooldowns[type] < COOLDOWN_MS) return false;
    cooldowns[type] = now;
    return true;
  }

  // ── Voice helpers ──────────────────────────────────────────────────────────
  // Formant pair: two sine oscillators (F1=body, F2=brightness) through a
  // master gain create a vowel-like timbre.  Adding vibrato (freq LFO) and
  // tremolo (gain LFO) makes it feel like a living voice.

  function _formant(f1, f2, time, dur, vol, opts) {
    const o = opts || {};
    const vib = o.vibRate || 0;
    const vibD = o.vibDepth || 0;
    const trem = o.tremRate || 0;
    const tremD = o.tremDepth || 0;
    const slide = o.slideTo;
    const wave = o.wave || 'sine';
    const f2ratio = o.f2vol || 0.35;
    const attack = o.attack || 0.015;
    const release = o.release || (dur * 0.35);
    const sustainEnd = time + dur - release;

    // F1 — warm body
    const osc1 = new OscillatorNode(ctx, { type: wave, frequency: f1 });
    osc1.frequency.setValueAtTime(f1, time);
    if (slide) osc1.frequency.linearRampToValueAtTime(slide[0], time + dur * 0.9);

    // F2 — brightness / character
    const osc2 = new OscillatorNode(ctx, { type: 'sine', frequency: f2 });
    osc2.frequency.setValueAtTime(f2, time);
    if (slide) osc2.frequency.linearRampToValueAtTime(slide[1], time + dur * 0.9);

    // Mix F1 and F2
    const g1 = new GainNode(ctx, { gain: 0 });
    const g2 = new GainNode(ctx, { gain: 0 });
    osc1.connect(g1);
    osc2.connect(g2);

    // Envelope for each formant
    g1.gain.setValueAtTime(0, time);
    g1.gain.linearRampToValueAtTime(vol * (1 - f2ratio), time + attack);
    g1.gain.setValueAtTime(vol * (1 - f2ratio), sustainEnd);
    g1.gain.linearRampToValueAtTime(0, time + dur);

    g2.gain.setValueAtTime(0, time);
    g2.gain.linearRampToValueAtTime(vol * f2ratio, time + attack);
    g2.gain.setValueAtTime(vol * f2ratio, sustainEnd);
    g2.gain.linearRampToValueAtTime(0, time + dur);

    const master = new GainNode(ctx, { gain: 1 });
    g1.connect(master);
    g2.connect(master);

    // Vibrato — gentle frequency wobble like a real voice
    if (vib > 0) {
      const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: vib });
      const lg = new GainNode(ctx, { gain: vibD });
      lfo.connect(lg);
      lg.connect(osc1.frequency);
      lg.connect(osc2.frequency);
      lfo.start(time); lfo.stop(time + dur + 0.02);
    }

    // Tremolo — amplitude flutter for liveliness
    if (trem > 0) {
      const tLfo = new OscillatorNode(ctx, { type: 'sine', frequency: trem });
      const tg = new GainNode(ctx, { gain: tremD });
      tLfo.connect(tg);
      tg.connect(master.gain);
      tLfo.start(time); tLfo.stop(time + dur + 0.02);
    }

    master.connect(ctx.destination);
    osc1.start(time); osc1.stop(time + dur + 0.02);
    osc2.start(time); osc2.stop(time + dur + 0.02);
    return master;
  }

  // Breathy noise burst for aspiration / breath sounds
  function _breath(time, dur, vol) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    // Bandpass to shape noise into breathy "shhh"
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2500, Q: 0.7 });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.setValueAtTime(vol, time + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, time + dur);

    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(time); src.stop(time + dur + 0.01);
  }

  // ── CUTE NON-VERBAL VOICE SOUNDS ──────────────────────────────────────────

  // Giggle "hehe!" — bubbly two-syllable laugh when user smiles
  function _giggle() {
    if (!_ok('giggle')) return;
    try {
      const t = ctx.currentTime;
      // Two-syllable giggle: "he-he" with ascending pitch
      _formant(680, 1800, t,       0.10, 0.10, { wave: 'triangle', attack: 0.005, release: 0.04, tremRate: 28, tremDepth: 0.03 });
      _formant(780, 2000, t + 0.12, 0.12, 0.11, { wave: 'triangle', attack: 0.005, release: 0.05, tremRate: 30, tremDepth: 0.03 });
      _breath(t, 0.06, 0.02);
    } catch(e) {}
  }

  // Content "coo~" — warm descending hum when becoming happy
  function _contentCoo() {
    if (!_ok('coo')) return;
    try {
      const t = ctx.currentTime;
      _formant(520, 1200, t, 0.28, 0.09, {
        wave: 'triangle', vibRate: 5.5, vibDepth: 12,
        slideTo: [480, 1100], attack: 0.02, release: 0.12
      });
      _breath(t + 0.01, 0.08, 0.015);
    } catch(e) {}
  }

  // Curious "ooh?" — rising intonation, wide-eyed wonder
  function _curiousOoh() {
    if (!_ok('curious')) return;
    try {
      const t = ctx.currentTime;
      _formant(380, 950, t, 0.30, 0.09, {
        wave: 'sine', vibRate: 6, vibDepth: 10,
        slideTo: [520, 1300], attack: 0.02, release: 0.10
      });
    } catch(e) {}
  }

  // Sleepy yawn "ahhhhh~" — long descending exhale with breath
  function _sleepyYawn() {
    if (!_ok('yawn')) return;
    try {
      const t = ctx.currentTime;
      // Slow descending "aah" — open vowel formants
      _formant(600, 1400, t, 0.70, 0.08, {
        wave: 'sine', vibRate: 3, vibDepth: 15,
        slideTo: [300, 800], attack: 0.06, release: 0.30
      });
      // Breathy exhale layered on top
      _breath(t + 0.05, 0.55, 0.025);
    } catch(e) {}
  }

  // Suspicious "hmm?" — low nasal questioning sound
  function _suspiciousHmm() {
    if (!_ok('suspicious')) return;
    try {
      const t = ctx.currentTime;
      // Nasally "hmm" — close-mouth formants with upward ending
      _formant(250, 700, t, 0.35, 0.08, {
        wave: 'triangle', vibRate: 4, vibDepth: 8,
        slideTo: [280, 780], attack: 0.03, release: 0.10
      });
    } catch(e) {}
  }

  // Pouty "mweh~" — descending whine, lip-trembly
  function _poutyMweh() {
    if (!_ok('pouty')) return;
    try {
      const t = ctx.currentTime;
      _formant(550, 1400, t, 0.35, 0.09, {
        wave: 'triangle', vibRate: 7, vibDepth: 20,
        slideTo: [350, 900], attack: 0.01, release: 0.15,
        tremRate: 8, tremDepth: 0.02
      });
    } catch(e) {}
  }

  // Grumpy "hmph!" — short nasal puff with low pitch
  function _grumpyHmph() {
    if (!_ok('grumpy')) return;
    try {
      const t = ctx.currentTime;
      // Two short "hmph" bursts
      _formant(200, 550, t, 0.12, 0.10, {
        wave: 'triangle', attack: 0.005, release: 0.05,
        slideTo: [170, 480]
      });
      _breath(t, 0.08, 0.03);
      _formant(180, 500, t + 0.18, 0.10, 0.09, {
        wave: 'triangle', attack: 0.005, release: 0.04,
        slideTo: [160, 440]
      });
      _breath(t + 0.18, 0.06, 0.025);
    } catch(e) {}
  }

  // Scared "eep!" — sharp high squeak with gasp
  function _scaredEep() {
    if (!_ok('scared')) return;
    try {
      const t = ctx.currentTime;
      _formant(800, 2200, t, 0.12, 0.10, {
        wave: 'sine', attack: 0.003, release: 0.05,
        slideTo: [1200, 2800]
      });
      _breath(t, 0.05, 0.03);
    } catch(e) {}
  }

  // Sad "aww..." — slow descending whimper with emotional vibrato
  function _sadAww() {
    if (!_ok('sad')) return;
    try {
      const t = ctx.currentTime;
      _formant(500, 1200, t, 0.50, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 18,
        slideTo: [340, 850], attack: 0.03, release: 0.20,
        tremRate: 4, tremDepth: 0.015
      });
      // Quieter second tone for richness
      _formant(420, 1000, t + 0.05, 0.40, 0.05, {
        wave: 'sine', vibRate: 5.5, vibDepth: 14,
        slideTo: [300, 750], attack: 0.03, release: 0.18
      });
    } catch(e) {}
  }

  // Crying "huh-huh..." — rhythmic sobbing with breath
  function _cryingSob() {
    if (!_ok('crying')) return;
    try {
      const t = ctx.currentTime;
      // Three sob pulses with descending pitch
      [0, 0.22, 0.44].forEach((off, i) => {
        const pitch = 480 - i * 40;
        _formant(pitch, pitch * 2.2, t + off, 0.16, 0.07 - i * 0.01, {
          wave: 'sine', vibRate: 6, vibDepth: 16,
          slideTo: [pitch - 50, (pitch - 50) * 2.2],
          attack: 0.008, release: 0.08
        });
        _breath(t + off, 0.06, 0.02);
      });
    } catch(e) {}
  }

  // Overjoyed "eee~!" — excited ascending squeal with tremolo
  function _overjoyedSqueal() {
    if (!_ok('overjoyed')) return;
    try {
      const t = ctx.currentTime;
      // Rapid ascending three-note squeal
      [[600, 1600, 0], [750, 1900, 0.09], [900, 2300, 0.18]].forEach(([f1, f2, off]) => {
        _formant(f1, f2, t + off, 0.10, 0.11, {
          wave: 'triangle', attack: 0.005, release: 0.04,
          tremRate: 22, tremDepth: 0.02
        });
      });
      _breath(t + 0.02, 0.05, 0.015);
    } catch(e) {}
  }

  // Sulking sigh "haahh..." — heavy breath-out with sad undertone
  function _sulkingSigh() {
    if (!_ok('sulking')) return;
    try {
      const t = ctx.currentTime;
      _formant(350, 900, t, 0.45, 0.07, {
        wave: 'sine', vibRate: 3.5, vibDepth: 10,
        slideTo: [250, 650], attack: 0.04, release: 0.20
      });
      _breath(t, 0.35, 0.03);
    } catch(e) {}
  }

  // Focused "mmm~" — quiet content humming
  function _focusedHum() {
    if (!_ok('focused')) return;
    try {
      const t = ctx.currentTime;
      _formant(280, 650, t, 0.30, 0.05, {
        wave: 'sine', vibRate: 4, vibDepth: 6,
        slideTo: [300, 700], attack: 0.04, release: 0.12
      });
    } catch(e) {}
  }

  // Surprise gasp "oh!" — quick rising vocalization
  function _surpriseGasp() {
    if (!_ok('surprise')) return;
    try {
      const t = ctx.currentTime;
      _formant(550, 1400, t, 0.14, 0.09, {
        wave: 'triangle', attack: 0.004, release: 0.06,
        slideTo: [750, 1900]
      });
      _breath(t, 0.05, 0.025);
    } catch(e) {}
  }

  // User left — sad calling-out "aww?..." with rising end
  function _userLeft() {
    if (!_ok('userLeft')) return;
    try {
      const t = ctx.currentTime;
      // Sad falling "aww" then questioning rise
      _formant(480, 1150, t, 0.30, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 14,
        slideTo: [380, 920], attack: 0.02, release: 0.12
      });
      // Rising "?" at end
      _formant(380, 920, t + 0.32, 0.18, 0.07, {
        wave: 'sine', vibRate: 4, vibDepth: 10,
        slideTo: [460, 1100], attack: 0.015, release: 0.08
      });
    } catch(e) {}
  }

  // User returned — excited happy greeting "ah~!"
  function _welcomeBack() {
    if (!_ok('welcomeBack')) return;
    try {
      const t = ctx.currentTime;
      // Excited ascending "ah~!"
      _formant(500, 1300, t, 0.12, 0.10, {
        wave: 'triangle', attack: 0.005, release: 0.05,
        slideTo: [650, 1700]
      });
      _formant(650, 1700, t + 0.13, 0.15, 0.11, {
        wave: 'triangle', attack: 0.005, release: 0.06,
        vibRate: 8, vibDepth: 15,
        slideTo: [720, 1850]
      });
      _breath(t, 0.06, 0.02);
    } catch(e) {}
  }

  return { init };
})();
