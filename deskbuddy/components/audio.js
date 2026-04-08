/**
 * Audio — Cute non-verbal creature voice using Web Audio API formant synthesis.
 *
 * Sound triggers:
 *  1. Emotion transitions — window._emotionChanged set by brain.js
 *  2. User expression reactions — perception.userSmiling / userSurprised
 *  3. Face presence changes — user leaving / returning
 *
 * Voice design: Multi-formant synthesis (F1 body + F2 character + optional F3
 * shimmer) with vibrato, tremolo, and shaped noise bursts. Each emotion has a
 * unique tonal signature with pitch contours that convey genuine feeling —
 * warm ascending coos for happiness, slow descending sighs for sadness,
 * breathy yawns for sleepiness, staccato chirps for attention.
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
      case 'suspicious': _suspiciousNudge();   break;
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
      case 'excited':    _excitedChirp();      break;
      case 'shy':        _shySqueak();         break;
      case 'love':       _lovePurr();          break;
      case 'startled':   _startledGasp();      break;
      case 'idle':
        if (from === 'scared' || from === 'sad' || from === 'crying') {
          _reliefSigh();
        }
        break;
      case 'forgiven':
        _reliefSigh();
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
  // Formant pair: two oscillators (F1=body, F2=brightness) through a master
  // gain create a vowel-like timbre.  Adding vibrato (freq LFO) and tremolo
  // (gain LFO) makes it feel like a living voice.  Optional F3 shimmer adds
  // sparkle for bright emotions.

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

    // Optional F3 shimmer — quiet high partial for sparkle
    if (o.f3) {
      const osc3 = new OscillatorNode(ctx, { type: 'sine', frequency: o.f3 });
      osc3.frequency.setValueAtTime(o.f3, time);
      if (slide && o.f3slide) osc3.frequency.linearRampToValueAtTime(o.f3slide, time + dur * 0.9);
      const g3 = new GainNode(ctx, { gain: 0 });
      osc3.connect(g3);
      g3.gain.setValueAtTime(0, time);
      g3.gain.linearRampToValueAtTime(vol * 0.12, time + attack);
      g3.gain.setValueAtTime(vol * 0.12, sustainEnd);
      g3.gain.linearRampToValueAtTime(0, time + dur);
      g3.connect(master);
      osc3.start(time); osc3.stop(time + dur + 0.02);
    }

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
  function _breath(time, dur, vol, freq) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    // Bandpass to shape noise — lower freq = darker/sadder, higher = brighter
    const bpFreq = freq || 2500;
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: bpFreq, Q: 0.7 });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.setValueAtTime(vol, time + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, time + dur);

    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(time); src.stop(time + dur + 0.01);
  }

  // ── CUTE NON-VERBAL VOICE SOUNDS ──────────────────────────────────────────

  // Giggle — warm bubbly three-syllable "hehehe~" when user smiles
  function _giggle() {
    if (!_ok('giggle')) return;
    try {
      const t = ctx.currentTime;
      // Three ascending syllables with sparkly F3 shimmer
      _formant(620, 1700, t, 0.09, 0.09, {
        wave: 'triangle', attack: 0.004, release: 0.03,
        tremRate: 26, tremDepth: 0.025, f3: 3200
      });
      _formant(720, 1900, t + 0.11, 0.10, 0.10, {
        wave: 'triangle', attack: 0.004, release: 0.04,
        tremRate: 28, tremDepth: 0.025, f3: 3400
      });
      _formant(800, 2100, t + 0.22, 0.13, 0.11, {
        wave: 'triangle', attack: 0.005, release: 0.05,
        tremRate: 30, tremDepth: 0.03, vibRate: 10, vibDepth: 8, f3: 3600
      });
      // Tiny breath between syllables
      _breath(t + 0.05, 0.04, 0.015, 3500);
      _breath(t + 0.16, 0.04, 0.012, 3800);
    } catch(e) {}
  }

  // Content coo — genuinely warm ascending "mmm~aah" for happiness
  function _contentCoo() {
    if (!_ok('coo')) return;
    try {
      const t = ctx.currentTime;
      // Warm body "mmm" rising to open "aah" — feels like genuine contentment
      _formant(380, 900, t, 0.18, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 10,
        slideTo: [480, 1150], attack: 0.03, release: 0.06
      });
      // Opens into bright warm "aah~"
      _formant(500, 1250, t + 0.18, 0.25, 0.10, {
        wave: 'triangle', vibRate: 5.5, vibDepth: 14,
        slideTo: [550, 1350], attack: 0.02, release: 0.10,
        f3: 2800, f3slide: 3000
      });
      _breath(t + 0.02, 0.06, 0.012, 3000);
    } catch(e) {}
  }

  // Curious "ooh?" — rising two-syllable wonder with wide eyes feel
  function _curiousOoh() {
    if (!_ok('curious')) return;
    try {
      const t = ctx.currentTime;
      // Short "oh" opener
      _formant(350, 880, t, 0.12, 0.07, {
        wave: 'sine', attack: 0.01, release: 0.04,
        slideTo: [400, 1000]
      });
      // Rising "ooh?" with question inflection
      _formant(420, 1050, t + 0.14, 0.28, 0.09, {
        wave: 'sine', vibRate: 5, vibDepth: 12,
        slideTo: [580, 1450], attack: 0.02, release: 0.10,
        f3: 2400, f3slide: 2900
      });
    } catch(e) {}
  }

  // Sleepy yawn — long realistic "aaaahhh~mmm" with inhale and exhale phases
  function _sleepyYawn() {
    if (!_ok('yawn')) return;
    try {
      const t = ctx.currentTime;
      // Phase 1: inhale breath (0.0s–0.15s)
      _breath(t, 0.15, 0.02, 1800);
      // Phase 2: wide open "aaahhhh" — peak of yawn (0.12s–0.75s)
      _formant(550, 1350, t + 0.12, 0.65, 0.08, {
        wave: 'sine', vibRate: 2.5, vibDepth: 18,
        slideTo: [280, 700], attack: 0.08, release: 0.30
      });
      // Breathy overlay across the whole yawn
      _breath(t + 0.15, 0.55, 0.025, 1600);
      // Phase 3: closing "mmm~" — mouth closing (0.65s–0.95s)
      _formant(280, 650, t + 0.70, 0.28, 0.05, {
        wave: 'sine', vibRate: 2, vibDepth: 8,
        slideTo: [220, 520], attack: 0.03, release: 0.15
      });
      // Trailing exhale sigh
      _breath(t + 0.80, 0.18, 0.018, 1200);
    } catch(e) {}
  }

  // Suspicious / attention nudge — playful staccato "mm-mm!" to get user to look back
  // Distinct from sad sounds: bright, chirpy, insistent like "hey! over here!"
  function _suspiciousNudge() {
    if (!_ok('suspicious')) return;
    try {
      const t = ctx.currentTime;
      // Two quick ascending chirps — "mm-MM!" (playful, not sad)
      _formant(400, 1050, t, 0.10, 0.09, {
        wave: 'triangle', attack: 0.005, release: 0.04,
        slideTo: [450, 1150]
      });
      _formant(520, 1350, t + 0.13, 0.12, 0.10, {
        wave: 'triangle', attack: 0.005, release: 0.05,
        slideTo: [580, 1500], f3: 2600
      });
      // Tiny puff for emphasis
      _breath(t + 0.12, 0.04, 0.02, 3200);
    } catch(e) {}
  }

  // Pouty "mweeeh~" — exaggerated descending whine with trembling lip feel
  function _poutyMweh() {
    if (!_ok('pouty')) return;
    try {
      const t = ctx.currentTime;
      // Initial "mw-" onset
      _formant(580, 1450, t, 0.08, 0.08, {
        wave: 'triangle', attack: 0.005, release: 0.03
      });
      // Long wavering descending "eeeeh~"
      _formant(560, 1400, t + 0.08, 0.38, 0.10, {
        wave: 'triangle', vibRate: 7.5, vibDepth: 22,
        slideTo: [320, 820], attack: 0.01, release: 0.16,
        tremRate: 9, tremDepth: 0.025
      });
      // Sub-harmonic for pouty fullness
      _formant(280, 700, t + 0.10, 0.30, 0.04, {
        wave: 'sine', vibRate: 7.5, vibDepth: 12,
        slideTo: [160, 410], attack: 0.02, release: 0.12
      });
    } catch(e) {}
  }

  // Grumpy "hmph!" — deep percussive nasal puffs with low rumble
  function _grumpyHmph() {
    if (!_ok('grumpy')) return;
    try {
      const t = ctx.currentTime;
      // Deep "hmph" — closed mouth, nasal
      _formant(180, 480, t, 0.10, 0.10, {
        wave: 'triangle', attack: 0.004, release: 0.04,
        slideTo: [150, 400]
      });
      _breath(t, 0.07, 0.03, 1500);
      // Second shorter puff — "hf!"
      _formant(160, 440, t + 0.16, 0.08, 0.09, {
        wave: 'triangle', attack: 0.003, release: 0.03,
        slideTo: [140, 380]
      });
      _breath(t + 0.16, 0.05, 0.028, 1200);
    } catch(e) {}
  }

  // Scared "eep!" — sharp trembling squeak with startled gasp
  function _scaredEep() {
    if (!_ok('scared')) return;
    try {
      const t = ctx.currentTime;
      // Startled intake gasp
      _breath(t, 0.04, 0.03, 3800);
      // High sharp "EEP!" with trembling
      _formant(850, 2300, t + 0.03, 0.11, 0.10, {
        wave: 'sine', attack: 0.003, release: 0.04,
        slideTo: [1100, 2700], tremRate: 18, tremDepth: 0.02,
        f3: 3500
      });
      // Trailing shaky whimper
      _formant(600, 1500, t + 0.16, 0.14, 0.05, {
        wave: 'sine', vibRate: 9, vibDepth: 20,
        slideTo: [480, 1200], attack: 0.01, release: 0.08,
        tremRate: 12, tremDepth: 0.015
      });
    } catch(e) {}
  }

  // Sad "awww..." — long slow descending whimper with genuine melancholy
  function _sadAww() {
    if (!_ok('sad')) return;
    try {
      const t = ctx.currentTime;
      // Soft onset breath
      _breath(t, 0.06, 0.015, 1800);
      // Main sad vocalization — slow descending "awww..." with emotional vibrato
      _formant(480, 1150, t + 0.03, 0.55, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 20,
        slideTo: [310, 760], attack: 0.04, release: 0.22,
        tremRate: 3.5, tremDepth: 0.018
      });
      // Harmony layer — minor-feeling undertone
      _formant(400, 960, t + 0.08, 0.45, 0.05, {
        wave: 'sine', vibRate: 5.5, vibDepth: 16,
        slideTo: [260, 640], attack: 0.04, release: 0.20
      });
      // Trailing whimper
      _formant(310, 760, t + 0.52, 0.22, 0.04, {
        wave: 'sine', vibRate: 6, vibDepth: 14,
        slideTo: [250, 620], attack: 0.02, release: 0.12,
        tremRate: 5, tremDepth: 0.012
      });
    } catch(e) {}
  }

  // Crying — rhythmic sobs "huh...huh...huh..." with breath between each
  function _cryingSob() {
    if (!_ok('crying')) return;
    try {
      const t = ctx.currentTime;
      // Four sob pulses, progressively lower and softer
      [0, 0.24, 0.48, 0.70].forEach((off, i) => {
        const pitch = 500 - i * 35;
        const loudness = 0.08 - i * 0.012;
        // Vocalized sob
        _formant(pitch, pitch * 2.2, t + off, 0.15, loudness, {
          wave: 'sine', vibRate: 6.5, vibDepth: 18,
          slideTo: [pitch - 60, (pitch - 60) * 2.2],
          attack: 0.006, release: 0.07,
          tremRate: 5, tremDepth: 0.012
        });
        // Breath hiccup between sobs
        _breath(t + off + 0.12, 0.08, 0.018, 1600);
      });
    } catch(e) {}
  }

  // Overjoyed "eee~hee~!" — excited ascending four-note burst with sparkle
  function _overjoyedSqueal() {
    if (!_ok('overjoyed')) return;
    try {
      const t = ctx.currentTime;
      // Rapid ascending sparkly notes
      var notes = [
        [560, 1500, 0,    0.08, 0.09],
        [680, 1800, 0.08, 0.08, 0.10],
        [800, 2100, 0.16, 0.09, 0.11],
        [900, 2400, 0.25, 0.12, 0.11]
      ];
      notes.forEach(function(n) {
        _formant(n[0], n[1], t + n[2], n[3], n[4], {
          wave: 'triangle', attack: 0.004, release: 0.03,
          tremRate: 24, tremDepth: 0.02,
          f3: n[1] + 1200
        });
      });
      _breath(t + 0.04, 0.04, 0.012, 3800);
      _breath(t + 0.20, 0.04, 0.010, 4000);
    } catch(e) {}
  }

  // Sulking sigh — long heavy "haahh..." deflating breath with sad undertone
  function _sulkingSigh() {
    if (!_ok('sulking')) return;
    try {
      const t = ctx.currentTime;
      // Heavy exhale breath — the main component
      _breath(t, 0.40, 0.03, 1400);
      // Quiet sad vocalization underneath the breath
      _formant(320, 800, t + 0.03, 0.45, 0.06, {
        wave: 'sine', vibRate: 3, vibDepth: 10,
        slideTo: [220, 560], attack: 0.05, release: 0.20
      });
      // Trailing faint moan
      _formant(240, 600, t + 0.40, 0.18, 0.03, {
        wave: 'sine', vibRate: 3.5, vibDepth: 8,
        slideTo: [200, 500], attack: 0.02, release: 0.10
      });
    } catch(e) {}
  }

  // Focused hum — gentle contented "mmm~" barely audible background purr
  function _focusedHum() {
    if (!_ok('focused')) return;
    try {
      const t = ctx.currentTime;
      _formant(260, 620, t, 0.35, 0.04, {
        wave: 'sine', vibRate: 4, vibDepth: 6,
        slideTo: [290, 680], attack: 0.05, release: 0.14
      });
      // Very faint harmonics for warmth
      _formant(520, 1240, t + 0.05, 0.25, 0.015, {
        wave: 'sine', vibRate: 4, vibDepth: 4,
        slideTo: [580, 1360], attack: 0.04, release: 0.10
      });
    } catch(e) {}
  }

  // Surprise gasp — quick "oh!" with startled breath and rising tone
  function _surpriseGasp() {
    if (!_ok('surprise')) return;
    try {
      const t = ctx.currentTime;
      // Sharp intake breath
      _breath(t, 0.04, 0.025, 3200);
      // Rising "OH!" vocalization
      _formant(500, 1300, t + 0.03, 0.12, 0.09, {
        wave: 'triangle', attack: 0.004, release: 0.05,
        slideTo: [720, 1850], f3: 2800
      });
      // Brief echo tail
      _formant(680, 1750, t + 0.16, 0.08, 0.04, {
        wave: 'sine', attack: 0.005, release: 0.04,
        slideTo: [600, 1500]
      });
    } catch(e) {}
  }

  // User left — distinctly sad lonely whimper "aww...mmm..." trailing off
  function _userLeft() {
    if (!_ok('userLeft')) return;
    try {
      const t = ctx.currentTime;
      // Sad falling "awww..." — long, heavy, melancholic
      _formant(460, 1100, t, 0.40, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 18,
        slideTo: [320, 780], attack: 0.03, release: 0.16,
        tremRate: 3, tremDepth: 0.012
      });
      // Underlying minor harmony for genuine sadness
      _formant(380, 920, t + 0.05, 0.35, 0.04, {
        wave: 'sine', vibRate: 5.5, vibDepth: 14,
        slideTo: [260, 640], attack: 0.03, release: 0.15
      });
      // Quiet trailing whimper "mm..." — fading away
      _formant(320, 780, t + 0.42, 0.28, 0.05, {
        wave: 'sine', vibRate: 6, vibDepth: 12,
        slideTo: [240, 590], attack: 0.02, release: 0.15,
        tremRate: 4, tremDepth: 0.010
      });
      // Sad breath at end
      _breath(t + 0.60, 0.15, 0.018, 1200);
    } catch(e) {}
  }

  // User returned — excited joyful multi-note greeting "ah~hah~!"
  function _welcomeBack() {
    if (!_ok('welcomeBack')) return;
    try {
      const t = ctx.currentTime;
      // Happy breath burst
      _breath(t, 0.04, 0.015, 3500);
      // Ascending excited three-note greeting
      _formant(460, 1200, t + 0.02, 0.10, 0.09, {
        wave: 'triangle', attack: 0.005, release: 0.04,
        slideTo: [540, 1400], f3: 2600
      });
      _formant(600, 1550, t + 0.13, 0.11, 0.10, {
        wave: 'triangle', attack: 0.005, release: 0.05,
        vibRate: 7, vibDepth: 12, f3: 2900
      });
      _formant(720, 1850, t + 0.25, 0.16, 0.11, {
        wave: 'triangle', attack: 0.005, release: 0.07,
        vibRate: 8, vibDepth: 15, f3: 3200,
        slideTo: [760, 1950]
      });
      _breath(t + 0.14, 0.03, 0.012, 3800);
    } catch(e) {}
  }

  // Relief sigh — gentle "ahh~" when recovering from scared/sad/crying to idle
  function _reliefSigh() {
    if (!_ok('relief')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.08, 0.015, 2000);
      _formant(420, 1050, t + 0.04, 0.30, 0.07, {
        wave: 'sine', vibRate: 4.5, vibDepth: 10,
        slideTo: [380, 940], attack: 0.03, release: 0.12
      });
    } catch(e) {}
  }

  // Excited chirp — rapid staccato rising "hee-hee-hee!" full of energy
  function _excitedChirp() {
    if (!_ok('excited')) return;
    try {
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        _formant(700 + i * 80, 1900 + i * 100, t + i * 0.10, 0.08, 0.09, {
          wave: 'triangle', attack: 0.004, release: 0.025,
          tremRate: 32, tremDepth: 0.03, f3: 3500 + i * 200
        });
      }
      _breath(t + 0.02, 0.05, 0.012, 4000);
    } catch(e) {}
  }

  // Shy squeak — tiny barely-audible rising "mm?" — endearingly quiet
  function _shySqueak() {
    if (!_ok('shy')) return;
    try {
      const t = ctx.currentTime;
      _formant(480, 1200, t, 0.16, 0.05, {
        wave: 'sine', vibRate: 6, vibDepth: 8,
        slideTo: [540, 1380], attack: 0.025, release: 0.08
      });
      _breath(t + 0.05, 0.04, 0.006, 3200);
    } catch(e) {}
  }

  // Love purr — warm rounded "mmh~" — content and affectionate
  function _lovePurr() {
    if (!_ok('love')) return;
    try {
      const t = ctx.currentTime;
      _formant(340, 840, t, 0.22, 0.08, {
        wave: 'sine', vibRate: 5, vibDepth: 12,
        slideTo: [400, 980], attack: 0.04, release: 0.10
      });
      _formant(460, 1120, t + 0.22, 0.22, 0.09, {
        wave: 'triangle', vibRate: 5.5, vibDepth: 14,
        slideTo: [500, 1200], attack: 0.02, release: 0.10,
        f3: 2600, f3slide: 2800
      });
      _breath(t + 0.01, 0.07, 0.010, 2800);
    } catch(e) {}
  }

  // Startled gasp — sharp inhale "ah!" — wide-eyed surprise
  function _startledGasp() {
    if (!_ok('startled')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.06, 0.025, 3800);
      _formant(580, 1600, t + 0.03, 0.12, 0.08, {
        wave: 'triangle', attack: 0.003, release: 0.05,
        slideTo: [650, 1800]
      });
    } catch(e) {}
  }

  return { init };
})();
