/**
 * EmotionEngine — Makes DeskBuddy feel genuinely alive.
 *
 * Replaces mechanical emotion-driving logic with a biologically-inspired
 * system built on four pillars:
 *
 *  1. MOOD STATE (Valence + Arousal)
 *     A slow-moving emotional substrate that colors all expression. Pet events,
 *     milestones, long absence, waves, session start — all push the mood.
 *     Mood decays exponentially toward a resting baseline (~neutral-calm).
 *     Practical result: a Buddy that just cried doesn't immediately start
 *     doing gleeful spins. A Buddy that was just waved at stays warmer for
 *     the next few minutes.
 *
 *  2. ANTI-REPETITION WHISPER SELECTION
 *     Rolling history of the last 12 whispers shown. Recently-used lines
 *     receive a heavy weight penalty so the same message never appears twice
 *     in a row (or third, fourth...). Uses exponential penalty: first repeat
 *     → 12% probability, second repeat → 1.4%, third → 0.17%.
 *
 *  3. BEHAVIORAL CHAINING
 *     After certain spontaneous behaviors, a contextually-appropriate
 *     follow-up fires after a short delay. A head-tilt might lead to an
 *     idle look. A daydream leads to a slow blink. A sneeze leads to a
 *     double blink. This creates the impression of a genuine train of thought
 *     rather than isolated random events.
 *
 *  4. ORGANIC SLEEPY CYCLING
 *     Replaces the clock-modulo `Math.floor(now/1000) % 22` cycling in
 *     brain.js with a real state machine. Each phase has a natural hold
 *     duration ± variance, and the cycle escalates concern over time.
 *     Expressions change on their own schedule, not on the wall clock.
 *
 * Integration points (brain.js calls these):
 *   EmotionEngine.getMood()                             — {valence, arousal}
 *   EmotionEngine.boostMood(vDelta, aDelta)             — push mood instantly
 *   EmotionEngine.logEvent(type, detail?)               — notable event
 *   EmotionEngine.pickWhisper(pool)                     — anti-repetition pick
 *   EmotionEngine.getContextualWhisper()                — event-reference pick
 *   EmotionEngine.scheduleBehaviorChain(behaviorName)   — queue follow-up
 *   EmotionEngine.getBehaviorMoodMultiplier(name, v, a) — weight multiplier
 *   EmotionEngine.tickSleepyCycle(now)                  — organic Sleepy emotion
 *   EmotionEngine.resetSleepyCycle(now)                 — reset on session start
 */
