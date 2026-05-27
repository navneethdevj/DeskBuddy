/**
 * session-panel-fix.js  —  Complete session + history panel overhaul
 *
 * v2 additions:
 *  • Wall-clock session timer: _wallSecs counts active-state seconds only
 *  • Break interval scheduler: fires break toast when segment secs >= interval
 *  • Session ends when _wallSecs >= _totalSecs (wall-clock expiry → COMPLETED)
 *  • sp-inline-timer shows remaining/elapsed based on sessionTimerMode setting
 *  • Progress ring driven by wall-clock elapsed
 *  • Buddy timer override during breaks (window._spfBuddyTimerOverride)
 *  • PiP break pending: badge + OS notification, toast shown on fullscreen return
 *  • Auto-resume toggle synced with break-auto-resume-enabled checkbox
 *  • History panel scrollbar properly visible
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  //  CONSTANTS
  // ══════════════════════════════════════════════════════════════

  const AFFIRMATIONS = [
    "drink some water — seriously",
    "stretch those muscles",
    "step outside for fresh air",
    "rest is not laziness",
    "your brain earns this break",
    "you're building focus stamina",
    "small breaks → big results",
    "breathe deep, reset your mind",
    "you've got this — keep going",
    "stand up and move around",
    "close your eyes for a minute",
    "look out a window, far away",
  ];

  const RING_CIRC = 138.23; // 2π × r=22 for the SVG progress ring

  // ══════════════════════════════════════════════════════════════
  //  WALL-CLOCK SESSION STATE
  // ══════════════════════════════════════════════════════════════

  let _wallTimerId    = null;  // setInterval handle — runs every 1s during ACTIVE
  let _wallSecs       = 0;     // total active-state wall-clock seconds elapsed
  let _totalSecs      = 0;     // configured session duration in seconds
  let _pipBreakPending = false; // break fired while in PiP mode

  // ══════════════════════════════════════════════════════════════
  //  BREAK TIMER STATE
  // ══════════════════════════════════════════════════════════════

  let _breakTimerId       = null;
  let _breakIsTimed       = true;   // true = countdown, false = countup
  let _breakRemSecs       = 0;      // countdown remaining
  let _breakElapsedSecs   = 0;      // countup elapsed
  let _snoozeActive       = false;
  let _snoozeTimerId      = null;
  let _breakStartWallMs   = null;
  let _segmentSecs  = 0;   // seconds elapsed in current focus segment (since last break ended / session start)
  let _breakIntervalSecs = 0; // cached break interval in seconds (set on session start)

  // ══════════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════════

  const _el  = id => document.getElementById(id);
  const _raf = fn => { requestAnimationFrame(() => requestAnimationFrame(fn)); };

  function _fmtTime(secs) {
    secs = Math.max(0, Math.floor(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function _fmtFocus(secs) {
    secs = Math.floor(secs);
    if (secs < 60)    return `${secs}s`;
    if (secs < 3600)  return `${Math.floor(secs/60)}m`;
    const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  // ══════════════════════════════════════════════════════════════
  //  INPUT READERS
  // ══════════════════════════════════════════════════════════════

  function _getSessionTotalSecs() {
    const h = parseInt(_el('duration-h')?.value, 10) || 0;
    const m = parseInt(_el('duration-m')?.value, 10) || 0;
    const s = parseInt(_el('duration-s')?.value, 10) || 0;
    return h * 3600 + m * 60 + s;
  }

  function _getBreakDurSecs() {
    const h = parseInt(_el('break-dur-h')?.value,10)||0;
    const m = parseInt(_el('break-dur-m')?.value,10)||0;
    const s = parseInt(_el('break-dur-s')?.value,10)||0;
    return h*3600 + m*60 + s;
  }

  function _setBreakDurSecs(total) {
    total = Math.max(0, Math.min(86399, Math.round(total)));
    const h = Math.floor(total/3600), m = Math.floor((total%3600)/60), s = total%60;
    const hEl=_el('break-dur-h'), mEl=_el('break-dur-m'), sEl=_el('break-dur-s');
    if(hEl) hEl.value=h; if(mEl) mEl.value=m; if(sEl) sEl.value=s;
  }

  function _getBreakIntervalSecs() {
    const h = parseInt(_el('break-h')?.value,10)||0;
    const m = parseInt(_el('break-m')?.value,10)||0;
    const s = parseInt(_el('break-s')?.value,10)||0;
    return h*3600 + m*60 + s;
  }

  function _getSessionTimerMode() {
    if (typeof Settings !== 'undefined' && Settings.get)
      return Settings.get('sessionTimerMode') || 'breakInterval';
    return 'breakInterval';
  }

  // ══════════════════════════════════════════════════════════════
  //  WALL-CLOCK SESSION TIMER
  // ══════════════════════════════════════════════════════════════

  function _startWallTimer() {
    _stopWallTimer();
    window._spfWallTimerActive = true;
    _wallTimerId = setInterval(_wallTick, 1000);
  }

  function _stopWallTimer() {
    if (_wallTimerId) { clearInterval(_wallTimerId); _wallTimerId = null; }
  }

  function _wallTick() {
    _wallSecs++;
    _segmentSecs++;
    _updateSessionPanelTimer();

    // Session ending-soon warnings (Change 11)
    if (_totalSecs > 0) {
      const remaining = _totalSecs - _wallSecs;
      if (remaining === 300 || remaining === 120 || remaining === 60) {
        _showEndingSoonToast(remaining);
      }
    }

    // Check session wall-clock expiry
    if (_totalSecs > 0 && _wallSecs >= _totalSecs) {
      _stopWallTimer();
      _endSessionByWallClock();
    }
  }

  function _updateSessionPanelTimer() {
    const mode = _getSessionTimerMode();
    let displaySecs;

    if (mode === 'elapsed') {
      displaySecs = _wallSecs;
    } else if (mode === 'breakInterval') {
      const interval = _breakIntervalSecs > 0 ? _breakIntervalSecs : _getBreakIntervalSecs();
      displaySecs = Math.max(0, interval - _segmentSecs);
    } else {
      // 'remaining' (full session countdown)
      displaySecs = Math.max(0, _totalSecs - _wallSecs);
    }

    const inlineTimer = _el('sp-inline-timer');
    if (inlineTimer) inlineTimer.textContent = _fmtTime(displaySecs);

    // Drive the progress ring from wall-clock
    const ring = _el('sp-ring-progress');
    if (ring && _totalSecs > 0) {
      ring.style.strokeDashoffset = String(RING_CIRC * (_wallSecs / _totalSecs));
    }

    // Update state label (Change 10A)
    const stateLabel = document.querySelector('.sp-ring-state-label');
    if (stateLabel) {
      if (mode === 'breakInterval') stateLabel.textContent = 'next break';
      else if (mode === 'elapsed')  stateLabel.textContent = 'elapsed';
      else                          stateLabel.textContent = 'remaining';
    }
  }

  function _showEndingSoonToast(remainingSecs) {
    // Reuse the global-break-toast briefly as a non-intrusive nudge
    const toast = _el('global-break-toast');
    const titleEl = _el('gbt-title') || toast?.querySelector('.gbt-title');
    const subEl = _el('gbt-sub') || toast?.querySelector('.gbt-sub');
    const actionsEl = toast?.querySelector('.gbt-actions');
    if (!toast || _toastVisible) return;

    const label = remainingSecs >= 300 ? '5 minutes left'
                : remainingSecs >= 120 ? '2 minutes left'
                :                        '1 minute left';
    if (titleEl) titleEl.textContent = label;
    if (subEl)   subEl.textContent   = 'your session is almost done ✦';
    if (actionsEl) actionsEl.style.display = 'none';

    _toastVisible = true;
    toast.style.display = '';
    _raf(() => toast.classList.add('gbt-visible'));

    // Auto-hide after 4 seconds, then restore toast for breaks
    setTimeout(() => {
      _hideGlobalToast();
      if (titleEl)   titleEl.textContent = 'Time for a break!';
      // Restore inner HTML to preserve the gbt-elapsed span
      if (subEl)     subEl.innerHTML = "You've been focused for <span id=\"gbt-elapsed\">—</span>";
      if (actionsEl) actionsEl.style.display = '';
    }, 4000);

    if (typeof Sounds !== 'undefined') Sounds.play('break_end');
  }

  function _endSessionByWallClock() {
    // Trigger COMPLETED via Timer: init(0) → Timer fires FAILED with remaining=0
    // → session.js detects naturalExpiry=true → marks COMPLETED ✓
    if (typeof BreakReminder !== 'undefined') BreakReminder.stop();
    _hideGlobalToast();
    _stopBreakTimer();
    if (typeof Timer !== 'undefined') {
      Timer.init(0);
      Timer.start();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  IDLE STATS
  // ══════════════════════════════════════════════════════════════

  function _updateIdleStats() {
    if (typeof Session === 'undefined') return;
    const history = Session.getHistory();
    const today   = new Date(); today.setHours(0,0,0,0);
    const todayMs = today.getTime();

    const todaySess = history.filter(s => {
      if (!s.date) return false;
      const d = new Date(s.date); d.setHours(0,0,0,0);
      return d.getTime() === todayMs && s.outcome !== 'ABANDONED';
    });

    const focusSecs = todaySess.reduce((sum,s)=>sum+(s.actualFocusedSeconds||0),0);
    const streak    = Session.computeDayStreak ? Session.computeDayStreak() : 0;

    const sessEl   = _el('sp-qs-sessions');
    const focusEl  = _el('sp-qs-minutes');
    const streakEl = _el('sp-qs-streak');
    if(sessEl)   sessEl.textContent   = String(todaySess.length);
    if(focusEl)  focusEl.textContent  = focusSecs>0 ? _fmtFocus(focusSecs) : '0m';
    if(streakEl) streakEl.textContent = streak>0 ? `${streak}d` : '0';
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAK COUNTDOWN / COUNTUP
  // ══════════════════════════════════════════════════════════════

  function _stopBreakTimer() {
    if (_breakTimerId) { clearInterval(_breakTimerId); _breakTimerId=null; }
  }

  function _updateBreakDisplay() {
    const el   = _el('break-countdown');
    const hint = _el('sp-break-hint');
    if (!el) return;

    if (_breakIsTimed) {
      el.textContent = _fmtTime(_breakRemSecs);
      if(hint) hint.textContent = 'remaining';
      const dur = _getBreakDurSecs();
      const pct = dur > 0 ? _breakRemSecs/dur : 1;
      if      (pct < 0.20) el.style.color = 'rgba(248,113,113,0.90)';
      else if (pct < 0.45) el.style.color = 'rgba(251,191,36,0.90)';
      else                 el.style.color = 'rgba(68,232,176,0.90)';

      // Buddy timer: countdown
      window._spfBuddyTimerOverride = `break ${_fmtTime(_breakRemSecs)}`;
    } else {
      el.textContent = _fmtTime(_breakElapsedSecs);
      el.style.color = 'rgba(139,118,255,0.80)';
      if(hint) hint.textContent = 'time on break';

      // Buddy timer: countup
      window._spfBuddyTimerOverride = `break ${_fmtTime(_breakElapsedSecs)}`;
    }

    // State label: on break (Change 10A)
    const stateLabel = document.querySelector('.sp-ring-state-label');
    if (stateLabel) stateLabel.textContent = 'on break';
  }

  function _startBreakCountdown(isTimed) {
    _stopBreakTimer();
    _breakIsTimed       = isTimed;
    _breakRemSecs       = _getBreakDurSecs();
    _breakElapsedSecs   = 0;
    _breakStartWallMs   = Date.now();

    _hideBreakOverNotif();
    _updateBreakDisplay();

    _breakTimerId = setInterval(() => {
      if (_breakIsTimed) {
        _breakRemSecs = Math.max(0, _breakRemSecs-1);
        _updateBreakDisplay();
        if (_breakRemSecs === 0) { _stopBreakTimer(); _onBreakEnd(); }
      } else {
        _breakElapsedSecs++;
        _updateBreakDisplay();
      }
    }, 1000);

    const affEl = _el('sp-break-affirmation');
    if(affEl) affEl.textContent = AFFIRMATIONS[Math.floor(Math.random()*AFFIRMATIONS.length)];
  }

  function _onBreakEnd() {
    const el = _el('break-countdown');
    if(el) {
      el.style.animation = 'sp-break-done-pulse 0.9s ease-in-out 4';
      setTimeout(()=>{ if(el) el.style.animation=''; }, 3800);
    }

    // Auto-resume if setting enabled, otherwise show notification
    const autoResume = _el('break-auto-resume-enabled')?.checked;
    if (autoResume) {
      window._spfBuddyTimerOverride = 'break ✦ resuming...';
      setTimeout(() => {
        if (typeof Session !== 'undefined' && typeof Timer !== 'undefined') {
          const s = Session.getCurrentStats();
          if (s && s.state === 'PAUSED') {
            _hideBreakOverNotif();
            Session.resume();
            Timer.resume();
            _segmentSecs = 0;
            if (typeof BreakReminder !== 'undefined') BreakReminder.resume();
          }
        }
      }, 900);
    } else {
      const notif = _el('sp-break-over-notif');
      if(notif) { notif.style.display=''; _raf(()=>notif.classList.add('sp-notif-visible')); }
    }
  }

  function _hideBreakOverNotif() {
    const notif = _el('sp-break-over-notif');
    if(!notif) return;
    notif.classList.remove('sp-notif-visible');
    setTimeout(()=>{ notif.style.display='none'; }, 280);
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAK TYPE CHOOSER
  // ══════════════════════════════════════════════════════════════

  function _showBreakTypeChooser(source) {
    // Check if break-for duration is 0 → open-ended (until turned off)
    const durSecs = _getBreakDurSecs();

    // If "until I turn off" (0s), skip chooser and go open-ended
    if (durSecs === 0) {
      _startBreakCountdown(false);
      return;
    }

    // Skip modal for scheduled breaks when duration is already configured
    const skipModal = source === 'scheduled' && _el('break-for-enabled')?.checked !== false;
    if (skipModal) {
      _startBreakCountdown(true);
      return;
    }

    const modal = _el('break-type-modal');
    if (!modal) { _startBreakCountdown(true); return; }

    const durLbl = _el('btm-timed-dur');
    if(durLbl) durLbl.textContent = _fmtTime(durSecs) + ' break';

    modal.style.display = '';

    const onTimed = () => { modal.style.display='none'; _startBreakCountdown(true);  cleanup(); };
    const onOpen  = () => { modal.style.display='none'; _startBreakCountdown(false); cleanup(); };

    const timedBtn = _el('btm-timed');
    const openBtn  = _el('btm-open');

    const cleanup = () => {
      if(timedBtn) timedBtn.removeEventListener('click', onTimed);
      if(openBtn)  openBtn.removeEventListener('click',  onOpen);
    };

    if(timedBtn) timedBtn.addEventListener('click', onTimed, {once:true});
    if(openBtn)  openBtn.addEventListener('click',  onOpen,  {once:true});

    const autoTimer = setTimeout(() => {
      if(modal.style.display !== 'none') { modal.style.display='none'; _startBreakCountdown(true); cleanup(); }
    }, 15000);
    timedBtn?.addEventListener('click', ()=>clearTimeout(autoTimer), {once:true});
    openBtn?.addEventListener( 'click', ()=>clearTimeout(autoTimer), {once:true});
  }

  // ══════════════════════════════════════════════════════════════
  //  GLOBAL BREAK TOAST
  // ══════════════════════════════════════════════════════════════

  let _toastVisible = false;

  function _showGlobalToast() {
    const toast = _el('global-break-toast');
    if(!toast || _toastVisible) return;
    _toastVisible = true;
    toast.style.display = '';
    _raf(()=>toast.classList.add('gbt-visible'));

    const elapsedEl = _el('gbt-elapsed');
    if(elapsedEl) {
      const intSecs = _getBreakIntervalSecs();
      elapsedEl.textContent = intSecs>0 ? _fmtTime(intSecs) : 'a while';
    }
  }

  function _hideGlobalToast() {
    const toast = _el('global-break-toast');
    if(!toast || !_toastVisible) return;
    _toastVisible = false;
    toast.classList.remove('gbt-visible');
    setTimeout(()=>{ toast.style.display='none'; }, 400);
  }

  function _setPipBreakDue(active) {
    if (!document.body) return;
    document.body.classList.toggle('pip-break-due', !!active);
    const badge = _el('pip-break-badge');
    if (badge) {
      badge.style.display = active ? 'block' : 'none';
    }
  }

  // ── PiP OS notification ──────────────────────────────────────
  function _tryOsNotification() {
    if (!('Notification' in window)) return;
    const grant = () => {
      new Notification('DeskBuddy — Break Time! ☕', {
        body: `You've been focused for ${_fmtTime(_getBreakIntervalSecs())}. Take a break!`,
        silent: false,
      });
    };
    if (Notification.permission === 'granted') {
      grant();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => { if (p === 'granted') grant(); });
    }
  }

  function _snooze5() {
    _hideGlobalToast();
    _setPipBreakDue(false);
    _snoozeActive = true;
    if (typeof BreakReminder === 'undefined') {
      // BreakReminder unavailable — just cancel the flag after 5 min
      if (_snoozeTimerId) clearTimeout(_snoozeTimerId);
      _snoozeTimerId = setTimeout(() => { _snoozeActive = false; }, 5 * 60 * 1000);
      return;
    }
    if (typeof BreakReminder !== 'undefined') {
      BreakReminder.dismiss();
      // Extend the current break interval by 5 minutes: shift threshold forward
      const currentInterval = BreakReminder.getIntervalMinutes();
      // Store original and set extended interval so break fires 5 min from now
      // BreakReminder.pause() resets elapsed to 0; since we're still ACTIVE,
      // just increase the threshold temporarily
      BreakReminder.setInterval(currentInterval + 5);
      // After 5 min, restore original interval
      if (_snoozeTimerId) clearTimeout(_snoozeTimerId);
      _snoozeTimerId = setTimeout(() => {
        _snoozeActive = false;
        if (typeof BreakReminder !== 'undefined') {
          BreakReminder.setInterval(currentInterval);
        }
      }, 5 * 60 * 1000);
    }
  }

  function _takeBreak() {
    _hideGlobalToast();
    _setPipBreakDue(false);
    if(typeof Session==='undefined'||typeof Timer==='undefined') return;
    const s = Session.getCurrentStats();
    if(s && s.state === 'ACTIVE') {
      Session.pause();
      Timer.pause();
      setTimeout(() => _showBreakTypeChooser('scheduled'), 200);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAK ADJUST ±1m
  // ══════════════════════════════════════════════════════════════

  function _adjustBreak(deltaSecs) {
    if(_breakIsTimed) {
      _breakRemSecs = Math.max(0, _breakRemSecs+deltaSecs);
    } else {
      if(deltaSecs>0) {
        _stopBreakTimer();
        _breakIsTimed = true;
        _breakRemSecs = deltaSecs;
        _updateBreakDisplay();
        _breakTimerId = setInterval(()=>{
          _breakRemSecs=Math.max(0,_breakRemSecs-1);
          _updateBreakDisplay();
          if(_breakRemSecs===0){_stopBreakTimer();_onBreakEnd();}
        },1000);
        return;
      }
    }
    _updateBreakDisplay();
  }

  // ══════════════════════════════════════════════════════════════
  //  HISTORY PANEL — CURRENT WEEK CALENDAR
  // ══════════════════════════════════════════════════════════════

  function _fmtFocusShort(secs) {
    if(secs<60) return `${secs}s`;
    if(secs<3600) return `${Math.floor(secs/60)}m`;
    return `${Math.floor(secs/3600)}h`;
  }

  function _drawWeekCalendar() {
    const container = _el('hp-week-cal');
    if(!container) return;

    let history = [];
    if(typeof Session!=='undefined' && Session.getHistory)
      history = Session.getHistory();

    const DAY_NAMES  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const now        = new Date(); now.setHours(0,0,0,0);
    const todayDow   = (now.getDay()+6)%7;
    const monday     = new Date(now); monday.setDate(now.getDate()-todayDow);
    const sunday     = new Date(monday); sunday.setDate(monday.getDate()+6);

    const dayMap = new Map();
    history.forEach(s => {
      if(!s.date) return;
      const d   = new Date(s.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if(!dayMap.has(key)) dayMap.set(key, {completed:false,attempted:false,focusSecs:0,sessions:0});
      const e = dayMap.get(key);
      if(s.outcome==='COMPLETED')      e.completed=true;
      else if(s.outcome!=='ABANDONED') e.attempted=true;
      e.focusSecs += (s.actualFocusedSeconds||0);
      e.sessions++;
    });

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const rangeLabel = monday.getMonth()===sunday.getMonth()
      ? `${MONTHS[monday.getMonth()]} ${monday.getDate()}–${sunday.getDate()}, ${monday.getFullYear()}`
      : `${MONTHS[monday.getMonth()]} ${monday.getDate()} – ${MONTHS[sunday.getMonth()]} ${sunday.getDate()}`;

    let cells = '';
    for(let i=0;i<7;i++) {
      const d    = new Date(monday); d.setDate(monday.getDate()+i);
      const key  = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const info = dayMap.get(key);
      const isToday  = d.getTime()===now.getTime();
      const isFuture = d > now;

      let cellCls = 'hp-week-cell';
      let tip = isToday ? 'Today' : DAY_NAMES[i];
      if(!isFuture && info?.completed) {
        cellCls += ' hp-week-done';
        tip += ` · ${_fmtFocusShort(info.focusSecs)} focused · ${info.sessions} session${info.sessions!==1?'s':''}`;
      } else if(!isFuture && info?.attempted) {
        cellCls += ' hp-week-tried';
        tip += ' · started session';
      } else if(isFuture) {
        cellCls += ' hp-week-future';
      }
      if(isToday) cellCls += ' hp-week-today';

      const pct  = info ? Math.min(100, Math.round((info.focusSecs/7200)*100)) : 0;
      const bar  = (!isFuture && pct>0)
        ? `<div class="hp-week-bar" style="height:${Math.max(8,pct)}%"></div>` : '';

      cells += `
        <div class="${cellCls}" title="${tip}">
          <div class="hp-week-bar-wrap">${bar}</div>
          <div class="hp-week-day">${DAY_NAMES[i]}</div>
        </div>`;
    }

    container.innerHTML = `
      <span class="hp-week-range-label">${rangeLabel}</span>
      <div class="hp-week-strip">${cells}</div>`;
  }

  // ══════════════════════════════════════════════════════════════
  //  SESSION DETAILS MODAL
  // ══════════════════════════════════════════════════════════════

  function _showDetailsModal(session) {
    const modal  = _el('sp-session-details-modal');
    const body   = _el('sp-det-body');
    const title  = _el('sp-det-title');
    if(!modal||!body||!session) return;

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const d      = session.date ? new Date(session.date) : null;
    const dateS  = d && isFinite(d)
      ? `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`
      : '—';

    const durSecs    = (session.durationMinutes||0)*60;
    const focusSecs  = Math.max(0, session.actualFocusedSeconds||0);
    const focusPct   = durSecs>0 ? Math.min(100, Math.round((focusSecs/durSecs)*100)) : 0;
    const distracts  = session.distractionCount||0;
    const outcome    = String(session.outcome||'ABANDONED');
    const cat        = session.category||'—';
    const goal       = session.goalText||'—';
    const mood       = session.moodRating!=null ? `${session.moodRating}/5` : '—';
    const longest    = session.longestFocusStreakSeconds||0;
    const focusPhases = Array.isArray(session.focusPhases) ? session.focusPhases.filter(n => n > 0) : [];
    const focusPhaseText = focusPhases.length
      ? focusPhases.map((secs, i) => `#${i + 1} ${_fmtFocus(secs)}`).join(' · ')
      : '—';
    const breaks = Array.isArray(session.breaks) ? session.breaks : [];
    const breakDurations = breaks
      .map(b => (typeof b?.durationSecs === 'number' ? Math.max(0, Math.round(b.durationSecs)) : 0))
      .filter(n => n > 0);
    const breakTotalSecs = breakDurations.reduce((sum, n) => sum + n, 0);
    const timingLabels = {
      before_due: 'before due', after_due: 'after due',
      on_time: 'on time',       unscheduled:'no schedule',
    };
    const breakLines = breaks.length
      ? breaks.map((b, i) => {
          const dur = (typeof b?.durationSecs === 'number' && b.durationSecs >= 0)
            ? _fmtFocus(b.durationSecs) : '—';
          const timing = timingLabels[b?.timing] || 'no schedule';
          return `#${i + 1} ${dur} · ${timing}`;
        }).join('<br>')
      : '—';

    const outcomeColor = outcome==='COMPLETED'?'sp-det-good':outcome==='FAILED'?'sp-det-bad':'sp-det-warn';
    const focusColor   = focusPct>=80?'sp-det-good':focusPct>=50?'sp-det-warn':'sp-det-bad';

    if(title) title.textContent = `${dateS}`;

    body.innerHTML = `
      <div class="sp-det-section-head">Overview</div>
      <div class="sp-det-row">
        <div class="sp-det-item"><div class="sp-det-label">duration</div><div class="sp-det-value">${_fmtFocus(durSecs)}</div></div>
        <div class="sp-det-item"><div class="sp-det-label">outcome</div><div class="sp-det-value ${outcomeColor}">${outcome.toLowerCase()}</div></div>
        <div class="sp-det-item"><div class="sp-det-label">focus time</div><div class="sp-det-value ${focusColor}">${_fmtFocus(focusSecs)}</div></div>
        <div class="sp-det-item"><div class="sp-det-label">focus %</div><div class="sp-det-value ${focusColor}">${focusPct}%</div></div>
      </div>
      <div class="sp-det-section-head">Focus Quality</div>
      <div class="sp-det-row">
        <div class="sp-det-item"><div class="sp-det-label">distractions</div><div class="sp-det-value ${distracts===0?'sp-det-good':distracts>4?'sp-det-bad':'sp-det-warn'}">${distracts}</div></div>
        <div class="sp-det-item"><div class="sp-det-label">longest streak</div><div class="sp-det-value">${_fmtFocus(longest)}</div></div>
        <div class="sp-det-item"><div class="sp-det-label">category</div><div class="sp-det-value" style="font-size:12px">${cat}</div></div>
        <div class="sp-det-item"><div class="sp-det-label">mood</div><div class="sp-det-value" style="font-size:12px">${mood}</div></div>
      </div>
      <div class="sp-det-section-head">Focus Phases</div>
      <div class="sp-det-row">
        <div class="sp-det-item sp-det-full"><div class="sp-det-label">focus stretches</div><div class="sp-det-value" style="font-size:12px;font-weight:700">${focusPhaseText}</div></div>
      </div>
      <div class="sp-det-section-head">Breaks</div>
      <div class="sp-det-row">
        <div class="sp-det-item"><div class="sp-det-label">total break time</div><div class="sp-det-value">${breakTotalSecs > 0 ? _fmtFocus(breakTotalSecs) : '—'}</div></div>
        <div class="sp-det-item sp-det-full"><div class="sp-det-label">break timing</div><div class="sp-det-value" style="font-size:12px;font-weight:700;line-height:1.4">${breakLines}</div></div>
      </div>
      ${goal !== '—' ? `
      <div class="sp-det-section-head">Goal</div>
      <div class="sp-det-row">
        <div class="sp-det-item sp-det-full"><div class="sp-det-label">what you were working on</div><div class="sp-det-value" style="font-size:12px;font-weight:700">${goal}</div></div>
        ${session.goalAchieved!=null?`<div class="sp-det-item"><div class="sp-det-label">goal achieved?</div><div class="sp-det-value ${session.goalAchieved?'sp-det-good':'sp-det-bad'}">${session.goalAchieved?'yes ✓':'no ✗'}</div></div>`:''}
      </div>` : ''}
      <div class="sp-det-section-head">Session Date</div>
      <div class="sp-det-row">
        <div class="sp-det-item sp-det-full"><div class="sp-det-label">started at</div><div class="sp-det-value" style="font-size:12px;font-weight:700">${dateS}</div></div>
      </div>
    `;

    modal.style.opacity  = '0';
    modal.style.display  = '';
    modal.style.transition = 'opacity 0.18s ease';
    _raf(() => { modal.style.opacity = '1'; });
  }

  function _hideDetailsModal() {
    const modal = _el('sp-session-details-modal');
    if(!modal) return;
    modal.style.opacity = '0';
    setTimeout(() => { if(modal) modal.style.display = 'none'; }, 180);
  }

  // ══════════════════════════════════════════════════════════════
  //  QUICK FILL CHIPS
  // ══════════════════════════════════════════════════════════════

  function _wireQuickFillChips() {
    const lastChip = _el('sp-qp-last');
    if(lastChip) {
      if(typeof Session!=='undefined') {
        const hist = Session.getHistory();
        if(hist.length>0) {
          const last = hist[0];
          const dur  = (last.durationMinutes||25)*60;
          lastChip.style.display = '';
          lastChip.classList.add('sp-qp-chip--last');
          const h=Math.floor(dur/3600),m=Math.floor((dur%3600)/60),s=dur%60;
          lastChip.dataset.h = h; lastChip.dataset.m = m; lastChip.dataset.s = s;
          lastChip.title = `Repeat last session: ${_fmtFocus(dur)}`;
          if(last.category) lastChip.textContent = `↩ last (${last.category})`;
          else               lastChip.textContent = `↩ last session`;
        }
      }
    }

    document.querySelectorAll('.sp-qp-chip[data-h]').forEach(chip => {
      chip.addEventListener('click', () => {
        const dH=_el('duration-h'), dM=_el('duration-m'), dS=_el('duration-s');
        if(dH) dH.value = chip.dataset.h || 0;
        if(dM) dM.value = chip.dataset.m || 25;
        if(dS) dS.value = chip.dataset.s || 0;

        const bdH=_el('break-dur-h'), bdM=_el('break-dur-m'), bdS=_el('break-dur-s');
        if(bdH) bdH.value = chip.dataset.bh || 0;
        if(bdM) bdM.value = chip.dataset.bm || 5;
        if(bdS) bdS.value = chip.dataset.bs || 0;

        const biH=_el('break-h'), biM=_el('break-m'), biS=_el('break-s');
        if(biH) biH.value = chip.dataset['bi-h'] || 0;
        if(biM) biM.value = chip.dataset['bi-m'] || 25;
        if(biS) biS.value = chip.dataset['bi-s'] || 0;

        const intSecs = parseInt(chip.dataset['bi-h']||0)*3600 +
                        parseInt(chip.dataset['bi-m']||0)*60   +
                        parseInt(chip.dataset['bi-s']||0);
        if(typeof BreakReminder!=='undefined' && intSecs>0)
          BreakReminder.setInterval(intSecs/60);

        document.querySelectorAll('.sp-qp-chip').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  PATCH HISTORY DETAILS
  // ══════════════════════════════════════════════════════════════

  function _patchHistoryDetails() {
    // No-op: HistoryPanel._handleCtxAction handles 'details' via window._showDetailsModal.
    // This stub exists so _init() step 14 call is harmless.
  }

  // ══════════════════════════════════════════════════════════════
  //  SESSION STATE LISTENER
  // ══════════════════════════════════════════════════════════════

  function _onSessionStateChange(newState, oldState) {
    document.body.dataset.sessionState = newState;

    if (newState === 'ACTIVE') {
      if (oldState === 'IDLE') {
        // Fresh session start — read configured durations
        _wallSecs  = 0;
        _totalSecs = _getSessionTotalSecs();
        _segmentSecs = 0;
        _breakIntervalSecs = _getBreakIntervalSecs();
        window._spfWallTimerActive = true;

        // Arm BreakReminder with the break interval (minutes)
        // unless break schedule is disabled
        const schedEnabled = _el('break-schedule-enabled');
        const schedOn = !schedEnabled || schedEnabled.checked;
        if (typeof BreakReminder !== 'undefined') {
          if (schedOn) {
            const intSecs = _getBreakIntervalSecs();
            BreakReminder.setInterval(intSecs > 0 ? intSecs / 60 : 99999);
          } else {
            BreakReminder.setInterval(99999);
          }
        }
      }
      // Start (or resume) wall-clock
      _startWallTimer();
      // Clear buddy override — brain.js takes over in ACTIVE state
      window._spfBuddyTimerOverride = null;
      // Reset state label (Change 10A)
      const _stateLabel = document.querySelector('.sp-ring-state-label');
      if (_stateLabel) _stateLabel.textContent = '';
      _stopBreakTimer();
      _hideGlobalToast();
      _hideBreakOverNotif();
      _setPipBreakDue(false);
      _pipBreakPending = false;
      window._spfPipBreakPending = false;

    } else if (newState === 'PAUSED') {
      // Break started — stop wall-clock, break timer starts separately
      _stopWallTimer();
      // Don't clear buddy override here — break timer will set it

    } else {
      // Terminal: IDLE / COMPLETED / FAILED / ABANDONED
      _stopWallTimer();
      _stopBreakTimer();
      window._spfWallTimerActive = false;
      window._spfBuddyTimerOverride = null;
      _hideGlobalToast();
      _hideBreakOverNotif();
      _setPipBreakDue(false);
      _pipBreakPending = false;
      window._spfPipBreakPending = false;
      _updateIdleStats();
      _drawWeekCalendar();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAK TRIGGER HANDLER (called by BreakReminder.onTrigger)
  // ══════════════════════════════════════════════════════════════

  function _onBreakTrigger() {
    // Skip if break schedule is disabled by user
    const schedEnabled = _el('break-schedule-enabled');
    if (schedEnabled && !schedEnabled.checked) {
      if (typeof BreakReminder !== 'undefined') BreakReminder.dismiss();
      return;
    }

    // Skip break if session is ending at (or very near) the same time
    if (_totalSecs > 0 && (_wallSecs + 2) >= _totalSecs) {
      if (typeof BreakReminder !== 'undefined') BreakReminder.dismiss();
      return; // Session wall-clock will fire COMPLETED
    }

    _setPipBreakDue(true);

    const inPip = document.body.classList.contains('pip-mode');
    if (inPip) {
      // PiP mode — can't show toast, use badge + OS notification
      _pipBreakPending = true;
      window._spfPipBreakPending = true;
      if (typeof Sounds !== 'undefined') Sounds.play('break_start');
      _tryOsNotification();
      if (_el('break-auto-enabled')?.checked) {
        setTimeout(() => { _takeBreak(); }, 1500);
      }
    } else {
      _showGlobalToast();
      if (_el('break-auto-enabled')?.checked) {
        setTimeout(() => { _hideGlobalToast(); _takeBreak(); }, 1500);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════

  function _init() {
    // 1. State init
    if (typeof Session !== 'undefined') {
      Session.onSessionStateChange(_onSessionStateChange);
      const stats = Session.getCurrentStats();
      document.body.dataset.sessionState = stats?.state || 'IDLE';
      _updateIdleStats();
    } else {
      document.body.dataset.sessionState = 'IDLE';
    }

    // 2. Draw week calendar
    _drawWeekCalendar();

    // 3. Global toast buttons
    _el('gbt-snooze-btn')?.addEventListener('click', _snooze5);
    _el('gbt-take-btn')  ?.addEventListener('click', _takeBreak);
    _el('gbt-dismiss-btn')?.addEventListener('click', _hideGlobalToast);

    // 4. BreakReminder → our handler (handles session-total-aware logic)
    if (typeof BreakReminder !== 'undefined') {
      BreakReminder.onTrigger(_onBreakTrigger);

      BreakReminder.onDismiss(() => {
        _setPipBreakDue(false);
        _hideGlobalToast();
      });
    }

    // 5. Break over → resume button
    _el('sp-break-over-resume')?.addEventListener('click', () => {
      _hideBreakOverNotif();
      if (typeof Session !== 'undefined' && typeof Timer !== 'undefined') {
        const s = Session.getCurrentStats();
        if (s && s.state === 'PAUSED') {
          Session.resume();
          Timer.resume();
          _segmentSecs = 0;
          if (typeof BreakReminder !== 'undefined') BreakReminder.resume();
        }
      }
    });

    // Break over → snooze 5 more minutes (extend break countdown)
    _el('sp-break-over-snooze')?.addEventListener('click', () => {
      _hideBreakOverNotif();
      // Add 5 minutes to the break timer
      if (_breakIsTimed) {
        _breakRemSecs += 5 * 60;
        _updateBreakDisplay();
        // Restart countdown if it had stopped
        if (!_breakTimerId) {
          _breakTimerId = setInterval(() => {
            _breakRemSecs = Math.max(0, _breakRemSecs - 1);
            _updateBreakDisplay();
            if (_breakRemSecs === 0) { _stopBreakTimer(); _onBreakEnd(); }
          }, 1000);
        }
      } else {
        // Open-ended: just hide the notification and keep counting up
        _updateBreakDisplay();
      }
    });

    // 6. Break adjust buttons
    _el('sp-break-adj-minus')?.addEventListener('click', ()=>_adjustBreak(-60));
    _el('sp-break-adj-plus') ?.addEventListener('click', ()=>_adjustBreak(+60));

    // 7. break-dur stepper buttons
    _el('break-dur-dec')?.addEventListener('click', ()=>_setBreakDurSecs(_getBreakDurSecs()-60));
    _el('break-dur-inc')?.addEventListener('click', ()=>_setBreakDurSecs(_getBreakDurSecs()+60));

    // 8. Clamp break-dur inputs
    ['break-dur-h','break-dur-m','break-dur-s'].forEach(id=>{
      const el=_el(id); if(!el) return;
      const max=(id==='break-dur-h')?23:59;
      el.addEventListener('change',()=>{ el.value=String(Math.max(0,Math.min(max,parseInt(el.value,10)||0))); });
    });

    // 9. Pause button → show break type chooser AFTER session.js/renderer.js handle state
    const pauseBtn = _el('pause-session');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        setTimeout(_showBreakTypeChooser, 100);
      }, true);
    }

    // 10. Details modal close
    _el('sp-det-close')?.addEventListener('click', _hideDetailsModal);
    _el('sp-session-details-modal')?.querySelector('.sp-details-backdrop')?.addEventListener('click', _hideDetailsModal);
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') _hideDetailsModal(); });

    // 11. Quick fill chips
    _wireQuickFillChips();

    // 12. History panel week calendar refresh
    const histCloseBtn = _el('hp-close-btn');
    if (histCloseBtn) histCloseBtn.addEventListener('click', ()=>setTimeout(_updateIdleStats,100));

    const histPanel = _el('history-panel');
    if (histPanel) {
      new MutationObserver(()=>{
        if (histPanel.classList.contains('sidebar-open') || histPanel.style.display !== 'none')
          _drawWeekCalendar();
      }).observe(histPanel, {attributes:true, attributeFilter:['class','style']});
    }

    // 13. Expose details modal globally
    window._showDetailsModal = _showDetailsModal;

    // 14. Patch history details
    _patchHistoryDetails();

    // 15. PiP break return — show toast when user switches from PiP back to fullscreen
    window.addEventListener('spf-pip-break-return', () => {
      if (_pipBreakPending) {
        _pipBreakPending = false;
        window._spfPipBreakPending = false;
        _setPipBreakDue(false);
        // Show toast after a brief delay so fullscreen UI is visible
        setTimeout(() => {
          const s = typeof Session !== 'undefined' ? Session.getCurrentStats() : null;
          if (s && s.state === 'ACTIVE') {
            _showGlobalToast();
            if (_el('break-auto-enabled')?.checked) {
              setTimeout(() => { _hideGlobalToast(); _takeBreak(); }, 1500);
            }
          }
        }, 350);
      }
    });

    // 16. Session timer mode setting wiring (save/load)
    const modeSelect = _el('session-timer-mode-select');
    if (modeSelect) {
      const saved = (typeof Settings !== 'undefined' && Settings.get)
        ? (Settings.get('sessionTimerMode') || 'breakInterval') : 'breakInterval';
      modeSelect.value = saved;
      modeSelect.addEventListener('change', e => {
        if (typeof Settings !== 'undefined' && Settings.set)
          Settings.set('sessionTimerMode', e.target.value);
      });
    }

    // 17. Break schedule enabled/disabled toggle
    const schedToggle = _el('break-schedule-enabled');
    const schedBody   = _el('sp-break-schedule-body');

    function _applyScheduleToggle(enabled) {
      if (!schedBody) return;
      schedBody.classList.toggle('spf-schedule-disabled', !enabled);
      // When disabled, also clear BreakReminder so no breaks fire
      if (typeof BreakReminder !== 'undefined') {
        if (!enabled) {
          BreakReminder.setInterval(99999); // effectively off
        } else {
          const intSecs = _getBreakIntervalSecs();
          if (intSecs > 0) BreakReminder.setInterval(intSecs / 60);
        }
      }
    }

    if (schedToggle) {
      // Restore from localStorage
      const savedSched = localStorage.getItem('spf-break-schedule-enabled');
      if (savedSched === 'false') { schedToggle.checked = false; _applyScheduleToggle(false); }
      schedToggle.addEventListener('change', e => {
        localStorage.setItem('spf-break-schedule-enabled', String(e.target.checked));
        _applyScheduleToggle(e.target.checked);
      });
    }

    // 18. Individual break-every and break-for row enable/disable toggles (Change 7)
    const breakEveryToggle = _el('break-every-enabled');
    const breakForToggle   = _el('break-for-enabled');
    const breakEveryRow    = _el('sp-break-row');
    const breakForRow      = document.querySelector('#sp-break-schedule-body .sp-row.sp-row-hms:not(#sp-break-row)');

    function _applyBreakEveryToggle(enabled) {
      if (breakEveryRow) {
        breakEveryRow.classList.toggle('spf-row-disabled', !enabled);
        breakEveryRow.querySelectorAll('input, button').forEach(el => {
          if (el !== breakEveryToggle) el.disabled = !enabled;
        });
      }
      if (typeof BreakReminder !== 'undefined') {
        if (!enabled) {
          BreakReminder.setInterval(99999);
        } else {
          const intSecs = _getBreakIntervalSecs();
          if (intSecs > 0) BreakReminder.setInterval(intSecs / 60);
        }
      }
      localStorage.setItem('spf-break-every-enabled', String(enabled));
    }

    function _applyBreakForToggle(enabled) {
      if (breakForRow) {
        breakForRow.classList.toggle('spf-row-disabled', !enabled);
        breakForRow.querySelectorAll('input, button').forEach(el => {
          if (el !== breakForToggle) el.disabled = !enabled;
        });
      }
      // When break-for is OFF: set break-dur to 0 so open-ended mode auto-activates
      if (!enabled) {
        _setBreakDurSecs(0);
      }
      localStorage.setItem('spf-break-for-enabled', String(enabled));
    }

    if (breakEveryToggle) {
      const saved = localStorage.getItem('spf-break-every-enabled');
      if (saved === 'false') { breakEveryToggle.checked = false; _applyBreakEveryToggle(false); }
      breakEveryToggle.addEventListener('change', e => _applyBreakEveryToggle(e.target.checked));
    }

    if (breakForToggle) {
      const saved = localStorage.getItem('spf-break-for-enabled');
      if (saved === 'false') { breakForToggle.checked = false; _applyBreakForToggle(false); }
      breakForToggle.addEventListener('change', e => _applyBreakForToggle(e.target.checked));
    }

    // 19. Break affirmation refresh button (Change 13-js)
    _el('sp-affirmation-refresh')?.addEventListener('click', () => {
      const affEl = _el('sp-break-affirmation');
      if (affEl) {
        affEl.style.opacity = '0';
        setTimeout(() => {
          affEl.textContent = AFFIRMATIONS[Math.floor(Math.random() * AFFIRMATIONS.length)];
          affEl.style.opacity = '1';
        }, 200);
      }
    });

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    setTimeout(_init, 0);
  }

})();
