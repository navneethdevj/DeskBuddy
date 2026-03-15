/**
 * Audio System — DeskBuddy Phase 3
 * Web Audio API: generates all sounds procedurally (no audio files).
 * Max gain: 0.15. Queue-based playback (100ms gap between sounds).
 * All operations wrapped in try/catch for silent failures.
 */
const Audio = (() => {
  let audioContext = null;
  let soundQueue = [];
  let isPlayingSound = false;
  let lastSoundEndTime = 0;

  let cryingOscillators = null;
  let cryingGain = null;

  const MAX_GAIN = 0.15;
  const SOUND_QUEUE_GAP = 100; // ms

  /**
   * Ensure AudioContext exists (create on first interaction).
   */
  function ensureAudioContext() {
    if (audioContext) return audioContext;

    try {
      const ContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new ContextClass();
      return audioContext;
    } catch (e) {
      console.warn('AudioContext unavailable:', e);
      return null;
    }
  }

  /**
   * Queue sound for playback (respects 100ms gap).
   */
  function queueSound(soundFunc, volume) {
    soundQueue.push({ func: soundFunc, volume: volume });
    processQueue();
  }

  /**
   * Process queued sounds sequentially.
   */
  function processQueue() {
    if (isPlayingSound || soundQueue.length === 0) return;

    var now = Date.now();
    if (now < lastSoundEndTime + SOUND_QUEUE_GAP) {
      setTimeout(processQueue, SOUND_QUEUE_GAP);
      return;
    }

    isPlayingSound = true;
    var item = soundQueue.shift();

    try {
      var ctx = ensureAudioContext();
      if (!ctx) {
        isPlayingSound = false;
        processQueue();
        return;
      }

      var duration = item.func(ctx, item.volume);
      lastSoundEndTime = Date.now() + (duration * 1000);
      setTimeout(function () {
        isPlayingSound = false;
        processQueue();
      }, duration * 1000 + 50);
    } catch (e) {
      isPlayingSound = false;
      processQueue();
    }
  }

  // ===== SOUND RECIPES (all return duration in seconds) =====

  function happyChirp(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      // Note 1
      var o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 520;
      o1.frequency.linearRampToValueAtTime(720, now + 0.12);
      var g1 = ctx.createGain();
      g1.gain.setValueAtTime(0, now);
      g1.gain.linearRampToValueAtTime(0.11 * v, now + 0.01);
      g1.gain.linearRampToValueAtTime(0, now + 0.12);
      o1.connect(g1);
      g1.connect(ctx.destination);
      o1.start(now);
      o1.stop(now + 0.13);

      // Note 2 (80ms later)
      var o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 630;
      o2.frequency.linearRampToValueAtTime(850, now + 0.19);
      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, now + 0.08);
      g2.gain.linearRampToValueAtTime(0.09 * v, now + 0.09);
      g2.gain.linearRampToValueAtTime(0, now + 0.19);
      o2.connect(g2);
      g2.connect(ctx.destination);
      o2.start(now + 0.08);
      o2.stop(now + 0.22);

      return 0.22;
    } catch (e) {
      return 0.01;
    }
  }

  function curiousTrill(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 480;
      o.frequency.linearRampToValueAtTime(545, now + 0.26);

      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 16;
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = 55;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);

      var g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.10 * v, now + 0.015);
      g.gain.linearRampToValueAtTime(0.08 * v, now + 0.20);
      g.gain.linearRampToValueAtTime(0, now + 0.28);
      o.connect(g);
      g.connect(ctx.destination);

      lfo.start(now);
      o.start(now);
      lfo.stop(now + 0.29);
      o.stop(now + 0.29);

      return 0.29;
    } catch (e) {
      return 0.01;
    }
  }

  function sleepyMurmur(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 175;

      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 1.4;
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = 7;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);

      var g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.08 * v, now + 0.12);
      g.gain.linearRampToValueAtTime(0.07 * v, now + 0.40);
      g.gain.linearRampToValueAtTime(0, now + 0.70);
      o.connect(g);
      g.connect(ctx.destination);

      lfo.start(now);
      o.start(now);
      lfo.stop(now + 0.71);
      o.stop(now + 0.71);

      return 0.71;
    } catch (e) {
      return 0.01;
    }
  }

  function embarrassedSqueak(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      // Part 1: squeak
      var o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 900;
      o1.frequency.linearRampToValueAtTime(620, now + 0.085);
      var g1 = ctx.createGain();
      g1.gain.setValueAtTime(0, now);
      g1.gain.linearRampToValueAtTime(0.11 * v, now + 0.005);
      g1.gain.linearRampToValueAtTime(0, now + 0.085);
      o1.connect(g1);
      g1.connect(ctx.destination);
      o1.start(now);
      o1.stop(now + 0.09);

      // Part 2: flutter (gap 18ms)
      var o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 490;
      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 22;
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = 42;
      lfo.connect(lfoGain);
      lfoGain.connect(o2.frequency);

      var g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, now + 0.103);
      g2.gain.linearRampToValueAtTime(0.07 * v, now + 0.113);
      g2.gain.linearRampToValueAtTime(0, now + 0.28);
      o2.connect(g2);
      g2.connect(ctx.destination);

      lfo.start(now + 0.103);
      o2.start(now + 0.103);
      lfo.stop(now + 0.29);
      o2.stop(now + 0.29);

      return 0.29;
    } catch (e) {
      return 0.01;
    }
  }

  function suspiciousHum(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 145;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.09 * v, now + 0.04);
      g.gain.linearRampToValueAtTime(0.09 * v, now + 0.38);
      g.gain.linearRampToValueAtTime(0, now + 0.45);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.46);
      return 0.46;
    } catch (e) {
      return 0.01;
    }
  }

  function poutyHuff(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 215;
      o.frequency.linearRampToValueAtTime(138, now + 0.32);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.10 * v, now + 0.008);
      g.gain.linearRampToValueAtTime(0.09 * v, now + 0.19);
      g.gain.linearRampToValueAtTime(0, now + 0.32);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.33);
      return 0.33;
    } catch (e) {
      return 0.01;
    }
  }

  function grumpyDoubleHuff(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      [0, 0.225].forEach(function (offset, i) {
        var o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 228 + i * 7;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0, now + offset);
        g.gain.linearRampToValueAtTime(0.12 * v, now + offset + 0.008);
        g.gain.linearRampToValueAtTime(0.11 * v, now + offset + 0.165);
        g.gain.linearRampToValueAtTime(0, now + offset + 0.195);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + offset);
        o.stop(now + offset + 0.20);
      });
      return 0.425;
    } catch (e) {
      return 0.01;
    }
  }

  function scaredYelp(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 590;
      o.frequency.exponentialRampToValueAtTime(1080, now + 0.115);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.12 * v, now + 0.005);
      g.gain.linearRampToValueAtTime(0.10 * v, now + 0.08);
      g.gain.linearRampToValueAtTime(0, now + 0.115);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.12);
      return 0.12;
    } catch (e) {
      return 0.01;
    }
  }

  function sadWhimper(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 345;
      o.frequency.linearRampToValueAtTime(218, now + 0.52);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.07 * v, now + 0.02);
      g.gain.linearRampToValueAtTime(0.06 * v, now + 0.40);
      g.gain.linearRampToValueAtTime(0, now + 0.54);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.55);
      return 0.55;
    } catch (e) {
      return 0.01;
    }
  }

  function cryingAmbient(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      cryingOscillators = [];
      cryingGain = ctx.createGain();
      cryingGain.gain.setValueAtTime(0, now);
      cryingGain.gain.linearRampToValueAtTime(0.050 * v, now + 3.0);
      cryingGain.connect(ctx.destination);

      var osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 161;
      osc1.connect(cryingGain);
      osc1.start();
      cryingOscillators.push(osc1);

      var osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 166;
      osc2.connect(cryingGain);
      osc2.start();
      cryingOscillators.push(osc2);

      return 120; // Loops indefinitely
    } catch (e) {
      return 0.01;
    }
  }

  function stopCryingAmbient(ctx) {
    try {
      if (cryingOscillators && cryingGain) {
        cryingGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
        setTimeout(function () {
          if (cryingOscillators) {
            cryingOscillators.forEach(function (o) {
              try { o.stop(); } catch (e) { }
            });
            cryingOscillators = null;
          }
          cryingGain = null;
        }, 500);
      }
    } catch (e) {
      // Silent
    }
  }

  function overjoyedFanfare(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      [[520, 705, 0.10, 0], [645, 875, 0.12, 0.17], [775, 1065, 0.14, 0.32]].forEach(function (params) {
        var f1 = params[0], f2 = params[1], vol = params[2], offset = params[3];
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f1;
        o.frequency.exponentialRampToValueAtTime(f2, now + offset + 0.09);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0, now + offset);
        g.gain.linearRampToValueAtTime(vol * v, now + offset + 0.008);
        g.gain.linearRampToValueAtTime(0, now + offset + 0.095);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now + offset);
        o.stop(now + offset + 0.10);
      });
      return 0.42;
    } catch (e) {
      return 0.01;
    }
  }

  function forgivingSigh(ctx, volume) {
    try {
      var now = ctx.currentTime;
      var v = Math.min(volume || 1, 1);

      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 375;
      o.frequency.linearRampToValueAtTime(192, now + 0.75);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.09 * v, now + 0.025);
      g.gain.linearRampToValueAtTime(0.08 * v, now + 0.60);
      g.gain.linearRampToValueAtTime(0, now + 0.75);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.76);
      return 0.76;
    } catch (e) {
      return 0.01;
    }
  }

  // ===== PUBLIC API =====

  var _soundRecipes = {
    happyChirp: happyChirp,
    curiousTrill: curiousTrill,
    sleepyMurmur: sleepyMurmur,
    embarrassedSqueak: embarrassedSqueak,
    suspiciousHum: suspiciousHum,
    poutyHuff: poutyHuff,
    grumpyDoubleHuff: grumpyDoubleHuff,
    scaredYelp: scaredYelp,
    sadWhimper: sadWhimper,
    cryingAmbient: cryingAmbient,
    overjoyedFanfare: overjoyedFanfare,
    forgivingSigh: forgivingSigh
  };

  function playSound(soundName, volume) {
    var ctx = ensureAudioContext();
    if (!ctx) return;

    var recipe = _soundRecipes[soundName];
    if (recipe) {
      queueSound(function (c) { return recipe(c, volume || 1.0); }, volume || 1.0);
    }
  }

  function stopCrying() {
    var ctx = ensureAudioContext();
    if (ctx) stopCryingAmbient(ctx);
  }

  function init() {
    // Initialize on first interaction
    document.addEventListener('mousemove', ensureAudioContext, { once: true });
    document.addEventListener('keydown', ensureAudioContext, { once: true });
    document.addEventListener('click', ensureAudioContext, { once: true });
  }

  return {
    init: init,
    playSound: playSound,
    stopCrying: stopCrying,
    ensureAudioContext: ensureAudioContext
  };
})();
