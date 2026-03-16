/**
 * AI — Anthropic Claude integration for DeskBuddy.
 * Tracks user behavioral patterns locally and periodically asks Claude
 * to generate personalized whispers and behavior adjustments.
 *
 * Architecture:
 * - All tracking is LOCAL (localStorage) — no data sent without explicit call
 * - API calls are BATCHED — max once per 10 minutes of focus
 * - All calls are NON-BLOCKING — failures are silent, DeskBuddy continues
 * - Claude model: claude-sonnet-4-20250514
 *
 * window.AICompanion.profile — read by brain.js for adaptive reactions
 */

// REPO STUDY:
// Tamagotchi (tugcecerit/Tamagotchi-Game): mood degrades over time via stat decay,
//   persistence via localStorage for hunger/happiness/energy. Repeated feeding/playing
//   improves stats — DeskBuddy mirrors this with rolling session history.
// WebPet (RobThePCGuy/WebPet): no explicit user preference tracking, but session
//   memory via cookie/localStorage for pet state — adapted for behavioral profile.
// face-api.js (justadudewhohacks/face-api.js): expression outputs include happy,
//   sad, angry, fearful, disgusted, surprised, neutral — DeskBuddy could react to
//   user looking fearful/stressed via perception.js expression data.
// EyeOnTask (adithya-s-k/EyeOnTask): session history via CSV logs, pattern
//   recognition over time with productivity scores — inspired rolling 7-day profile.
// REPO BONUS: face-api.js fearful/angry expressions could enhance DeskBuddy's
//   empathy — if user looks stressed, DeskBuddy could soften its reactions.

