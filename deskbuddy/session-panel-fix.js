/**
 * session-panel-fix.js  —  Complete session + history panel overhaul
 *
 * Features:
 *  1.  body[data-session-state] drives CSS visibility (fixes all-3-showing bug)
 *  2.  Global break toast — bottom-right of whole window
 *  3.  Break type chooser — timed vs open-ended
 *  4.  Timed break: countdown. Open-ended: countup.
 *  5.  Break adjust ±1m during active break
 *  6.  Snooze 5m from toast
 *  7.  Current-week calendar in history panel
 *  8.  Quick-fill chips (replace useless presets)
 *  9.  Session details modal replaces alert()
 *  10. Correct focus-time format in idle stats
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

  // ══════════════════════════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════════════════════════

  let _breakTimerId       = null;
  let _breakIsTimed       = true;   // true = countdown, false = countup
  let _breakRemSecs       = 0;      // countdown remaining
  let _breakElapsedSecs   = 0;      // countup elapsed
  let _snoozeActive       = false;
  let _snoozeTimerId      = null;
  let _breakStartWallMs   = null;   // wall clock when break began (for history)

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
  //  BREAK DURATION INPUTS
  // ══════════════════════════════════════════════════════════════

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
      // colour: green → yellow → red
      const dur = _getBreakDurSecs();
      const pct = dur > 0 ? _breakRemSecs/dur : 1;
      if      (pct < 0.20) el.style.color = 'rgba(248,113,113,0.90)';
      else if (pct < 0.45) el.style.color = 'rgba(251,191,36,0.90)';
      else                 el.style.color = 'rgba(68,232,176,0.90)';
    } else {
      el.textContent = _fmtTime(_breakElapsedSecs);
      el.style.color = 'rgba(139,118,255,0.80)';
      if(hint) hint.textContent = 'time on break';
    }
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

    // Affirmation
    const affEl = _el('sp-break-affirmation');
    if(affEl) affEl.textContent = AFFIRMATIONS[Math.floor(Math.random()*AFFIRMATIONS.length)];
  }

  function _onBreakEnd() {
    const el = _el('break-countdown');
    if(el) {
      el.style.animation = 'sp-break-done-pulse 0.9s ease-in-out 4';
      setTimeout(()=>{ if(el) el.style.animation=''; }, 3800);
    }
    const notif = _el('sp-break-over-notif');
    if(notif) { notif.style.display=''; _raf(()=>notif.classList.add('sp-notif-visible')); }
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

  function _showBreakTypeChooser() {
    const modal = _el('break-type-modal');
    if (!modal) { _startBreakCountdown(true); return; }

    // Update timed option label with configured duration
    const durSecs = _getBreakDurSecs();
    const durLbl  = _el('btm-timed-dur');
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

    // Auto-close after 15s → default to timed
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

    // Update elapsed label
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

  function _snooze5() {
    _hideGlobalToast();
    _snoozeActive = true;
    if(typeof BreakReminder !== 'undefined') {
      BreakReminder.dismiss();
      BreakReminder.setInterval(5);
    }
    if(_snoozeTimerId) clearTimeout(_snoozeTimerId);
    _snoozeTimerId = setTimeout(()=>{
      _snoozeActive = false;
      const origSecs = _getBreakIntervalSecs();
      if(typeof BreakReminder !== 'undefined' && origSecs > 0)
        BreakReminder.setInterval(origSecs/60);
    }, 5*60*1000);
  }

  function _takeBreak() {
    _hideGlobalToast();
    if(typeof Session==='undefined'||typeof Timer==='undefined') return;
    const s = Session.getCurrentStats();
    if(s && s.state === 'ACTIVE') {
      Session.pause();
      Timer.pause();
      // Small delay then show chooser
      setTimeout(_showBreakTypeChooser, 200);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAK ADJUST ±1m
  // ══════════════════════════════════════════════════════════════

  function _adjustBreak(deltaSecs) {
    if(_breakIsTimed) {
      _breakRemSecs = Math.max(0, _breakRemSecs+deltaSecs);
    } else {
      // Switch to timed countdown from deltaSecs
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
    _setBreakDurSecs(_getBreakDurSecs()+deltaSecs);
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

    // Build day map
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

      // Bar height: cap at 120min = 100%
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

    const outcomeColor = outcome==='COMPLETED'?'sp-det-good':outcome==='FAILED'?'sp-det-bad':'sp-det-warn';
    const focusColor   = focusPct>=80?'sp-det-good':focusPct>=50?'sp-det-warn':'sp-det-bad';

    if(title) title.textContent = `${dateS}`;

    body.innerHTML = `
      <div class="sp-det-section-head">Overview</div>
      <div class="sp-det-row">
        <div class="sp-det-item">
          <div class="sp-det-label">duration</div>
          <div class="sp-det-value">${_fmtFocus(durSecs)}</div>
        </div>
        <div class="sp-det-item">
          <div class="sp-det-label">outcome</div>
          <div class="sp-det-value ${outcomeColor}">${outcome.toLowerCase()}</div>
        </div>
        <div class="sp-det-item">
          <div class="sp-det-label">focus time</div>
          <div class="sp-det-value ${focusColor}">${_fmtFocus(focusSecs)}</div>
        </div>
        <div class="sp-det-item">
          <div class="sp-det-label">focus %</div>
          <div class="sp-det-value ${focusColor}">${focusPct}%</div>
        </div>
      </div>

      <div class="sp-det-section-head">Focus Quality</div>
      <div class="sp-det-row">
        <div class="sp-det-item">
          <div class="sp-det-label">distractions</div>
          <div class="sp-det-value ${distracts===0?'sp-det-good':distracts>4?'sp-det-bad':'sp-det-warn'}">${distracts}</div>
        </div>
        <div class="sp-det-item">
          <div class="sp-det-label">longest streak</div>
          <div class="sp-det-value">${_fmtFocus(longest)}</div>
        </div>
        <div class="sp-det-item">
          <div class="sp-det-label">category</div>
          <div class="sp-det-value" style="font-size:12px">${cat}</div>
        </div>
        <div class="sp-det-item">
          <div class="sp-det-label">mood</div>
          <div class="sp-det-value" style="font-size:12px">${mood}</div>
        </div>
      </div>

      ${goal !== '—' ? `
      <div class="sp-det-section-head">Goal</div>
      <div class="sp-det-row">
        <div class="sp-det-item sp-det-full">
          <div class="sp-det-label">what you were working on</div>
          <div class="sp-det-value" style="font-size:12px;font-weight:700">${goal}</div>
        </div>
        ${session.goalAchieved!=null?`
        <div class="sp-det-item">
          <div class="sp-det-label">goal achieved?</div>
          <div class="sp-det-value ${session.goalAchieved?'sp-det-good':'sp-det-bad'}">${session.goalAchieved?'yes ✓':'no ✗'}</div>
        </div>
        `:''}
      </div>
      ` : ''}

      <div class="sp-det-section-head">Session Date</div>
      <div class="sp-det-row">
        <div class="sp-det-item sp-det-full">
          <div class="sp-det-label">started at</div>
          <div class="sp-det-value" style="font-size:12px;font-weight:700">${dateS}</div>
        </div>
      </div>
    `;

    modal.style.display = '';
    _raf(()=> modal.style.opacity = '1');
  }

  function _hideDetailsModal() {
    const modal = _el('sp-session-details-modal');
    if(!modal) return;
    modal.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════════
  //  QUICK FILL CHIPS
  // ══════════════════════════════════════════════════════════════

  function _wireQuickFillChips() {
    // "Last session" chip
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

    // All chips (preset patterns)
    document.querySelectorAll('.sp-qp-chip[data-h]').forEach(chip => {
      chip.addEventListener('click', () => {
        // Fill duration
        const dH=_el('duration-h'), dM=_el('duration-m'), dS=_el('duration-s');
        if(dH) dH.value = chip.dataset.h || 0;
        if(dM) dM.value = chip.dataset.m || 25;
        if(dS) dS.value = chip.dataset.s || 0;

        // Fill break duration
        const bdH=_el('break-dur-h'), bdM=_el('break-dur-m'), bdS=_el('break-dur-s');
        if(bdH) bdH.value = chip.dataset.bh || 0;
        if(bdM) bdM.value = chip.dataset.bm || 5;
        if(bdS) bdS.value = chip.dataset.bs || 0;

        // Fill break interval
        const biH=_el('break-h'), biM=_el('break-m'), biS=_el('break-s');
        if(biH) biH.value = chip.dataset['bi-h'] || 0;
        if(biM) biM.value = chip.dataset['bi-m'] || 25;
        if(biS) biS.value = chip.dataset['bi-s'] || 0;

        // Sync BreakReminder
        const intSecs = parseInt(chip.dataset['bi-h']||0)*3600 +
                        parseInt(chip.dataset['bi-m']||0)*60   +
                        parseInt(chip.dataset['bi-s']||0);
        if(typeof BreakReminder!=='undefined' && intSecs>0)
          BreakReminder.setInterval(intSecs/60);

        // Active highlight
        document.querySelectorAll('.sp-qp-chip').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  PATCH HISTORY PANEL DETAILS ACTION
  // ══════════════════════════════════════════════════════════════

  function _patchHistoryDetails() {
    // Poll until HistoryPanel is available then monkey-patch it
    const tryPatch = () => {
      if(typeof HistoryPanel !== 'undefined') {
        // We can't directly monkey-patch the private _handleCtxAction because
        // it's in a closure. Instead intercept right-click on session rows.
        document.addEventListener('click', e => {
          const detBtn = e.target.closest('[data-action="details"]');
          if(!detBtn) return;
          // Find the target session from HistoryPanel's internal state
          // by reading the nearest row index
          const ctxMenu = document.getElementById('hp-ctx-menu');
          if(!ctxMenu) return;
          // HistoryPanel exposes refresh/init only, so we intercept differently:
          // We hook into the row right-click to capture the session ourselves
        }, true);
        return;
      }
      setTimeout(tryPatch, 200);
    };
    tryPatch();

    // Better approach: intercept the details button click and show our modal
    // by reading the row's data-idx attribute which is already on the DOM
    document.getElementById('hp-ctx-menu')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="details"]');
      if(!btn) return;
      e.stopPropagation();
      e.preventDefault();
      // Find which session index is highlighted (has sp-selected class or is _ctxTargetIndex)
      const selectedRow = document.querySelector('#hp-recent-list .hp-row.sp-selected, #hp-recent-list .hp-row:hover');
      if(selectedRow) {
        const idx = parseInt(selectedRow.dataset.idx, 10);
        if(typeof Session!=='undefined') {
          const s = Session.getHistory()[idx];
          if(s) { _showDetailsModal(s); return; }
        }
      }
      // Fallback: search all highlighted rows
      const rows = document.querySelectorAll('#hp-recent-list .hp-row');
      rows.forEach(row => {
        if(row.classList.contains('hp-row-selected')) {
          const idx = parseInt(row.dataset.idx,10);
          if(typeof Session!=='undefined'){
            const s=Session.getHistory()[idx];
            if(s) _showDetailsModal(s);
          }
        }
      });
    }, true);
  }

  // ══════════════════════════════════════════════════════════════
  //  SESSION STATE LISTENER
  // ══════════════════════════════════════════════════════════════

  function _onSessionStateChange(newState) {
    document.body.dataset.sessionState = newState;

    if(newState === 'PAUSED') {
      // Don't auto-start break timer here — wait for break type chooser
      // The chooser is shown by _takeBreak() or _wireBreakButton()
    } else if(newState === 'ACTIVE') {
      _stopBreakTimer();
      _hideGlobalToast();
      _hideBreakOverNotif();
    } else {
      _stopBreakTimer();
      _hideGlobalToast();
      _hideBreakOverNotif();
      _updateIdleStats();
      _drawWeekCalendar();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════

  function _init() {
    // 1. State init
    if(typeof Session !== 'undefined') {
      Session.onSessionStateChange(_onSessionStateChange);
      const stats = Session.getCurrentStats();
      document.body.dataset.sessionState = stats?.state || 'IDLE';
      _updateIdleStats();
    } else {
      document.body.dataset.sessionState = 'IDLE';
    }

    // 2. Draw week calendar on init and when history refreshes
    _drawWeekCalendar();

    // 3. Global toast buttons
    _el('gbt-snooze-btn')?.addEventListener('click', _snooze5);
    _el('gbt-take-btn')  ?.addEventListener('click', _takeBreak);
    _el('gbt-dismiss-btn')?.addEventListener('click', _hideGlobalToast);

    // 4. BreakReminder → show toast
    if(typeof BreakReminder !== 'undefined') {
      BreakReminder.onTrigger(() => {
        _showGlobalToast();
        // Auto-start if checkbox enabled
        if(_el('break-auto-enabled')?.checked) {
          setTimeout(() => { _hideGlobalToast(); _takeBreak(); }, 1500);
        }
      });
    }

    // 5. Break over → resume button
    _el('sp-break-over-resume')?.addEventListener('click', () => {
      _hideBreakOverNotif();
      if(typeof Session!=='undefined'&&typeof Timer!=='undefined'){
        const s=Session.getCurrentStats();
        if(s&&s.state==='PAUSED'){ Session.resume(); Timer.resume(); }
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

    // 9. Wire "take a break" button to show chooser first
    // Intercept the pause-session button before renderer's handler
    const pauseBtn = _el('pause-session');
    if(pauseBtn) {
      pauseBtn.addEventListener('click', (e) => {
        // renderer.js also listens; Session.pause() will be called by renderer
        // We just need to show the chooser AFTER the state changes
        setTimeout(_showBreakTypeChooser, 100);
      }, true); // capture phase so we run alongside renderer's bubble handler
    }

    // 10. Details modal close
    _el('sp-det-close')?.addEventListener('click', _hideDetailsModal);
    _el('sp-session-details-modal')?.querySelector('.sp-details-backdrop')?.addEventListener('click', _hideDetailsModal);
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') _hideDetailsModal(); });

    // 11. Quick fill chips
    _wireQuickFillChips();

    // 12. History panel week calendar refresh when panel opens
    const histCloseBtn = _el('hp-close-btn');
    if(histCloseBtn) histCloseBtn.addEventListener('click', ()=>setTimeout(_updateIdleStats,100));

    // Watch for history panel opening (MutationObserver on history-panel)
    const histPanel = _el('history-panel');
    if(histPanel) {
      new MutationObserver(()=>{
        if(histPanel.classList.contains('sidebar-open')||histPanel.style.display!=='none')
          _drawWeekCalendar();
      }).observe(histPanel,{attributes:true,attributeFilter:['class','style']});
    }

    // Expose details modal globally for history-panel.js to call
    window._showDetailsModal = _showDetailsModal;

    // 13. Patch history details
    _patchHistoryDetails();
  }

  if(document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    setTimeout(_init, 0);
  }

})();
