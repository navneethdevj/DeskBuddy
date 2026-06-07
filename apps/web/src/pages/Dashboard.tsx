import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '@web/hooks/useWorkspace';
import { useTask } from '@web/hooks/useTask';
import { useNote } from '@web/hooks/useNote';
import { usePresence } from '@web/hooks/usePresence';
import { useAuthStore } from '@web/stores/authStore';
import { KanbanBoard } from '@web/components/features/KanbanBoard';
import { WorkspaceNav } from '@web/components/features/WorkspaceNav';
import { TaskDrawer } from '@web/components/features/TaskDrawer';
import { Avatar } from '@web/components/ui/Avatar';
import { Button } from '@web/components/ui/Button';
import { Modal } from '@web/components/ui/Modal';
import { Input } from '@web/components/ui/Input';
import { Toast } from '@web/components/ui/Toast';
import api from '@web/lib/api';
import type { TaskDTO, NoteDTO, UserStatsDTO, DailyMissionDTO } from '@shared/types';
import type { TaskStatus } from '@shared/constants';

// ── XP level system ───────────────────────────────────────────────────────────
const XP_LEVELS = [
  { level: 1, title: 'Seedling',    minXP: 0    },
  { level: 2, title: 'Sprout',      minXP: 100  },
  { level: 3, title: 'Focused',     minXP: 300  },
  { level: 4, title: 'Flow State',  minXP: 700  },
  { level: 5, title: 'Deep Worker', minXP: 1500 },
  { level: 6, title: 'Legend',      minXP: 3000 },
];
const getLevelFromXP = (xp: number) =>
  [...XP_LEVELS].reverse().find((l) => xp >= l.minXP) ?? XP_LEVELS[0]!;

// ── Small internal components ─────────────────────────────────────────────────
const HamburgerIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 4h12M2 8h12M2 12h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const SearchIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