const AICompanion = (() => {

  // ── Config ────────────────────────────────────────────────────────────────
  const API_URL        = 'https://api.anthropic.com/v1/messages';
  const MODEL          = 'claude-sonnet-4-20250514';
  const CALL_INTERVAL  = 10 * 60 * 1000;  // min 10min between API calls
  const STORAGE_KEY    = 'deskbuddy_profile_v1';
  const MAX_SESSIONS   = 14;  // keep 2 weeks of session data

  // ── State ─────────────────────────────────────────────────────────────────
  let _lastApiCall = 0;
  let _sessionStart = Date.now();

  // Current session live stats — reset each session
  let _session = {
    date:          new Date().toDateString(),
    focusMins:     0,
    smileCount:    0,
    lookAwayCount: 0,
    breakCount:    0,
    peakAttention: 0,
    startHour:     new Date().getHours(),
  };

  // Loaded/saved profile
  let _profile = _loadProfile();

  // Expose for brain.js to read
  window.AICompanion = {
    profile:        _profile,
    getSuggestion:  () => _profile.lastSuggestion || null,
    getMoodBias:    () => _profile.moodBias || 'neutral',
  };

  // ── Public ────────────────────────────────────────────────────────────────

  function init() {
    // Track user events
    setInterval(_tick, 60000);      // update session stats every minute
    setInterval(_maybeCallApi, 60000); // check if API call needed every minute
    console.log('[AI] Behavioral companion initialized — profile loaded:', _profile.sessions?.length || 0, 'sessions');
  }

  // ── Session tracking ──────────────────────────────────────────────────────

  function _tick() {
    const p = window.perception;
    if (!p) return;

    if (p.userState === 'Focused') {
      _session.focusMins++;
      _session.peakAttention = Math.max(_session.peakAttention, p.attentionScore || 0);
    }
    if (p.userSmiling)      _session.smileCount++;
    if (p.userState === 'LookingAway' && p.timeInStateMs < 2000) _session.lookAwayCount++;
  }

  // Called by brain.js when a break happens (NoFace for > 5 min)
  function recordBreak() {
    _session.breakCount++;
  }

  // Called by brain.js each minute
  function updateFocusMinutes(mins) {
    _session.focusMins = mins;
  }

  // ── Profile persistence ───────────────────────────────────────────────────

  function _loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch(_) {}
    return {
      sessions:       [],
      moodBias:       'neutral',
      lastSuggestion: null,
      patterns: {
        avgFocusMins:    0,
        smileFrequency:  'neutral',  // 'often' | 'neutral' | 'rarely'
        peakHour:        null,       // hour of day user focuses best
        streakDays:      0,
      }
    };
  }

  function _saveSession() {
    _profile.sessions.push({ ..._session, saved: Date.now() });
    if (_profile.sessions.length > MAX_SESSIONS) {
      _profile.sessions = _profile.sessions.slice(-MAX_SESSIONS);
    }
    _updatePatterns();
    _saveProfile();
  }

  function _saveProfile() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_profile));
      window.AICompanion.profile = _profile;
    } catch(_) {}
  }

  function _updatePatterns() {
    const sessions = _profile.sessions;
    if (!sessions.length) return;
    const recent = sessions.slice(-7);

    _profile.patterns.avgFocusMins = Math.round(
      recent.reduce((s, r) => s + (r.focusMins || 0), 0) / recent.length
    );

    const totalSmiles = recent.reduce((s, r) => s + (r.smileCount || 0), 0);
    const totalMins   = recent.reduce((s, r) => s + (r.focusMins || 0), 1);
    const smileRate   = totalSmiles / totalMins;
    _profile.patterns.smileFrequency = smileRate > 0.5 ? 'often' : smileRate < 0.1 ? 'rarely' : 'neutral';

    // Peak hour — hour user most often starts focused sessions
    const hours = recent.map(r => r.startHour).filter(h => h !== undefined);
    if (hours.length) {
      const freq = {};
      hours.forEach(h => { freq[h] = (freq[h] || 0) + 1; });
      _profile.patterns.peakHour = parseInt(Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0]);
    }

    // Mood bias based on smile frequency
    _profile.moodBias = _profile.patterns.smileFrequency === 'often' ? 'playful'
                      : _profile.patterns.smileFrequency === 'rarely' ? 'gentle'
                      : 'neutral';
  }

  // ── Adaptive behavior hints for brain.js ──────────────────────────────────

  // Returns a multiplier (0.5–1.5) for how much DeskBuddy sulks when user looks away
  // Users who look away often get a gentler DeskBuddy — it's learned not to overreact
  function getLookAwayTolerance() {
    const avg = _profile.sessions.slice(-7)
      .reduce((s, r) => s + (r.lookAwayCount || 0), 0) / 7;
    return avg > 5 ? 0.6 : avg > 2 ? 0.85 : 1.0;
  }

  // Returns true during user's known peak focus hour (±1 hour)
  function isUserPeakHour() {
    const peak = _profile.patterns.peakHour;
    if (peak === null) return false;
    const hour = new Date().getHours();
    return Math.abs(hour - peak) <= 1;
  }

  // ── Claude API ────────────────────────────────────────────────────────────

  async function _maybeCallApi() {
    const now = Date.now();
    if (now - _lastApiCall < CALL_INTERVAL) return;
    if (!window.perception?.facePresent) return;
    if (_session.focusMins < 5) return;  // need at least 5min of focus first

    _lastApiCall = now;
    _saveSession();

    try {
      const summary = _buildSummary();
      const response = await _callClaude(summary);
      if (response) _applyResponse(response);
    } catch(e) {
      console.warn('[AI] API call failed silently:', e.message);
    }
  }

  function _buildSummary() {
    const p   = _profile.patterns;
    const s   = _session;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

    return `You are DeskBuddy, a cute floating-eye desktop companion. You watch over a user while they work/study.

WHAT YOU KNOW ABOUT THIS USER (learned from ${_profile.sessions.length} sessions):
- Average focus session: ${p.avgFocusMins} minutes
- Smile frequency: ${p.smileFrequency} (${p.smileFrequency === 'often' ? 'they smile a lot — warm and happy person' : p.smileFrequency === 'rarely' ? 'they rarely smile while working — focused or stressed' : 'they smile sometimes'})
- Best focus hour: ${p.peakHour !== null ? p.peakHour + ':00' : 'still learning'}
- Current session: ${s.focusMins} minutes focused, ${s.smileCount} smiles, ${s.lookAwayCount} times looked away, ${s.breakCount} breaks
- Mood bias: ${_profile.moodBias}
- Time of day: ${greeting}

Generate a response with EXACTLY this JSON structure (no other text):
{
  "whisper": "a short sweet 3-8 word message to whisper to the user, written in DeskBuddy's cute personality. Use ˆωˆ or ♡ sparingly. Be specific to what you know about them.",
  "emotion": "one of: happy|curious|focused|idle|sleepy — what emotion DeskBuddy should briefly show",
  "note": "one sentence about this user's pattern you noticed (internal, not shown to user)"
}

The whisper should feel personal and warm, never generic. Examples of good whispers:
- "two whole hours~ ˆωˆ" (for long session)
- "you always smile here ♡" (for frequent smiler)
- "peak hour~ lets go!" (during their best focus time)`;
  }

  async function _callClaude(prompt) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    return JSON.parse(match[0]);
  }

  function _applyResponse(response) {
    try {
      // Save the suggestion for brain.js to read
      _profile.lastSuggestion = response;
      _saveProfile();

      // Show the whisper
      if (response.whisper && typeof Brain !== 'undefined') {
        Brain.showWhisper(response.whisper, 6000);
      }

      // Brief emotion flash if suggested
      if (response.emotion && typeof Emotion !== 'undefined') {
        const prev = Emotion.getState();
        const valid = ['happy','curious','focused','idle','sleepy'];
        if (valid.includes(response.emotion) && response.emotion !== prev) {
          Emotion.setState(response.emotion);
          setTimeout(() => {
            if (Emotion.getState() === response.emotion) Emotion.setState(prev || 'idle');
          }, 2000);
        }
      }

      console.log('[AI] Response applied. Note:', response.note);
    } catch(e) {
      console.warn('[AI] Failed to apply response:', e.message);
    }
  }

  // ── Session end (called when app closes or user gone 60s) ─────────────────
  function endSession() {
    if (_session.focusMins > 0) {
      _saveSession();
    }
  }

  window.addEventListener('beforeunload', endSession);

  return {
    init,
    recordBreak,
    updateFocusMinutes,
    getLookAwayTolerance,
    isUserPeakHour,
    endSession
  };
})();
