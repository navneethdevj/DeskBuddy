/**
 * emotion-enhancements.js
 * 
 * Enhances the emotional quality of DeskBuddy:
 * 1. Emotional resistance to petting (sad/grumpy/crying need to be soothed first)
 * 2. Crying → smile detection → gradual recovery with sniffles/relief
 * 3. Anger/grumpy → petting resistance with gradual softening
 * 4. New emotional states: relieved, mischievous, blushing
 * 5. Richer emotional transitions
 */
(function() {
  'use strict';

  // Wait for Brain to be available
  const _init = () => {
    if (typeof Brain === 'undefined' || typeof Emotion === 'undefined') {
      setTimeout(_init, 100);
      return;
    }
    _patchEmotionalResistance();
    _startSmileRecoveryWatcher();
    _startEmotionalMemory();
  };

  // ── Patch: emotional resistance to petting ──────────────────────────────
  // Sad/grumpy/crying buddies resist petting initially — they need time to
  // warm up. The resistance softens gradually as the user keeps trying.

  let _petResistanceLevel = 0;   // 0 = none, 1 = reluctant, 2 = resistant
  let _resistanceDecayTimer = null;
  let _softeningMs = 0;          // how long user has been persisting through resistance
  const RESISTANCE_SOFTEN_MS = 4500;  // time to fully break through resistance

  function _getResistanceForEmotion(emotion) {
    const highResistance = ['grumpy', 'sad', 'crying', 'sulking', 'pouty'];
    const lowResistance  = ['suspicious', 'scared'];
    if (highResistance.includes(emotion)) return 2;
    if (lowResistance.includes(emotion))  return 1;
    return 0;
  }

  function _patchEmotionalResistance() {
    // We intercept mousedown near the companion and check the emotional state
    const origMouseDown = document.addEventListener;

    document.addEventListener('mousedown', (e) => {
      const emotion = Emotion.getState();
      const resistance = _getResistanceForEmotion(emotion);
      if (resistance === 0) {
        _petResistanceLevel = 0;
        _softeningMs = 0;
        if (_resistanceDecayTimer) { clearTimeout(_resistanceDecayTimer); _resistanceDecayTimer = null; }
        return;
      }

      // Check if clicking near companion
      if (typeof Companion === 'undefined') return;
      const c    = Companion.getCenter();
      const dx   = e.clientX - c.x;
      const dy   = e.clientY - c.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist >= 240) return;

      _petResistanceLevel = resistance;
      _startResistanceSoftening(emotion, resistance);
    }, true);  // capture phase so we run before brain.js mousedown
  }

  function _startResistanceSoftening(emotion, level) {
    if (_resistanceDecayTimer) { clearTimeout(_resistanceDecayTimer); _resistanceDecayTimer = null; }

    _softeningMs = 0;
    const step = 400; // check every 400ms

    const tick = () => {
      _softeningMs += step;
      const progress = Math.min(1, _softeningMs / RESISTANCE_SOFTEN_MS);

      if (progress < 0.3) {
        // Stage 1: Flinch/recoil — buddy pulls away slightly
        _showResistanceReaction(emotion, 'flinch');
      } else if (progress < 0.65) {
        // Stage 2: Uncertain — starting to soften but still wary
        _showResistanceReaction(emotion, 'uncertain');
      } else if (progress >= 1.0) {
        // Stage 3: Fully softened — allow normal petting
        _petResistanceLevel = 0;
        _softeningMs = 0;
        _showResistanceReaction(emotion, 'softened');
        return; // stop ticking
      }

      _resistanceDecayTimer = setTimeout(tick, step);
    };

    _resistanceDecayTimer = setTimeout(tick, step);
  }

  function _showResistanceReaction(emotion, stage) {
    if (!window.Brain || !Brain.showWhisper) return;

    if (stage === 'flinch') {
      const el = typeof Companion !== 'undefined' ? Companion.getElement() : null;
      if (el) { el.classList.add('shiver'); setTimeout(() => el.classList.remove('shiver'), 400); }

      if (emotion === 'crying') {
        const msgs = ['...sniffles.', '*pulls away*', '...leave me alone.', '*hiccups*', '...please...'];
        if (Math.random() < 0.55) Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2500);
      } else if (emotion === 'grumpy' || emotion === 'sulking') {
        const msgs = ['hmph.', '*looks away*', '...not now.', '*tenses up*', '...don\'t.'];
        if (Math.random() < 0.6) Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2500);
      } else if (emotion === 'sad') {
        const msgs = ['...', '*sniffles*', '...not sure if i want this.', '*hesitates*'];
        if (Math.random() < 0.5) Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2500);
      } else if (emotion === 'pouty') {
        const msgs = ['...hmph.', '*stiffens*', 'apologize first.', '...i\'m still mad.'];
        if (Math.random() < 0.55) Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2500);
      }
    } else if (stage === 'uncertain') {
      if (emotion === 'crying') {
        const msgs = ['...okay...', '*sniffles* ...are you here?', '...maybe.', '*hesitant*'];
        if (Math.random() < 0.45) Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2800);
      } else if (emotion === 'grumpy' || emotion === 'sulking') {
        const msgs = ['...fine.', '*trying to stay mad*', '...i\'m still upset.', '...okay maybe.'];
        if (Math.random() < 0.45) Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2800);
      } else if (emotion === 'pouty') {
        const msgs = ['...i suppose.', '*considering it*', '...well...', '*slowly uncrosses arms*'];
        if (Math.random() < 0.50) Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2800);
      }
    } else if (stage === 'softened') {
      if (emotion === 'crying') {
        const msgs = ['...okay. thank you.', '*sniffles softly*', '...this helps.', '...i feel a little better ♡'];
        Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 4000);
        // Transition to relieved/sad fading
        setTimeout(() => {
          if (Emotion.getState() === 'crying' || Emotion.getState() === 'sad') {
            Emotion.preview('happy', 2000);
          }
        }, 800);
      } else if (emotion === 'grumpy' || emotion === 'sulking') {
        const msgs = ['...fine. you win.', '*begrudgingly melts*', '...okay i missed you.', '...i can\'t stay mad.'];
        Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 4000);
        setTimeout(() => {
          if (Emotion.getState() === 'grumpy' || Emotion.getState() === 'sulking') {
            Emotion.preview('cozy', 2000);
          }
        }, 600);
      } else if (emotion === 'pouty') {
        const msgs = ['...okay fine. ♡', '*still a little pouty but smiling*', '...you\'re lucky you\'re cute.', 'apology accepted. barely.'];
        Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 4000);
      }
    }
  }

  // ── Patch: Crying → User smile → gradual recovery ───────────────────────
  // When the buddy is crying or sad, if the USER smiles, the buddy should
  // gradually notice and recover — not instantly become happy.
  
  let _smileRecoveryActive = false;
  let _smileRecoveryProgress = 0;
  let _smileRecoveryTimer = null;
  let _hadUserSmile = false;

  function _startSmileRecoveryWatcher() {
    const POLL_INTERVAL = 600;
    
    setInterval(() => {
      const emotion = Emotion.getState();
      const p = window.perception;
      const isCryingOrSad = emotion === 'crying' || emotion === 'sad';
      const userSmiling = window.cameraAvailable && p?.facePresent && p?.userSmiling;

      if (isCryingOrSad && userSmiling && !_smileRecoveryActive) {
        // User smiled at crying buddy — start gradual recovery
        _startSmileRecovery(emotion);
      }

      if (!userSmiling && _smileRecoveryActive && _smileRecoveryProgress < 0.5) {
        // Stopped smiling before halfway — abort recovery, settle back
        _abortSmileRecovery(emotion);
      }

    }, POLL_INTERVAL);
  }

  function _startSmileRecovery(emotion) {
    if (_smileRecoveryActive) return;
    _smileRecoveryActive = true;
    _smileRecoveryProgress = 0;

    if (Brain.showWhisper) {
      const noticesMsgs = [
        '...is that a smile?', '...wait...', '*sniffles and looks up*',
        '...are you smiling at me?', '*peeks through tears*', '...huh?'
      ];
      Brain.showWhisper(noticesMsgs[Math.floor(Math.random() * noticesMsgs.length)], 3000);
    }

    // Stage 1: Notice the smile (1.5s)
    _smileRecoveryTimer = setTimeout(() => {
      _smileRecoveryProgress = 0.33;
      if (!_smileRecoveryActive) return;

      if (Brain.showWhisper) {
        const softeningMsgs = [
          '...you\'re smiling at me...', '*sniffles*', '...i see you ♡',
          '...was that for me?', '*blinks tears away slowly*'
        ];
        Brain.showWhisper(softeningMsgs[Math.floor(Math.random() * softeningMsgs.length)], 3000);
      }

      // Stage 2: Soften (1.5s)
      _smileRecoveryTimer = setTimeout(() => {
        _smileRecoveryProgress = 0.66;
        if (!_smileRecoveryActive) return;

        Emotion.preview('shy', 1800);
        if (Brain.showWhisper) {
          const almostMsgs = [
            '...okay. you\'re forgiven ♡', '*almost smiling*',
            '...stop, you\'re making me smile too~', '...fine. you got me ♡'
          ];
          Brain.showWhisper(almostMsgs[Math.floor(Math.random() * almostMsgs.length)], 3000);
        }

        // Stage 3: Full recovery (2s)
        _smileRecoveryTimer = setTimeout(() => {
          _smileRecoveryProgress = 1.0;
          if (!_smileRecoveryActive) return;

          _smileRecoveryActive = false;

          const emotion2 = Emotion.getState();
          if (emotion2 === 'crying' || emotion2 === 'sad' || emotion2 === 'shy') {
            Emotion.setState('happy');
            if (window._lastEmotion !== undefined) window._lastEmotion = 'happy';
          }

          if (Brain.showWhisper) {
            const recoveredMsgs = [
              '...okay. i\'m better now ♡', '*wipes last tear and smiles*',
              '...your smile is contagious.', '...thank you ♡',
              '*soft happy sigh* ...♡', '...okay. you fixed it.'
            ];
            Brain.showWhisper(recoveredMsgs[Math.floor(Math.random() * recoveredMsgs.length)], 4000);
          }

          if (typeof Particles !== 'undefined') Particles.burst('happy', 6);

        }, 2000);
      }, 1500);
    }, 1500);
  }

  function _abortSmileRecovery(emotion) {
    _smileRecoveryActive = false;
    if (_smileRecoveryTimer) { clearTimeout(_smileRecoveryTimer); _smileRecoveryTimer = null; }
    _smileRecoveryProgress = 0;

    // Settle back into the distressed state
    if (Brain.showWhisper && (emotion === 'crying' || emotion === 'sad')) {
      const msgs = ['...', '*looks away again*', '...it\'s fine.'];
      if (Math.random() < 0.4) Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2000);
    }
  }

  // ── Emotional memory: track emotion history for richer transitions ───────
  // Keep a short buffer of recent emotions to enable "aftermath" reactions
  let _emotionHistory = [];
  const EMOTION_HISTORY_MAX = 5;
  let _lastCheckedEmotion = null;
  
  function _startEmotionalMemory() {
    setInterval(() => {
      const current = Emotion.getState();
      if (current && current !== _lastCheckedEmotion) {
        _emotionHistory.push({ emotion: current, time: Date.now() });
        if (_emotionHistory.length > EMOTION_HISTORY_MAX) _emotionHistory.shift();
        _lastCheckedEmotion = current;
        _checkEmotionalAftermath(current, _emotionHistory);
      }
    }, 800);
  }

  function _checkEmotionalAftermath(current, history) {
    if (history.length < 2) return;
    const prev = history[history.length - 2];

    // After grumpy/pouty → forgiven: show relief
    if (current === 'forgiven') {
      setTimeout(() => {
        if (Emotion.getState() === 'forgiven' || Emotion.getState() === 'happy') {
          if (Brain.showWhisper && Math.random() < 0.7) {
            const msgs = [
              '...phew. ♡', '*big relieved breath*', '...i\'m glad you\'re still here.',
              '...we\'re good? ♡', '*melts with relief*', '...yay. back to normal ♡'
            ];
            Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 4000);
          }
        }
      }, 1200);
    }

    // After embarrassed → returning to normal: shy whisper
    if (prev.emotion === 'embarrassed' && (current === 'idle' || current === 'focused')) {
      if (Brain.showWhisper && Math.random() < 0.45) {
        const msgs = ['...pretend you didn\'t see that.', '...i\'m fine. totally fine.', '///'];
        Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2500);
      }
    }

    // After dazed → returning to normal: floaty whisper
    if (prev.emotion === 'dazed' && (current === 'idle' || current === 'focused')) {
      if (Brain.showWhisper && Math.random() < 0.55) {
        const msgs = [
          '...what just happened.', '*blinks slowly* ...wow.',
          '...i feel amazing.', '*still floating a little*', '...hehe ♡'
        ];
        Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 3500);
      }
    }

    // After overjoyed → calm: gentle landing
    if (prev.emotion === 'overjoyed' && (current === 'happy' || current === 'focused')) {
      if (Brain.showWhisper && Math.random() < 0.3) {
        const msgs = ['...still smiling ♡', '...that was the best.', '*happy afterglow*'];
        Brain.showWhisper(msgs[Math.floor(Math.random() * msgs.length)], 2500);
      }
    }
  }

  // ── Pink glow / emotional glow enhancement ───────────────────────────────
  // Ensure emotional glow states match the emotion immediately without delay
  function _applyEmotionGlow(emotion) {
    const el = typeof Companion !== 'undefined' ? Companion.getElement() : null;
    if (!el) return;

    // Remove all emotion glow classes
    const glowClasses = ['emotion-glow-sad', 'emotion-glow-love', 'emotion-glow-angry',
                         'emotion-glow-crying', 'emotion-glow-happy', 'emotion-glow-overjoyed'];
    glowClasses.forEach(c => el.classList.remove(c));

    // Add appropriate glow
    if (emotion === 'sad' || emotion === 'scared') {
      el.classList.add('emotion-glow-sad');
    } else if (emotion === 'crying') {
      el.classList.add('emotion-glow-crying');
    } else if (emotion === 'love' || emotion === 'being_patted' || emotion === 'cozy') {
      el.classList.add('emotion-glow-love');
    } else if (emotion === 'grumpy' || emotion === 'pouty' || emotion === 'sulking') {
      el.classList.add('emotion-glow-angry');
    } else if (emotion === 'happy' || emotion === 'overjoyed' || emotion === 'excited') {
      el.classList.add('emotion-glow-happy');
    } else if (emotion === 'overjoyed' || emotion === 'ecstatic') {
      el.classList.add('emotion-glow-overjoyed');
    }
  }

  // Watch for emotion changes to apply glow
  let _glowWatchLast = null;
  setInterval(() => {
    const e = typeof Emotion !== 'undefined' ? Emotion.getState() : null;
    if (e !== _glowWatchLast) {
      _glowWatchLast = e;
      _applyEmotionGlow(e);
    }
  }, 200);

  // Expose for debug
  window._emotionEnhancements = { petResistanceLevel: () => _petResistanceLevel };

  // Start
  _init();

})();