const FocusIcon = ({ active }: { active: boolean }): JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.4"
      fill={active ? 'currentColor' : 'none'} fillOpacity="0.15"/>
    <rect x="4" y="4" width="6" height="6" rx="1" fill="currentColor" opacity={active ? '1' : '0.4'}/>
  </svg>
);

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard(): JSX.Element {
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, isLoading: wsLoading, setActive, createWorkspace } = useWorkspace();
  const { tasks, isLoading: tasksLoading, createTask, updateTask, deleteTask, error: taskError, clearError: clearTaskError } = useTask(activeWorkspace?.id ?? null);
  const { notes, isLoading: notesLoading, createNote, updateNote, deleteNote, error: noteError, clearError: clearNoteError } = useNote(activeWorkspace?.id ?? null);
  const { onlineUsers } = usePresence(activeWorkspace?.id ?? null);
  const { user, clearAuth } = useAuthStore();

  // Navigation
  const [tab, setTab]           = useState<'tasks' | 'notes'>('tasks');
  const [navOpen, setNavOpen]   = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  // Task state
  const [selectedTask, setSelectedTask] = useState<TaskDTO | null>(null);

  // Filters
  const [filterText, setFilterText]         = useState('');
  const [filterPriority, setFilterPriority] = useState<TaskDTO['priority'] | null>(null);
  const [sortBy, setSortBy]                 = useState<'created' | 'priority' | 'due'>('created');

  // Note modals
  const [newNoteOpen, setNewNoteOpen]   = useState(false);
  const [noteTitle, setNoteTitle]       = useState('');
  const [noteContent, setNoteContent]   = useState('');
  const [editingNote, setEditingNote]   = useState<NoteDTO | null>(null);
  const [editNoteTitle, setEditNoteTitle]     = useState('');
  const [editNoteContent, setEditNoteContent] = useState('');

  // Quick Capture (Cmd/Ctrl+K)
  const [qcOpen, setQcOpen]   = useState(false);
  const [qcValue, setQcValue] = useState('');
  const qcRef = useRef<HTMLInputElement>(null);

  // Gamification
  const [stats, setStats]         = useState<UserStatsDTO | null>(null);
  const [missions, setMissions]   = useState<DailyMissionDTO[]>([]);
  const [showMissions, setShowMissions] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const overdueCount = useMemo(() =>
    tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE').length,
    [tasks]
  );
  const dueTodayCount = useMemo(() =>
    tasks.filter((t) => {
      if (!t.dueDate || t.status === 'DONE') return false;
      return new Date(t.dueDate).toDateString() === new Date().toDateString();
    }).length,
    [tasks]
  );
  const hasActiveFilters = Boolean(filterText.trim() || filterPriority);

  // ── Effects ───────────────────────────────────────────────────────────────
  // Keep drawer in sync when task updates via socket
  useEffect(() => {
    if (!selectedTask) return;
    const updated = tasks.find((t) => t.id === selectedTask.id);
    if (updated) setSelectedTask(updated);
  }, [tasks, selectedTask]);

  // Reset filters when workspace changes
  useEffect(() => {
    setFilterText('');
    setFilterPriority(null);
    setSortBy('created');
    setSelectedTask(null);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!user) return;
    api.get<UserStatsDTO>('/stats/me').then(({ data }) => setStats(data)).catch(() => null);
    api.get<DailyMissionDTO[]>('/missions/today').then(({ data }) => setMissions(data)).catch(() => null);
  }, [user]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setQcOpen((p) => !p);
      }
      if (e.key === 'Escape' && qcOpen) { setQcOpen(false); setQcValue(''); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [qcOpen]);

  useEffect(() => { if (qcOpen) qcRef.current?.focus(); }, [qcOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleStatusChange = useCallback((taskId: string, status: TaskStatus): void => {
    if (!activeWorkspace) return;
    void updateTask(activeWorkspace.id, taskId, { status });
  }, [activeWorkspace, updateTask]);

  const handleCreateTask = useCallback((status: TaskStatus, title: string): void => {
    if (!activeWorkspace || !title.trim()) return;
    void createTask(activeWorkspace.id, { title: title.trim(), status, priority: 'MEDIUM' });
  }, [activeWorkspace, createTask]);

  const handleQuickCapture = useCallback((): void => {
    if (!activeWorkspace || !qcValue.trim()) return;
    void createTask(activeWorkspace.id, { title: qcValue.trim(), status: 'TODO', priority: 'MEDIUM' });
    setQcValue('');
    setQcOpen(false);
  }, [activeWorkspace, qcValue, createTask]);

  const handleCreateNote = useCallback(async (): Promise<void> => {
    if (!noteTitle.trim()) return;
    await createNote({ title: noteTitle.trim(), content: noteContent });
    setNoteTitle(''); setNoteContent(''); setNewNoteOpen(false);
  }, [noteTitle, noteContent, createNote]);

  const handleSaveEditNote = useCallback(async (): Promise<void> => {
    if (!editingNote || !editNoteTitle.trim()) return;
    await updateNote(editingNote.id, { title: editNoteTitle.trim(), content: editNoteContent });
    setEditingNote(null);
  }, [editingNote, editNoteTitle, editNoteContent, updateNote]);

  const handleOpenEditNote = useCallback((note: NoteDTO): void => {
    setEditingNote(note);
    setEditNoteTitle(note.title);
    setEditNoteContent(note.content);
  }, []);

  const handleLogout = useCallback(async (): Promise<void> => {
    try { await api.post('/auth/logout'); } finally {
      clearAuth();
      void navigate('/login');
    }
  }, [clearAuth, navigate]);

  const clearFilters = useCallback((): void => {
    setFilterText('');
    setFilterPriority(null);
  }, []);

  // ── XP ────────────────────────────────────────────────────────────────────
  const level      = stats ? getLevelFromXP(stats.totalXP) : XP_LEVELS[0]!;
  const nextLevel  = XP_LEVELS.find((l) => l.level === level.level + 1);
  const xpInLevel  = stats ? stats.totalXP - level.minXP : 0;
  const xpNeeded   = nextLevel ? nextLevel.minXP - level.minXP : 1;
  const xpPercent  = Math.min(100, Math.round((xpInLevel / xpNeeded) * 100));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-bg">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      {!focusMode && (
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink-2 transition-colors md:hidden"
            aria-label="Open navigation"
          >
            <HamburgerIcon />
          </button>

          {/* Logo */}
          <span
            className="shrink-0 text-lg font-extrabold text-ink tracking-tight"
            style={{ fontFamily: '"Bricolage Grotesque", system-ui, sans-serif' }}
          >
            DeskBuddy
          </span>

          {/* Quick Capture */}
          <div className="flex-1 max-w-xs hidden sm:block">
            {qcOpen ? (
              <div className="flex items-center gap-2 rounded-xl border border-accent/50 bg-accent-dim px-3 py-1.5">
                <span className="text-accent text-xs" aria-hidden="true">+</span>
                <input
                  ref={qcRef}
                  value={qcValue}
                  onChange={(e) => setQcValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleQuickCapture();
                    if (e.key === 'Escape') { setQcOpen(false); setQcValue(''); }
                  }}
                  placeholder={activeWorkspace ? `Add to "${activeWorkspace.name}"…` : 'Select a workspace first'}
                  disabled={!activeWorkspace}
                  className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none"
                />
                <kbd className="hidden text-[10px] text-accent/60 sm:inline">Enter</kbd>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setQcOpen(true)}
                className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm text-ink-3 transition-all hover:border-border-2 hover:text-ink-2"
              >
                <span className="text-xs" aria-hidden="true">+</span>
                <span>Quick capture</span>
                <kbd className="ml-auto hidden rounded-md border border-border px-1.5 py-0.5 text-[10px] text-ink-4 sm:inline">⌘K</kbd>
              </button>
            )}
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">

            {/* Urgent/overdue alerts */}
            {overdueCount > 0 && (
              <button
                type="button"
                onClick={() => { setFilterPriority(null); setTab('tasks'); }}
                className="hidden sm:flex items-center gap-1 rounded-lg bg-err-muted px-2 py-1 text-xs font-semibold text-err hover:bg-err/20 transition-colors"
                title="Filter to overdue tasks"
              >
                ⚠ {overdueCount}
              </button>
            )}
            {dueTodayCount > 0 && overdueCount === 0 && (
              <span className="hidden sm:inline text-xs font-medium text-warn">⏰ {dueTodayCount} today</span>
            )}

            {/* Streak */}
            {stats && stats.currentStreak > 0 && (
              <div
                className="hidden sm:flex items-center gap-1 rounded-lg bg-warn-muted px-2 py-1 text-xs font-bold text-warn cursor-default"
                title={`${stats.currentStreak}-day streak! Longest: ${stats.longestStreak}`}
              >
                🔥 {stats.currentStreak}
              </div>
            )}

            {/* XP / Level */}
            {stats && (
              <button
                type="button"
                onClick={() => setShowMissions((p) => !p)}
                className="hidden sm:flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-2.5 py-1 text-xs hover:border-border-2 transition-colors"
                title={`${stats.totalXP} XP total`}
              >
                <span className="font-medium text-ink-2">{level.title}</span>
                <div className="w-14 h-1 rounded-full bg-surface-3 overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${xpPercent}%` }} />
                </div>
              </button>
            )}

            {/* Presence avatars */}
            {onlineUsers.length > 0 && (
              <div className="hidden sm:flex -space-x-1.5" aria-label="Online users">
                {onlineUsers.slice(0, 4).map((u) => (
                  <Avatar key={u.userId} name={u.name} src={u.avatarUrl} size="xs" />
                ))}
                {onlineUsers.length > 4 && (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-[10px] font-medium text-ink-2 ring-1 ring-border">
                    +{onlineUsers.length - 4}
                  </span>
                )}
              </div>
            )}

            {user && <Avatar name={user.name} src={user.avatarUrl} size="sm" />}

            <Button variant="ghost" size="sm" onClick={() => void handleLogout()} className="hidden sm:flex text-xs">
              Sign out
            </Button>
          </div>
        </header>
      )}

      {/* ── Missions dropdown ────────────────────────────────────────────── */}
      {showMissions && missions.length > 0 && (
        <div className="absolute right-4 top-14 z-20 w-72 rounded-2xl border border-border bg-surface p-4 shadow-modal animate-scale-in">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Daily Missions</p>
            <button type="button" onClick={() => setShowMissions(false)} className="text-ink-3 hover:text-ink-2 transition-colors text-sm">✕</button>
          </div>
          <div className="space-y-3">
            {missions.map((m) => (
              <div key={m.id}>
                <div className="mb-1 flex items-center justify-between">
                  <p className={`text-xs font-medium ${m.completed ? 'text-ok line-through' : 'text-ink-2'}`}>
                    {m.completed && <span className="mr-1">✓</span>}{m.label}
                  </p>
                  <span className="text-xs text-accent font-semibold">+{m.xpReward} XP</span>
                </div>
                <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${m.completed ? 'bg-ok' : 'bg-accent'}`}
                    style={{ width: `${Math.round((m.progress / m.target) * 100)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-right text-[10px] text-ink-3">{m.progress}/{m.target}</p>
              </div>
            ))}
          </div>
          {stats && <p className="mt-3 text-center text-xs text-ink-3">{stats.totalXP} XP total</p>}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar (desktop persistent, mobile overlay via WorkspaceNav) */}
        <WorkspaceNav
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace?.id ?? null}
          onSelect={setActive}
          isLoading={wsLoading}
          onCreateWorkspace={createWorkspace}
          isMobileOpen={navOpen}
          onMobileClose={() => setNavOpen(false)}
        />

        {/* Main content */}
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          {!activeWorkspace ? (
            /* Empty state */
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="rounded-2xl border border-border bg-surface p-8 max-w-sm w-full animate-slide-up">
                <div className="mb-4 text-4xl opacity-40" aria-hidden="true">⬡</div>
                <h2 className="mb-2 text-sm font-semibold text-ink">
                  {wsLoading ? 'Loading…' : 'Pick a workspace'}
                </h2>
                <p className="text-xs text-ink-3">
                  {wsLoading ? 'Fetching your workspaces' : 'Select one from the sidebar or create a new one to start tracking tasks.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0 p-4 sm:p-6">

              {/* Workspace header */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h1
                  className="text-xl font-semibold text-ink"
                  style={{ fontFamily: '"Bricolage Grotesque", system-ui, sans-serif' }}
                >
                  {activeWorkspace.name}
                </h1>

                {/* Urgency indicators */}
                {overdueCount > 0 && (
                  <span className="rounded-full bg-err-muted px-2 py-0.5 text-xs font-semibold text-err">
                    ⚠ {overdueCount} overdue
                  </span>
                )}
                {dueTodayCount > 0 && (
                  <span className="rounded-full bg-warn-muted px-2 py-0.5 text-xs font-medium text-warn">
                    ⏰ {dueTodayCount} due today
                  </span>
                )}

                {/* Tab switcher */}
                <div className="ml-auto flex items-center gap-1 rounded-xl border border-border bg-surface-2 p-0.5">
                  {(['tasks', 'notes'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={[
                        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150',
                        tab === t
                          ? 'bg-surface text-ink shadow-card'
                          : 'text-ink-3 hover:text-ink-2',
                      ].join(' ')}
                    >
                      {t === 'tasks' ? 'Tasks' : 'Notes'}
                      {t === 'tasks' && tasks.length > 0 && (
                        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-3">
                          {tasks.length}
                        </span>
                      )}
                      {t === 'notes' && notes.length > 0 && (
                        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-3">
                          {notes.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Focus mode */}
                <button
                  type="button"
                  onClick={() => setFocusMode((p) => !p)}
                  className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition-colors ${focusMode ? 'border-accent/40 text-accent bg-accent-dim' : 'border-border text-ink-3 hover:border-border-2 hover:text-ink-2'}`}
                  title="Focus mode — hides header and sidebar"
                >
                  <FocusIcon active={focusMode} />
                  <span className="hidden sm:inline">Focus</span>
                </button>
              </div>

              {/* ── Task panel ────────────────────────────────────────── */}
              {tab === 'tasks' && (
                <>
                  {/* Filter bar */}
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {/* Search */}
                    <div className="relative min-w-0 flex-1 max-w-56">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none">
                        <SearchIcon />
                      </span>
                      <input
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        placeholder="Search tasks…"
                        className="w-full rounded-xl border border-border bg-surface-2 pl-8 pr-8 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:border-border-2 focus:outline-none transition-colors"
                      />
                      {filterText && (
                        <button
                          type="button"
                          onClick={() => setFilterText('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2 transition-colors text-sm"
                          aria-label="Clear search"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Priority filter */}
                    <select
                      value={filterPriority ?? ''}
                      onChange={(e) => setFilterPriority((e.target.value as TaskDTO['priority']) || null)}
                      className="rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm text-ink-2 focus:border-border-2 focus:outline-none cursor-pointer transition-colors appearance-none"
                      aria-label="Filter by priority"
                    >
                      <option value="">All priorities</option>
                      <option value="URGENT">🔴 Urgent</option>
                      <option value="HIGH">🟠 High</option>
                      <option value="MEDIUM">🟡 Medium</option>
                      <option value="LOW">⚪ Low</option>
                    </select>

                    {/* Sort */}
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                      className="rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm text-ink-2 focus:border-border-2 focus:outline-none cursor-pointer transition-colors appearance-none"
                      aria-label="Sort tasks"
                    >
                      <option value="created">Newest first</option>
                      <option value="priority">By priority</option>
                      <option value="due">By due date</option>
                    </select>

                    {/* Clear filters */}
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="text-xs font-medium text-accent hover:text-accent-hover transition-colors underline-offset-2 hover:underline"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>

                  <KanbanBoard
                    tasks={tasks}
                    isLoading={tasksLoading}
                    onStatusChange={handleStatusChange}
                    onTaskClick={setSelectedTask}
                    onCreateTask={handleCreateTask}
                    workspaceId={activeWorkspace.id}
                    filterText={filterText}
                    filterPriority={filterPriority}
                    sortBy={sortBy}
                  />
                </>
              )}

              {/* ── Notes panel ───────────────────────────────────────── */}
              {tab === 'notes' && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-ink-3">
                      {notes.length > 0 ? `${notes.length} note${notes.length !== 1 ? 's' : ''}` : ''}
                    </p>
                    <Button size="sm" onClick={() => setNewNoteOpen(true)}>+ New note</Button>
                  </div>

                  {notesLoading ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="skeleton h-28 rounded-2xl" />
                      ))}
                    </div>
                  ) : notes.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-center animate-slide-up">
                      <span className="text-3xl opacity-20" aria-hidden="true">◈</span>
                      <p className="text-sm text-ink-3">No notes yet.</p>
                      <Button size="sm" onClick={() => setNewNoteOpen(true)}>Write your first note</Button>
                    </div>
                  ) : (
                    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {notes.map((note, i) => (
                        <li
                          key={note.id}
                          className="group relative cursor-pointer rounded-2xl border border-border bg-surface-2 p-4 transition-all hover:border-border-2 hover:bg-surface-3 animate-slide-up"
                          style={{ animationDelay: `${i * 40}ms` }}
                          onClick={() => handleOpenEditNote(note)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleOpenEditNote(note); }}
                          role="button"
                          tabIndex={0}
                          aria-label={`Open note: ${note.title}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm text-ink truncate">{note.title}</p>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void deleteNote(note.id); }}
                              className="shrink-0 rounded-lg p-1 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-err-muted hover:text-err"
                              aria-label={`Delete ${note.title}`}
                            >
                              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                                <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                              </svg>
                            </button>
                          </div>
                          {note.content && (
                            <p className="mt-2 text-xs text-ink-3 line-clamp-3 leading-relaxed">{note.content}</p>
                          )}
                          <div className="mt-3 flex items-center justify-between">
                            <p className="text-[10px] text-ink-4">
                              {new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </p>
                            {note.content && (
                              <p className="text-[10px] text-ink-4">{note.content.length} chars</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

            </div>
          )}
        </main>
      </div>

      {/* Focus mode exit button */}
      {focusMode && (
        <button
          type="button"
          onClick={() => setFocusMode(false)}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-ink-2 shadow-card-lg hover:border-border-2 hover:text-ink transition-colors animate-fade-in"
        >
          <FocusIcon active={true} />
          Exit focus
        </button>
      )}

      {/* Task drawer */}
      <TaskDrawer
        task={selectedTask}
        workspaceId={activeWorkspace?.id ?? null}
        onClose={() => setSelectedTask(null)}
        onUpdate={updateTask}
        onDelete={deleteTask}
      />

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <Modal
        isOpen={newNoteOpen}
        onClose={() => setNewNoteOpen(false)}
        title="New note"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setNewNoteOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void handleCreateNote()}>Create</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input id="note-title" label="Title" placeholder="Note title" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} autoFocus />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="note-content" className="text-sm font-medium text-ink-2">Content</label>
            <textarea
              id="note-content"
              rows={5}
              placeholder="Write something…"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-4 focus:border-border-2 focus:outline-none transition-colors resize-none"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={editingNote !== null}
        onClose={() => setEditingNote(null)}
        title="Edit note"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditingNote(null)}>Cancel</Button>
            <Button size="sm" onClick={() => void handleSaveEditNote()}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input id="edit-note-title" label="Title" value={editNoteTitle} onChange={(e) => setEditNoteTitle(e.target.value)} autoFocus />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-note-content" className="text-sm font-medium text-ink-2">Content</label>
            <textarea
              id="edit-note-content"
              rows={8}
              value={editNoteContent}
              onChange={(e) => setEditNoteContent(e.target.value)}
              className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-4 focus:border-border-2 focus:outline-none transition-colors resize-none"
            />
          </div>
        </div>
      </Modal>

      {taskError && <Toast message={taskError} type="error" onDismiss={clearTaskError} />}
      {noteError  && <Toast message={noteError}  type="error" onDismiss={clearNoteError}  />}
    </div>
  );
}
