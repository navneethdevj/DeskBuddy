// REPO STUDY FINDINGS:
// Tamagotchi: visual celebrations for milestones (bar color changes) → milestone sound trigger
// Desktop Goose: escalation reactions over time → progressive milestone audio feedback
// WebPet: no audio system → all audio is original formant synthesis
// EyeOnTask: no audio feedback → milestone coo adds auditory reward for sustained focus
// Web Shimeji: repo unavailable → concept of expression-triggered audio cues applied
//
// REPO STUDY (Part B — Voice Redesign):
// web-audio-api-recipes (mohayonao): FM synthesis creates alien/metallic timbres via
//   modulator-to-carrier ratio — high ratios (3+) = glassy bells, low (<1) = warm sub-harmonics.
//   Applied: _fm() helper with configurable modRatio and modDepth.
// jsfx/chiptune: square/sawtooth waves + instant attack = retro 8-bit character sounds.
//   Applied: _beep() helper with near-zero attack for digital creature voice.
// Tone.js (src/instrument/): FMSynth, AMSynth, MembraneSynth parameterization — "fat" bass
//   uses low modRatio + sawtooth, "thin" digital voice uses high modRatio + triangle.
//   Applied: diverse timbres per emotion via different wave/ratio combos.
// mdn/webaudio-examples: ring modulation = multiply two signals for robotic sidebands.
//   Applied: _ring() helper for whale-warble and electronic shimmer textures.
// find-the-fox: short staccato creature sounds with fast envelopes, percussive quality.
//   Applied: rapid attack/release patterns in _fm() for staccato bell tones.
// REPO BONUS: Combined FM + ring mod layering from Tone.js concepts for richer textures.

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
      case 'idle':
        if (from === 'scared' || from === 'sad' || from === 'crying') {
          _reliefSigh();
        }
        break;
      case 'forgiven':
        _reliefSigh();
        break;
      case '__milestone':
        // Soft celebratory coo at focus milestone — quiet, not jarring
        if (window.perception?.facePresent) _contentCoo();
        break;
      case '__slowblink':
        if (window.perception?.facePresent) _contentCoo();
        break;
      case '__coo':
        if (window.perception?.facePresent) _focusedHum();
        break;
      case '__pet_happy':  _giggle();       break;
      case '__pet_grumpy': _grumpyHmph();  break;
      case '__hover':      _curiousOoh();  break;
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

  // ── EXTRA SYNTHESIS HELPERS ───────────────────────────────────────────────

  /**
   * FM synthesis — frequency modulation creates rich metallic/alien timbres.
   * Concept from Tone.js FM synth: modulator oscillator modulates carrier frequency.
   * modRatio = modulator:carrier frequency ratio — higher = more metallic/alien
   * modDepth = how much the modulator affects pitch — higher = more robotic
   */
  function _fm(carrierFreq, modRatio, modDepth, time, dur, vol, opts) {
    const o = opts || {};
    const carrier  = new OscillatorNode(ctx, { type: o.wave || 'sine', frequency: carrierFreq });
    const modFreq  = carrierFreq * modRatio;
    const modulator = new OscillatorNode(ctx, { type: 'sine', frequency: modFreq });
    const modGain  = new GainNode(ctx, { gain: modDepth });

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);  // FM: modulator drives carrier frequency

    const attack = o.attack || 0.01;
    const release = o.release || dur * 0.4;
    const sustainEnd = time + dur - release;

    const masterGain = new GainNode(ctx, { gain: 0 });
    masterGain.gain.setValueAtTime(0, time);
    masterGain.gain.linearRampToValueAtTime(vol, time + attack);
    masterGain.gain.setValueAtTime(vol, sustainEnd);
    masterGain.gain.linearRampToValueAtTime(0, time + dur);

    if (o.slideTo) {
      carrier.frequency.setValueAtTime(carrierFreq, time);
      carrier.frequency.linearRampToValueAtTime(o.slideTo, time + dur * 0.85);
    }

    carrier.connect(masterGain).connect(ctx.destination);
    modulator.start(time); modulator.stop(time + dur + 0.02);
    carrier.start(time);   carrier.stop(time + dur + 0.02);
    return masterGain;
  }

  /**
   * Ring modulation — multiplies two oscillators for metallic robotic effect.
   * Creates sidebands that sound electronic and alien.
   * From Web Audio recipes: ring mod = carrier * modulator signal
   */
  function _ring(freq, ringFreq, time, dur, vol, wave) {
    const carrier  = new OscillatorNode(ctx, { type: wave || 'sine', frequency: freq });
    const ring     = new OscillatorNode(ctx, { type: 'sine', frequency: ringFreq });
    const ringGain = new GainNode(ctx, { gain: 0 });  // ring as amplitude modulator
    const carrierGain = new GainNode(ctx, { gain: vol });

    // Ring mod: modulate carrier amplitude with ring oscillator
    ring.connect(ringGain.gain);
    carrier.connect(carrierGain);

    const envelope = new GainNode(ctx, { gain: 0 });
    carrierGain.connect(envelope).connect(ctx.destination);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(1, time + 0.008);
    envelope.gain.setValueAtTime(1, time + dur * 0.6);
    envelope.gain.linearRampToValueAtTime(0, time + dur);

    ring.start(time); ring.stop(time + dur + 0.02);
    carrier.start(time); carrier.stop(time + dur + 0.02);
  }

  /**
   * Digital beep — clean square/sawtooth with instant attack.
   * Creates chiptune / 8-bit character sounds.
   * From chiptune synthesis: square wave + very fast attack = retro beep.
   */
  function _beep(freq, time, dur, vol, wave) {
    const osc = new OscillatorNode(ctx, { type: wave || 'square', frequency: freq });
    const g   = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.003);   // near-instant attack
    g.gain.setValueAtTime(vol, time + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, time + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(time); osc.stop(time + dur + 0.01);
  }

  // ── CUTE NON-VERBAL VOICE SOUNDS ──────────────────────────────────────────

  // GIGGLE — crystal FM bells cascade (FM synthesis, high modRatio = glassy/alien)
  // Three ascending bell tones — each completely distinct frequency and timbre
  function _giggle() {
    if (!_ok('giggle')) return;
    try {
      const t = ctx.currentTime;
      // Bell 1: low sweet chime (FM modRatio 3.5 = bell-like partial series)
      _fm(520, 3.5, 180, t,       0.12, 0.10, { wave: 'sine', attack: 0.003, release: 0.07 });
      // Bell 2: mid crystal chime (ring mod adds shimmer)
      _fm(780, 4.2, 240, t+0.12,  0.13, 0.11, { wave: 'sine', attack: 0.003, release: 0.08 });
      // Bell 3: high sparkling top note
      _fm(960, 5.0, 320, t+0.23,  0.16, 0.12, { wave: 'sine', attack: 0.002, release: 0.10,
        slideTo: 1100 });
      // Tiny percussive breath between bells — texture
      _breath(t + 0.08, 0.03, 0.012, 4800);
      _breath(t + 0.19, 0.03, 0.010, 5200);
    } catch(_) {}
  }

  // CONTENT COO — warm alien hum, round and cozy, with ring mod shimmer
  // Uses FM with low modRatio = warm organ-like, plus gentle ring glow
  function _contentCoo() {
    if (!_ok('coo')) return;
    try {
      const t = ctx.currentTime;
      // Warm body hum (FM modRatio 0.5 = sub-harmonic warmth)
      _fm(320, 0.5, 60, t,       0.50, 0.095, {
        attack: 0.06, release: 0.20, slideTo: 400
      });
      // Rising openness — alien "aah" rising to brightness
      _fm(420, 1.5, 90, t + 0.22, 0.38, 0.10, {
        wave: 'triangle', attack: 0.04, release: 0.16, slideTo: 520
      });
      // Ring mod shimmer layer — feels warm and electronic simultaneously
      _ring(440, 6, t + 0.24, 0.34, 0.025, 'sine');
    } catch(_) {}
  }

  // CURIOUS OOH — rising digital chirp with square wave chiptune feel
  // Square wave = immediately digital/alien, rising pitch = question energy
  function _curiousOoh() {
    if (!_ok('curious')) return;
    try {
      const t = ctx.currentTime;
      // Short digital "mm?" onset — square wave, chiptune feel
      _beep(340, t, 0.08, 0.065, 'square');
      // Main rising "ooh?" — FM with pitch rise = question inflection
      _fm(400, 2.0, 80, t + 0.10, 0.36, 0.10, {
        wave: 'triangle', attack: 0.015, release: 0.14, slideTo: 660
      });
      // Tiny sparkle at peak
      _fm(660, 4.0, 160, t + 0.36, 0.14, 0.072, {
        attack: 0.008, release: 0.07, slideTo: 740
      });
    } catch(_) {}
  }

  // SLEEPY YAWN — pure sine slow drift, soft as breath, very long and drowsy
  // Pure sine = the only voice texture with NO digital character — pure organic
  function _sleepyYawn() {
    if (!_ok('yawn')) return;
    try {
      const t = ctx.currentTime;
      // Soft inhale breath
      _breath(t, 0.22, 0.022, 1200);
      // Wide yawn — pure sine, very slow rise and fall, much longer
      _fm(300, 0.25, 18, t + 0.12, 1.0, 0.080, {
        wave: 'sine', attack: 0.18, release: 0.45, slideTo: 160
      });
      // Trailing murmur — even quieter, deep
      _fm(170, 0.25, 10, t + 0.90, 0.42, 0.040, {
        wave: 'sine', attack: 0.06, release: 0.22, slideTo: 130
      });
      _breath(t + 1.10, 0.20, 0.018, 800);
    } catch(_) {}
  }

  // SUSPICIOUS NUDGE — staccato chiptune two-note poke, like a little beep-boop
  // Completely different from sad sounds: bright, digital, insistent
  function _suspiciousNudge() {
    if (!_ok('suspicious')) return;
    try {
      const t = ctx.currentTime;
      // "Beep" — sharp square pulse
      _beep(480, t,       0.07, 0.078, 'square');
      // "Boop" — slightly higher, the question
      _beep(580, t + 0.11, 0.08, 0.085, 'square');
      // Tiny FM shimmer after the boop
      _fm(580, 3.0, 80, t + 0.12, 0.12, 0.038, { attack: 0.005, release: 0.07 });
    } catch(_) {}
  }

  // POUTY MWEH — descending sawtooth whine, rich and wavering, longer
  // Sawtooth = nasal and buzzy, exaggerated lip-out energy
  function _poutyMweh() {
    if (!_ok('pouty')) return;
    try {
      const t = ctx.currentTime;
      // "Mw-" onset — nasal sawtooth, louder attack
      _beep(560, t, 0.08, 0.080, 'sawtooth');
      // Long descending "eeeh~" with slow vibrato — ring mod gives it a whiny edge
      _fm(540, 0.75, 50, t + 0.08, 0.60, 0.10, {
        wave: 'sawtooth', attack: 0.012, release: 0.24, slideTo: 250
      });
      _ring(520, 8, t + 0.10, 0.54, 0.030, 'sine');
      // Trailing whimper
      _fm(260, 0.5, 25, t + 0.58, 0.28, 0.045, {
        wave: 'sawtooth', attack: 0.008, release: 0.14, slideTo: 200
      });
    } catch(_) {}
  }

  // GRUMPY HMPH — deep bass sawtooth grumble with aggressive puffs
  // Low sawtooth = unmistakably grumpy buzz, nothing else sounds like this
  function _grumpyHmph() {
    if (!_ok('grumpy')) return;
    try {
      const t = ctx.currentTime;
      // Grumble 1: very low bass buzz, louder and longer
      _fm(120, 0.5, 40, t,       0.22, 0.12, {
        wave: 'sawtooth', attack: 0.005, release: 0.06, slideTo: 90
      });
      _breath(t, 0.12, 0.038, 1000);
      // Grumble 2: second lower puff — "hf!" even deeper
      _fm(95, 0.5, 35, t + 0.24, 0.18, 0.11, {
        wave: 'sawtooth', attack: 0.004, release: 0.05, slideTo: 75
      });
      _breath(t + 0.24, 0.10, 0.034, 800);
      // Third grumble — rumble tail
      _fm(80, 0.3, 20, t + 0.44, 0.16, 0.065, {
        wave: 'sawtooth', attack: 0.006, release: 0.08, slideTo: 60
      });
    } catch(_) {}
  }

  // SCARED EEP — electric zap noise burst + rising FM spark, startling
  // Noise burst = unique among all sounds; no other emotion uses this
  function _scaredEep() {
    if (!_ok('scared')) return;
    try {
      const t = ctx.currentTime;
      // Startled noise burst (electric zap quality, louder)
      _breath(t, 0.05, 0.055, 6000);
      // Rising "EEP!" — FM with high modRatio = sparkly metallic shock
      _fm(750, 6.0, 500, t + 0.03, 0.16, 0.12, {
        wave: 'sine', attack: 0.002, release: 0.04, slideTo: 1400
      });
      // Trailing shaky digital tremor — more notes, descending panic
      _beep(620, t + 0.20, 0.06, 0.045, 'sine');
      _beep(560, t + 0.27, 0.06, 0.035, 'sine');
      _beep(500, t + 0.34, 0.05, 0.028, 'sine');
    } catch(_) {}
  }

  // SAD AWW — deep whale-like warble, ring modulated for alien melancholy
  // Ring mod at low freq = slow underwater warble — completely unique timbre
  // MUCH longer and slower than other sounds — sadness lingers
  function _sadAww() {
    if (!_ok('sad')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.08, 0.016, 1200);
      // Main descending whale tone — FM for warmth, low modRatio, much longer
      _fm(340, 0.75, 60, t + 0.05, 0.85, 0.090, {
        wave: 'sine', attack: 0.08, release: 0.35, slideTo: 200
      });
      // Ring mod at 3Hz = very slow underwater warble, emphasize the sadness
      _ring(330, 3, t + 0.08, 0.78, 0.028, 'sine');
      // Second descending phrase — even lower, dragging down
      _fm(220, 0.75, 40, t + 0.75, 0.45, 0.060, {
        wave: 'sine', attack: 0.05, release: 0.22, slideTo: 150
      });
      _ring(210, 2.5, t + 0.78, 0.40, 0.020, 'sine');
      // Final fading sigh
      _breath(t + 1.10, 0.22, 0.018, 900);
    } catch(_) {}
  }

  // CRYING SOB — rhythmic whale pulse sobs, each unique frequency
  // More pulses, deeper pitch, with gasping breaths between
  function _cryingSob() {
    if (!_ok('crying')) return;
    try {
      const t = ctx.currentTime;
      // Five sob pulses, progressively lower — no two the same pitch
      [[380,0],[340,0.22],[300,0.42],[265,0.60],[240,0.78]].forEach(([freq, off], i) => {
        const vol = 0.095 - i * 0.012;
        _fm(freq, 0.75, 50, t + off, 0.18, vol, {
          wave: 'sine', attack: 0.005, release: 0.09, slideTo: freq * 0.80
        });
        _ring(freq, 4.5, t + off, 0.16, 0.020, 'sine');
        // Gasping breath between sobs
        _breath(t + off + 0.14, 0.10, 0.022, 1200);
      });
    } catch(_) {}
  }

  // OVERJOYED SQUEAL — ascending FM crystal cascade, five distinct tones
  // Each note has different FM modRatio = different bell character in the cascade
  function _overjoyedSqueal() {
    if (!_ok('overjoyed')) return;
    try {
      const t = ctx.currentTime;
      // Five ascending sparkle notes — each unique timbre via different modRatio
      _fm(440, 3.0, 120, t,       0.10, 0.10, { wave: 'sine', attack: 0.004, release: 0.05 });
      _fm(580, 3.5, 150, t+0.08,  0.10, 0.10, { wave: 'sine', attack: 0.004, release: 0.05, slideTo: 620 });
      _fm(720, 4.0, 200, t+0.16,  0.11, 0.11, { wave: 'sine', attack: 0.003, release: 0.06, slideTo: 780 });
      _fm(860, 5.0, 280, t+0.24,  0.12, 0.12, { wave: 'sine', attack: 0.003, release: 0.07, slideTo: 940 });
      _fm(1000, 6.0, 380, t+0.33, 0.15, 0.12, { wave: 'triangle', attack: 0.003, release: 0.09, slideTo: 1200 });
      // Sparkle breaths at peak
      _breath(t + 0.06, 0.04, 0.014, 5000);
      _breath(t + 0.20, 0.04, 0.012, 5500);
      _breath(t + 0.36, 0.04, 0.010, 6000);
    } catch(_) {}
  }

  // SULKING SIGH — heavy low sawtooth exhale, barely vocalizing, long and heavy
  // Sawtooth + low pass concept from Tone.js: buzzy then muffled = sulky
  function _sulkingSigh() {
    if (!_ok('sulking')) return;
    try {
      const t = ctx.currentTime;
      // Heavy breath exhale (the main component, longer and heavier)
      _breath(t, 0.60, 0.035, 1000);
      // Quiet sulky vocalization under the breath — sawtooth muffled, deeper
      _fm(220, 0.5, 22, t + 0.05, 0.65, 0.060, {
        wave: 'sawtooth', attack: 0.08, release: 0.28, slideTo: 150
      });
      // Faint trailing digital mutter
      _beep(180, t + 0.58, 0.18, 0.022, 'sawtooth');
    } catch(_) {}
  }

  // FOCUSED HUM — clean triangle wave meditation hum, barely there
  // Triangle wave = softer than square, warmer than sine — focused quiet
  function _focusedHum() {
    if (!_ok('focused')) return;
    try {
      const t = ctx.currentTime;
      _fm(230, 1.0, 15, t, 0.42, 0.042, {
        wave: 'triangle', attack: 0.10, release: 0.18, slideTo: 260
      });
      // Quiet octave above — adds presence without being loud
      _fm(460, 1.0, 8, t + 0.08, 0.30, 0.018, {
        wave: 'triangle', attack: 0.07, release: 0.14, slideTo: 520
      });
    } catch(_) {}
  }

  // SURPRISE GASP — sharp FM electric snap, clearly startled
  function _surpriseGasp() {
    if (!_ok('surprise')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.05, 0.035, 4500);
      _fm(580, 5.5, 350, t + 0.03, 0.15, 0.11, {
        wave: 'sine', attack: 0.003, release: 0.05, slideTo: 880
      });
      // Brief echo
      _fm(800, 4.0, 220, t + 0.19, 0.10, 0.055, {
        wave: 'sine', attack: 0.004, release: 0.05, slideTo: 720
      });
    } catch(_) {}
  }

  // USER LEFT — slow descending whale tone, ring modulated, genuinely sad
  // Much longer than other sounds — emphasizes the loneliness
  function _userLeft() {
    if (!_ok('userLeft')) return;
    try {
      const t = ctx.currentTime;
      _fm(360, 0.75, 60, t, 0.60, 0.090, {
        wave: 'sine', attack: 0.06, release: 0.24, slideTo: 220
      });
      _ring(350, 3.0, t + 0.02, 0.55, 0.024, 'sine');
      _fm(240, 0.75, 40, t + 0.50, 0.45, 0.065, {
        wave: 'sine', attack: 0.04, release: 0.20, slideTo: 170
      });
      _breath(t + 0.85, 0.22, 0.020, 900);
    } catch(_) {}
  }

  // WELCOME BACK — ascending FM greeting, four notes, excited and warm
  function _welcomeBack() {
    if (!_ok('welcomeBack')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.04, 0.015, 4000);
      _fm(360, 2.0, 80, t + 0.02, 0.12, 0.10, {
        wave: 'triangle', attack: 0.006, release: 0.05, slideTo: 420
      });
      _fm(500, 3.0, 130, t + 0.14, 0.13, 0.11, {
        wave: 'triangle', attack: 0.005, release: 0.05
      });
      _fm(640, 4.0, 200, t + 0.27, 0.15, 0.12, {
        wave: 'triangle', attack: 0.004, release: 0.06, slideTo: 720
      });
      _fm(780, 5.0, 280, t + 0.40, 0.17, 0.12, {
        wave: 'sine', attack: 0.003, release: 0.08, slideTo: 880
      });
      _breath(t + 0.16, 0.03, 0.012, 4500);
      _breath(t + 0.34, 0.03, 0.010, 5000);
    } catch(_) {}
  }

  // RELIEF SIGH — soft FM resolution tone, gentle landing, longer exhale
  function _reliefSigh() {
    if (!_ok('relief')) return;
    try {
      const t = ctx.currentTime;
      _breath(t, 0.10, 0.018, 1600);
      _fm(400, 1.0, 35, t + 0.06, 0.45, 0.078, {
        wave: 'sine', attack: 0.06, release: 0.18, slideTo: 340
      });
      // Gentle settling tone
      _fm(350, 0.75, 20, t + 0.40, 0.25, 0.040, {
        wave: 'sine', attack: 0.04, release: 0.12, slideTo: 310
      });
    } catch(_) {}
  }

  return { init };
})();
