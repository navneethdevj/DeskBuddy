/**
 * HistoryStats — pure data utilities for the session history panel.
 * All functions are stateless — pass in the history array, get back numbers.
 * No DOM access. No module dependencies except formatting helpers.
 */
const HistoryStats = (() => {

  // ── Format helpers ────────────────────────────────────────────────────────

  function formatFocusTime(totalMs) {
    const totalMins = Math.floor(totalMs / 60000);
    if (totalMins <= 0) return '0m';
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function getFocusedMs(sessions) {
    return sessions.reduce((s, h) => s + (h.actualFocusedSeconds || 0) * 1000, 0);
  }

  // ── Period filtering ─────────────────────────────────────────────────────

  function getSessionsForToday(history) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return history.filter(s => s.date && new Date(s.date) >= start);
  }

  function getSessionsForWeek(history) {
    const now = new Date();
    const start = new Date(now);
    const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon
    start.setDate(now.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
    return history.filter(s => s.date && new Date(s.date) >= start);
  }

  function getSessionsForMonth(history) {
    const start = new Date();
    start.setDate(1); start.setHours(0, 0, 0, 0);
    return history.filter(s => s.date && new Date(s.date) >= start);
  }

  /** Returns the average focus score (0–100) for completed sessions, or null if none. */
  function getAvgFocusScore(sessions) {
    const completed = sessions.filter(s => s.outcome === 'COMPLETED');
    if (!completed.length) return null;
    const sum = completed.reduce((acc, s) => {
      const total   = (s.durationMinutes || 0) * 60;
      const focused = s.actualFocusedSeconds || 0;
      return acc + (total > 0 ? (focused / total) * 100 : 0);
    }, 0);
    return Math.round(sum / completed.length);
  }

  // ── Bar chart data builders ───────────────────────────────────────────────

  /** Last N days. Returns array of { label, focusedMs, sessionCount, isToday }. */
  function buildDailyBars(history, days) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const bars = [];
    for (let i = days - 1; i >= 0; i--) {
      const d    = new Date(today); d.setDate(today.getDate() - i);
      const dEnd = new Date(d);     dEnd.setHours(23, 59, 59, 999);
      const slice = history.filter(s => {
        if (!s.date) return false;
        const t = new Date(s.date).getTime();
        return t >= d.getTime() && t <= dEnd.getTime();
      });
      bars.push({ label: d, focusedMs: getFocusedMs(slice), sessionCount: slice.length, isToday: i === 0 });
    }
    return bars;
  }

  /** Last N calendar weeks (Mon–Sun). */
  function buildWeeklyBars(history, weeks) {
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7;
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - dayOfWeek);
    thisWeekStart.setHours(0, 0, 0, 0);
    const bars = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = new Date(thisWeekStart); ws.setDate(thisWeekStart.getDate() - i * 7);
      const we = new Date(ws);            we.setDate(ws.getDate() + 6); we.setHours(23, 59, 59, 999);
      const slice = history.filter(s => {
        if (!s.date) return false;
        const t = new Date(s.date).getTime();
        return t >= ws.getTime() && t <= we.getTime();
      });
      bars.push({ label: ws, focusedMs: getFocusedMs(slice), sessionCount: slice.length, isCurrent: i === 0 });
    }
    return bars;
  }

  /** Last N calendar months. */
  function buildMonthlyBars(history, months) {
    const now = new Date();
    const bars = [];
    for (let i = months - 1; i >= 0; i--) {
      const ms = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const me = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const slice = history.filter(s => {
        if (!s.date) return false;
        const t = new Date(s.date).getTime();
        return t >= ms.getTime() && t <= me.getTime();
      });
      bars.push({ label: ms, focusedMs: getFocusedMs(slice), sessionCount: slice.length, isCurrent: i === 0 });
    }
    return bars;
  }

  /** All history grouped by month (for lifetime view). */
  function buildLifetimeBars(history) {
    if (!history.length) return [];
    const oldest = new Date(history[history.length - 1].date);
    const now    = new Date();
    const months = (now.getFullYear() - oldest.getFullYear()) * 12 +
                   (now.getMonth()    - oldest.getMonth()) + 1;
    return buildMonthlyBars(history, Math.max(1, Math.min(months, 60)));
  }

  // ── Calendar data ─────────────────────────────────────────────────────────

  /**
   * buildCalendarData(history, weeks) — returns a Map from dateString → { count, hasCompleted }
   * Used by the streak calendar canvas renderer.
   */
  function buildCalendarData(history, weeks) {
    const map = new Map();
    history.forEach(s => {
      if (!s.date) return;
      const d   = new Date(s.date);
      const key = d.toDateString();
      if (!map.has(key)) map.set(key, { count: 0, hasCompleted: false });
      const entry = map.get(key);
      entry.count++;
      if (s.outcome === 'COMPLETED') entry.hasCompleted = true;
    });
    return map;
  }

  // ── Personal-best helpers ─────────────────────────────────────────────────

  /** Returns the highest total focused ms achieved in any single calendar day. */
  function getMaxDayFocusMs(history) {
    const byDay = {};
    history.forEach(s => {
      if (!s.date) return;
      const d = new Date(s.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      byDay[key] = (byDay[key] || 0) + (s.actualFocusedSeconds || 0) * 1000;
    });
    const vals = Object.values(byDay);
    return vals.length ? Math.max(...vals) : 0;
  }

  /** Returns the highest total focused ms achieved in any single calendar week (Mon–Sun). */
  function getMaxWeekFocusMs(history) {
    const byWeek = {};
    history.forEach(s => {
      if (!s.date) return;
      const d   = new Date(s.date);
      const dow = (d.getDay() + 6) % 7;
      const mon = new Date(d);
      mon.setDate(d.getDate() - dow);
      mon.setHours(0, 0, 0, 0);
      const key = mon.getTime();
      byWeek[key] = (byWeek[key] || 0) + (s.actualFocusedSeconds || 0) * 1000;
    });
    const vals = Object.values(byWeek);
    return vals.length ? Math.max(...vals) : 0;
  }

  /** Returns the highest total focused ms achieved in any single calendar month. */
  function getMaxMonthFocusMs(history) {
    const byMonth = {};
    history.forEach(s => {
      if (!s.date) return;
      const d   = new Date(s.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      byMonth[key] = (byMonth[key] || 0) + (s.actualFocusedSeconds || 0) * 1000;
    });
    const vals = Object.values(byMonth);
    return vals.length ? Math.max(...vals) : 0;
  }

  return {
    formatFocusTime,
    getFocusedMs,
    getAvgFocusScore,
    getSessionsForToday,
    getSessionsForWeek,
    getSessionsForMonth,
    buildDailyBars,
    buildWeeklyBars,
    buildMonthlyBars,
    buildLifetimeBars,
    buildCalendarData,
    getMaxDayFocusMs,
    getMaxWeekFocusMs,
    getMaxMonthFocusMs,
  };

})();