const EmotionEngine = (() => {
  'use strict';

  // ═══ 1. MOOD STATE ═════════════════════════════════════════════════════════
  //
  // Valence  : 0 (very sad/distressed) ↔ 1 (very happy/content). Rest: 0.50
  // Arousal  : 0 (exhausted/calm)      ↔ 1 (manic/hyper).        Rest: 0.28
  //
  // Both decay toward their resting value each tick (every 100 ms).
  // External events push them instantly; the slow decay fills in the rest.
  // The system is designed so a single pet (logEvent('pet')) creates a +0.06v
  // lift that lasts about 4 minutes before fully decaying back to neutral.

  let _valence = 0.50;
  let _arousal = 0.28;
  const V_REST = 0.50;
  const A_REST = 0.28;
  // Decay constants: how aggressively each tick moves toward rest.
  // At 100ms intervals: V_DECAY 0.006 means full range (0→1) takes ~167 ticks = ~17s
  // But since it's proportional: a 0.12 boost (wave) halves in ~12s, fully gone in ~40s.
  const V_DECAY_K = 0.006;
  const A_DECAY_K = 0.009;

  function _tickMood() {
    _valence += (V_REST - _valence) * V_DECAY_K;
    _arousal += (A_REST - _arousal) * A_DECAY_K;
    _valence  = Math.max(0, Math.min(1, _valence));
    _arousal  = Math.max(0, Math.min(1, _arousal));
  }

  function boostMood(vDelta, aDelta) {
    _valence = Math.max(0, Math.min(1, _valence + (vDelta || 0)));
    _arousal = Math.max(0, Math.min(1, _arousal + (aDelta || 0)));
  }

  function getMood() {
    return { valence: _valence, arousal: _arousal };
  }


  // ═══ 2. ANTI-REPETITION WHISPER SELECTION ══════════════════════════════════
  //
  // Rolling history of the last 12 whispers.
  // Scoring: uses[text] = 0 → weight 1.0 (fresh, full probability)
  //          uses[text] = 1 → weight 0.12  (12% — recently used)
  //          uses[text] = 2 → weight 0.014 (1.4% — used twice recently)
  //          uses[text] = 3 → weight 0.002 (essentially impossible)
  // Single-item pools are always returned (no choice to diversify).

  const _whisperHistory = [];
  const _HISTORY_CAP    = 12;
  const _PENALTY_BASE   = 0.12;

  function pickWhisper(pool) {
    if (!pool || pool.length === 0) return null;
    if (pool.length === 1) { _recordWhisper(pool[0]); return pool[0]; }

    // Count recent uses per string
    const useCounts = {};
    for (const w of _whisperHistory) {
      useCounts[w] = (useCounts[w] || 0) + 1;
    }

    // Assign weights via exponential penalty
    const scored = pool.map(text => ({
      text,
      weight: Math.pow(_PENALTY_BASE, useCounts[text] || 0),
    }));

    // Weighted random selection
    const total = scored.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * total;
    for (const item of scored) {
      r -= item.weight;
      if (r <= 0) { _recordWhisper(item.text); return item.text; }
    }
    const last = scored[scored.length - 1];
    _recordWhisper(last.text);
    return last.text;
  }

  function _recordWhisper(text) {
    _whisperHistory.push(text);
    if (_whisperHistory.length > _HISTORY_CAP) _whisperHistory.shift();
  }


  // ═══ 3. CONTEXT MEMORY & CONTEXTUAL WHISPERS ═══════════════════════════════
  //
  // Short-term event log (last 8 events, 3-minute window).
  // Allows ambient whispers to reference recent notable moments —
  // "...that wave earlier ♡" — creating the impression of memory.

  const _contextLog  = [];
  const _CTX_MAX     = 8;
  const _CTX_TTL_MS  = 180000;  // 3 minutes

  function logEvent(type, detail) {
    const now = Date.now();
    // Prune stale events
    while (_contextLog.length > 0 && now - _contextLog[0].ms > _CTX_TTL_MS) {
      _contextLog.shift();
    }
    _contextLog.push({ type, detail: detail || null, ms: now });
    if (_contextLog.length > _CTX_MAX) _contextLog.shift();

    // Mood impact table — each event pushes valence and/or arousal
    const impacts = {
      //                    vDelta  aDelta
      wave:          [  0.12,  0.15 ],
      pet:           [  0.06,  0.04 ],
      pat_deep:      [  0.15,  0.08 ],
      milestone:     [  0.20,  0.18 ],
      cry_start:     [ -0.18, -0.08 ],
      cry_end:       [  0.04,  0.00 ],
      session_start: [  0.04,  0.14 ],
      rapid_type:    [  0.02,  0.08 ],
      long_absence:  [ -0.12, -0.05 ],
    };
    const im = impacts[type];
    if (im) boostMood(im[0], im[1]);
  }

  /**
   * Occasionally returns a whisper that references a recent notable event.
   * Fires ~15% of the time. Call this alongside normal whisper selection.
   */
  function getContextualWhisper() {
    if (_contextLog.length === 0 || Math.random() > 0.15) return null;
    const now    = Date.now();
    const recent = _contextLog.filter(e => now - e.ms < _CTX_TTL_MS);
    if (recent.length === 0) return null;

    // Weight recent events by recency (most recent = more likely)
    const last = recent[recent.length - 1];

    const pools = {
      wave:       ['...that wave earlier ♡', '*still happy about your wave*', '...you said hi~ ♡', '*keeps thinking about it*'],
      pet:        ['...that was nice~', '*still warm from earlier*', '...do that again?', '...feeling cared for ♡'],
      pat_deep:   ['...still floating ♡', '*tail still swishing*', '...unforgettable.', '...best moment.'],
      milestone:  ['...so proud of you ✦', '*remembers the streak* ♡', '...you really did that.', '...i was watching the whole time ✦'],
      cry_end:    ['...feeling better now ♡', '*wipes last tear quietly*', '...glad you\'re back.'],
      rapid_type: ['...you were really in it earlier~', '*impressed* ✦', '...flow state. i noticed.'],
      session_start: ['...let\'s make this count ✦', '*quietly cheering for you*', '...ready when you are ♡'],
    };

    const pool = pools[last.type];
    if (!pool) return null;
    return pickWhisper(pool);
  }


  // ═══ 4. BEHAVIORAL MOOD MULTIPLIERS ════════════════════════════════════════
  //
  // Each behavior has a [valenceWeight, arousalWeight] pair.
  // getBehaviorMoodMultiplier() computes a weight multiplier (0.25–2.5)
  // from the current mood deviation from resting values.
  //
  // Examples:
  //   spinOnce [0.7, 0.5]:  needs high valence AND high arousal → rare when tired/sad
  //   daydream [-0.1, -0.5]: low arousal → more daydreaming when calm/tired
  //   slowBlink [0.1, -0.4]: low arousal → more slow blinks when content
  //   wink [0.5, 0.2]:       needs high valence → only when genuinely happy
  //   eyeRub [-0.2, -0.5]:   tiredness/sadness → more eye rubs

  const _BEHAVIOR_MOOD = {
    //                   vW     aW
    idleLook:         [  0.0,   0.3 ],
    doubleBlink:      [ -0.1,  -0.2 ],
    headTilt:         [  0.0,   0.0 ],
    stretch:          [ -0.2,  -0.4 ],
    whisperCoo:       [  0.2,  -0.1 ],
    wink:             [  0.5,   0.2 ],
    peek:             [  0.0,   0.4 ],
    happyFlash:       [  0.8,   0.1 ],
    shiver:           [  0.1,   0.5 ],
    tripleBlink:      [ -0.1,  -0.3 ],
    nuzzle:           [  0.3,  -0.2 ],
    daydream:         [ -0.1,  -0.5 ],
    spinOnce:         [  0.7,   0.5 ],
    slowBlink:        [  0.1,  -0.4 ],
    bounce:           [  0.5,   0.4 ],
    eyeRub:           [ -0.2,  -0.5 ],
    sniff:            [  0.0,   0.3 ],
    groomSelf:        [ -0.1,  -0.1 ],
    headShake:        [  0.0,   0.1 ],
    headBop:          [  0.3,   0.3 ],
    earPerk:          [  0.0,   0.4 ],
    sneeze:           [  0.0,   0.0 ],
  };

  function getBehaviorMoodMultiplier(name, vBias, aBias) {
    // vBias and aBias are normalised deviations from rest: −1 to +1
    const m = _BEHAVIOR_MOOD[name];
    if (!m) return 1.0;
    const raw = 1.0 + m[0] * vBias + m[1] * aBias;
    return Math.max(0.25, Math.min(2.5, raw));
  }


  // ═══ 5. BEHAVIORAL CHAINING ════════════════════════════════════════════════
  //
  // After a spontaneous behavior, schedule a contextually appropriate follow-up.
  // Creates the impression of a genuine train of thought.
  //
  // Chain targets use Brain public behavior API keys exposed in brain.js return.
  // Each chain has: key (behavior name), d (delay range [min,max] ms), p (probability).

  const _CHAINS = {
    headTilt:    [
      { key: 'behaviorIdleLook',    d: [1200, 2000], p: 0.40 },
      { key: 'behaviorWhisperCoo',  d: [ 800, 1600], p: 0.22 },
    ],
    bounce:      [
      { key: 'behaviorHappyFlash',  d: [ 200,  500], p: 0.50 },
      { key: 'behaviorWhisperCoo',  d: [ 600, 1200], p: 0.30 },
    ],
    daydream:    [
      { key: 'behaviorSlowBlink',   d: [2200, 3000], p: 0.55 },
      { key: 'behaviorIdleLook',    d: [3000, 4000], p: 0.28 },
    ],
    sneeze:      [
      { key: 'behaviorDoubleBlink', d: [ 200,  500], p: 0.92 },
    ],
    spinOnce:    [
      { key: 'behaviorHappyFlash',  d: [ 100,  300], p: 0.55 },
    ],
    earPerk:     [
      { key: 'behaviorHeadTilt',    d: [ 300,  800], p: 0.38 },
    ],
    sniff:       [
      { key: 'behaviorHeadTilt',    d: [ 500, 1000], p: 0.32 },
    ],
    groomSelf:   [
      { key: 'behaviorDoubleBlink', d: [ 200,  600], p: 0.75 },
    ],
    wink:        [
      { key: 'behaviorWhisperCoo',  d: [ 200,  600], p: 0.38 },
    ],
    stretch:     [
      { key: 'behaviorSlowBlink',   d: [1000, 1800], p: 0.48 },
    ],
    nuzzle:      [
      { key: 'behaviorDoubleBlink', d: [ 300,  700], p: 0.65 },
    ],
    eyeRub:      [
      { key: 'behaviorStretch',     d: [ 800, 1500], p: 0.30 },
    ],
    headBop:     [
      { key: 'behaviorWhisperCoo',  d: [ 400,  900], p: 0.40 },
    ],
    peek:        [
      { key: 'behaviorWhisperCoo',  d: [ 300,  700], p: 0.30 },
    ],
  };

  let _chainTimer = null;

  function scheduleBehaviorChain(behaviorName) {
    if (_chainTimer) return;  // don't stack chains
    const chains = _CHAINS[behaviorName];
    if (!chains) return;

    // Pick the first chain whose probability fires (they're ordered by desirability)
    for (const chain of chains) {
      if (Math.random() >= chain.p) continue;
      const delay = chain.d[0] + Math.random() * (chain.d[1] - chain.d[0]);
      _chainTimer = setTimeout(() => {
        _chainTimer = null;
        if (typeof Brain === 'undefined') return;
        const fn = Brain[chain.key];
        if (typeof fn !== 'function') return;
        // Don't fire chains during distress or special states
        const blocked = ['crying', 'scared', 'love', 'being_patted', 'dazed',
                         'overjoyed', 'startled', 'cozy'];
        const cur = typeof Emotion !== 'undefined' ? Emotion.getState() : null;
        if (!blocked.includes(cur)) fn();
      }, delay);
      break;
    }
  }


  // ═══ 6. ORGANIC SLEEPY CYCLING ═════════════════════════════════════════════
  //
  // Replaces `Math.floor(now / 1000) % 22` in brain.js.
  //
  // Design: companion is *concerned*, not *performing*.
  // Each phase has a natural hold time ± variance so expressions change
  // on their own schedule (not on a wall clock). The cycle escalates
  // concern over time: curious → focused → suspicious → encouraging → worried.
  //
  // Phase holds are randomised each cycle so no two sleepy periods feel identical.

  const _SLEEPY_PHASES = [
    // Phase 0: gentle check-in — "hmm, you're a bit sleepy..."
    { e: 'curious',    baseMs: 6500, varMs: 2000 },
    // Phase 1: patient watchfulness — staying alert
    { e: 'focused',    baseMs: 4500, varMs: 1500 },
    // Phase 2: mild concern — something feels off
    { e: 'suspicious', baseMs: 4000, varMs: 1500 },
    // Phase 3: brief encouraging flash — "you can do this!"
    { e: 'happy',      baseMs: 2000, varMs:  800 },
    // Phase 4: back to concerned but warmer — "i believe in you"
    { e: 'curious',    baseMs: 5500, varMs: 2000 },
    // Phase 5: visibly worried — "please don't fall asleep"
    { e: 'pouty',      baseMs: 3000, varMs: 1200 },
  ];

  const _sleepyCycle = {
    phase:    0,
    emotion:  'curious',
    nextAt:   0,
  };

  function tickSleepyCycle(now) {
    if (now >= _sleepyCycle.nextAt) {
      // Advance to next phase
      _sleepyCycle.phase = (_sleepyCycle.phase + 1) % _SLEEPY_PHASES.length;
      const step = _SLEEPY_PHASES[_sleepyCycle.phase];
      _sleepyCycle.emotion = step.e;
      // Randomise next transition time
      _sleepyCycle.nextAt  = now + step.baseMs
        + (Math.random() - 0.5) * step.varMs;
    }
    return _sleepyCycle.emotion;
  }

  function resetSleepyCycle(now) {
    _sleepyCycle.phase   = 0;
    _sleepyCycle.emotion = 'curious';
    _sleepyCycle.nextAt  = now + 5000 + Math.random() * 2000;
  }


  // ═══ INIT & TICK ═══════════════════════════════════════════════════════════

  let _started = false;

  function start() {
    if (_started) return;
    _started = true;

    // Mood decay tick — cheap arithmetic, 100ms interval
    setInterval(_tickMood, 100);

    // Watch emotion state changes for context logging
    let _prevEmotion = null;
    setInterval(() => {
      if (typeof Emotion === 'undefined') return;
      const e = Emotion.getState();
      if (e === _prevEmotion) return;
      if (e === 'crying')                             logEvent('cry_start');
      if (_prevEmotion === 'crying' && e !== 'crying') logEvent('cry_end');
      if (e === 'love' || e === 'being_patted')        logEvent('pet');
      _prevEmotion = e;
    }, 500);

    // Hook milestone callback when Brain is ready
    const _hookBrain = () => {
      if (typeof Brain === 'undefined') { setTimeout(_hookBrain, 300); return; }
      if (typeof Brain.onMilestone === 'function') {
        Brain.onMilestone((min) => logEvent('milestone', min));
      }
    };
    setTimeout(_hookBrain, 400);
  }


  // ═══ PUBLIC API ════════════════════════════════════════════════════════════
  return {
    start,
    getMood,
    boostMood,
    logEvent,
    pickWhisper,
    getContextualWhisper,
    scheduleBehaviorChain,
    getBehaviorMoodMultiplier,
    tickSleepyCycle,
    resetSleepyCycle,
  };

})();

// Auto-start once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => EmotionEngine.start());
} else {
  setTimeout(() => EmotionEngine.start(), 50);
}
