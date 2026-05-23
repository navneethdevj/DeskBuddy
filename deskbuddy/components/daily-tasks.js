/**
 * DailyTasks — Manage daily task tracking to encourage daily usage
 * 
 * Persists completed tasks in localStorage with daily reset.
 * Tasks are checked off when user completes certain actions.
 */
const DailyTasks = (() => {
  const STORAGE_KEY = 'deskbuddy_daily_tasks';
  const DEFAULT_TASKS = [
    { id: 'session-1', label: 'Complete 1 session', target: 1, type: 'sessions' },
    { id: 'focus-25', label: 'Focus for 25 minutes', target: 25, type: 'duration' },
    { id: 'focus-100', label: '100% focus power', target: 100, type: 'focus_score' },
  ];

  let _tasks = [];
  let _lastResetDate = null;

  function _getStoredData() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return data;
    } catch (_) {
      return {};
    }
  }

  function _saveStoredData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {
      // Quota exceeded or localStorage disabled
    }
  }

  function _getTodayString() {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  function _resetIfNewDay() {
    const today = _getTodayString();
    const data = _getStoredData();
    
    if (data.lastDate !== today) {
      // New day — reset all tasks
      _lastResetDate = today;
      _tasks = DEFAULT_TASKS.map(t => ({
        ...t,
        completed: false,
        progress: 0
      }));
      _saveStoredData({ lastDate: today, tasks: _tasks });
    } else {
      // Same day — load existing tasks
      _lastResetDate = data.lastDate;
      _tasks = data.tasks || DEFAULT_TASKS.map(t => ({
        ...t,
        completed: false,
        progress: 0
      }));
    }
  }

  function _updateProgress(type, value) {
    // Update task progress based on session data
    _tasks.forEach(task => {
      if (task.type === 'sessions' && type === 'sessions') {
        task.progress = value;
        if (value >= task.target) task.completed = true;
      } else if (task.type === 'duration' && type === 'duration') {
        task.progress = value;
        if (value >= task.target) task.completed = true;
      } else if (task.type === 'focus_score' && type === 'focus_score') {
        task.progress = value;
        if (value >= task.target) task.completed = true;
      }
    });
    _saveStoredData({ lastDate: _getTodayString(), tasks: _tasks });
  }

  function init() {
    _resetIfNewDay();
  }

  function getTasks() {
    return _tasks;
  }

  function getCompletedCount() {
    return _tasks.filter(t => t.completed).length;
  }

  function getTotalCount() {
    return _tasks.length;
  }

  function updateFromSession(sessionStats) {
    // Called with session stats like { sessions: 2, focusedMinutes: 50, focusScore: 85 }
    if (sessionStats.sessions !== undefined) {
      _updateProgress('sessions', sessionStats.sessions);
    }
    if (sessionStats.focusedMinutes !== undefined) {
      _updateProgress('duration', sessionStats.focusedMinutes);
    }
    if (sessionStats.focusScore !== undefined) {
      _updateProgress('focus_score', sessionStats.focusScore);
    }
  }

  function toggleTask(taskId) {
    const task = _tasks.find(t => t.id === taskId);
    if (task) {
      task.completed = !task.completed;
      _saveStoredData({ lastDate: _getTodayString(), tasks: _tasks });
    }
  }

  return {
    init,
    getTasks,
    getCompletedCount,
    getTotalCount,
    updateFromSession,
    toggleTask
  };
})();

// Auto-init on load if available
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    try { DailyTasks.init(); } catch (_) {}
  });
}
