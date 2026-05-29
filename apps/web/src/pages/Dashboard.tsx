import { useState, useEffect, useRef } from 'react';
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

const XP_LEVELS = [
  { level: 1, title: 'Seedling', minXP: 0 },
  { level: 2, title: 'Sprout', minXP: 100 },
  { level: 3, title: 'Focused', minXP: 300 },
  { level: 4, title: 'Flow State', minXP: 700 },
  { level: 5, title: 'Deep Worker', minXP: 1500 },
  { level: 6, title: 'Legend', minXP: 3000 },
];

const getLevelFromXP = (xp: number) =>
  [...XP_LEVELS].reverse().find((l) => xp >= l.minXP) ?? XP_LEVELS[0]!;

export default function Dashboard(): JSX.Element {
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, isLoading: wsLoading, setActive, createWorkspace } = useWorkspace();
  const { tasks, isLoading: tasksLoading, createTask, updateTask, error: taskError, clearError: clearTaskError } = useTask(activeWorkspace?.id ?? null);
  const { notes, isLoading: notesLoading, createNote, updateNote, deleteNote, error: noteError, clearError: clearNoteError } = useNote(activeWorkspace?.id ?? null);
  const { onlineUsers } = usePresence(activeWorkspace?.id ?? null);
  const { user, clearAuth } = useAuthStore();

  const [tab, setTab] = useState<'tasks' | 'notes'>('tasks');
  const [selectedTask, setSelectedTask] = useState<TaskDTO | null>(null);

  // Note modals
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [editingNote, setEditingNote] = useState<NoteDTO | null>(null);
  const [editNoteTitle, setEditNoteTitle] = useState('');
  const [editNoteContent, setEditNoteContent] = useState('');

  // Quick Capture Ctrl+K
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureValue, setQuickCaptureValue] = useState('');
  const quickCaptureRef = useRef<HTMLInputElement>(null);

  // Gamification
  const [stats, setStats] = useState<UserStatsDTO | null>(null);
  const [missions, setMissions] = useState<DailyMissionDTO[]>([]);
  const [showMissions, setShowMissions] = useState(false);

  // Keep drawer in sync when task updates via socket
  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find((t) => t.id === selectedTask.id);
      if (updated) setSelectedTask(updated);
    }
  }, [tasks]);

  useEffect(() => {
    if (!user) return;
    api.get<UserStatsDTO>('/stats/me').then(({ data }) => setStats(data)).catch(() => null);
    api.get<DailyMissionDTO[]>('/missions/today').then(({ data }) => setMissions(data)).catch(() => null);
  }, [user]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setQuickCaptureOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && quickCaptureOpen) {
        setQuickCaptureOpen(false);
        setQuickCaptureValue('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [quickCaptureOpen]);

  useEffect(() => {
    if (quickCaptureOpen) quickCaptureRef.current?.focus();
  }, [quickCaptureOpen]);

  const handleStatusChange = (taskId: string, status: TaskStatus): void => {
    if (!activeWorkspace) return;
    void updateTask(activeWorkspace.id, taskId, { status });
  };

  const handleCreateTask = (status: TaskStatus, title: string): void => {
    if (!activeWorkspace || !title.trim()) return;
    void createTask(activeWorkspace.id, { title: title.trim(), status });
  };

  const handleQuickCapture = (): void => {
    if (!activeWorkspace || !quickCaptureValue.trim()) return;
    void createTask(activeWorkspace.id, { title: quickCaptureValue.trim(), status: 'TODO' });
    setQuickCaptureValue('');
    setQuickCaptureOpen(false);
  };

  const handleCreateNote = async (): Promise<void> => {
    if (!noteTitle.trim()) return;
    await createNote({ title: noteTitle.trim(), content: noteContent });
    setNoteTitle('');
    setNoteContent('');
    setNewNoteOpen(false);
  };

  const handleSaveEditNote = async (): Promise<void> => {
    if (!editingNote || !editNoteTitle.trim()) return;
    await updateNote(editingNote.id, { title: editNoteTitle.trim(), content: editNoteContent });
    setEditingNote(null);
  };

  const handleOpenEditNote = (note: NoteDTO): void => {
    setEditingNote(note);
    setEditNoteTitle(note.title);
    setEditNoteContent(note.content);
  };

  const handleLogout = async (): Promise<void> => {
    try { await api.post('/auth/logout'); } finally {
      clearAuth();
      void navigate('/login');
    }
  };

  const level = stats ? getLevelFromXP(stats.totalXP) : XP_LEVELS[0]!;
  const nextLevel = XP_LEVELS.find((l) => l.level === level.level + 1);
  const xpInLevel = stats ? stats.totalXP - level.minXP : 0;
  const xpNeeded = nextLevel ? nextLevel.minXP - level.minXP : 1;
  const xpPercent = Math.min(100, Math.round((xpInLevel / xpNeeded) * 100));

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 gap-3">
        <span className="text-base font-bold text-blue-700 shrink-0">DeskBuddy</span>

        {/* Quick Capture */}
        <div className="flex-1 max-w-sm">
          {quickCaptureOpen ? (
            <div className="flex items-center gap-2 rounded-lg border border-blue-400 bg-blue-50 px-3 py-1.5 shadow-sm">
              <span className="text-blue-400 text-sm">📝</span>
              <input
                ref={quickCaptureRef}
                value={quickCaptureValue}
                onChange={(e) => setQuickCaptureValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleQuickCapture();
                  if (e.key === 'Escape') { setQuickCaptureOpen(false); setQuickCaptureValue(''); }
                }}
                placeholder={activeWorkspace ? `Add to "${activeWorkspace.name}" To Do…` : 'Select a workspace first'}
                className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder-blue-300"
                disabled={!activeWorkspace}
              />
              <kbd className="text-xs text-blue-300 hidden sm:inline">Enter</kbd>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setQuickCaptureOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors w-full"
            >
              <span>📝</span>
              <span>Quick capture</span>
              <kbd className="ml-auto text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-400 hidden sm:inline">⌘K</kbd>
            </button>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 shrink-0">
          {stats && stats.currentStreak > 0 && (
            <div className="flex items-center gap-1 text-sm font-semibold text-orange-500 cursor-default" title={`${stats.currentStreak}-day streak! Longest: ${stats.longestStreak}`}>
              <span>🔥</span><span>{stats.currentStreak}</span>
            </div>
          )}

          {stats && (
            <button
              type="button"
              onClick={() => setShowMissions((p) => !p)}
              className="flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors"
              title={`${stats.totalXP} XP`}
            >
              <span>{level.title}</span>
              <div className="w-12 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${xpPercent}%` }} />
              </div>
            </button>
          )}

          {onlineUsers.length > 0 && (
            <div className="flex -space-x-2" aria-label="Online collaborators">
              {onlineUsers.slice(0, 5).map((u) => (
                <Avatar key={u.userId} name={u.name} src={u.avatarUrl} size="sm" />
              ))}
              {onlineUsers.length > 5 && (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-700 ring-2 ring-white">
                  +{onlineUsers.length - 5}
                </span>
              )}
            </div>
          )}

          {user && <Avatar name={user.name} src={user.avatarUrl} size="sm" />}
          <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>Sign out</Button>
        </div>
      </header>

      {/* Missions dropdown */}
      {showMissions && missions.length > 0 && (
        <div className="absolute top-14 right-4 z-20 w-72 rounded-xl border border-gray-200 bg-white shadow-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-800">Today's Missions</p>
            <button type="button" onClick={() => setShowMissions(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
          <div className="space-y-3">
            {missions.map((m) => (
              <div key={m.id}>
                <div className="flex items-center justify-between mb-1">
                  <p className={`text-xs font-medium ${m.completed ? 'text-green-600 line-through' : 'text-gray-700'}`}>
                    {m.completed ? '✓ ' : ''}{m.label}
                  </p>
                  <span className="text-xs text-gray-400">+{m.xpReward} XP</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${m.completed ? 'bg-green-400' : 'bg-blue-400'}`}
                    style={{ width: `${Math.round((m.progress / m.target) * 100)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-right text-xs text-gray-400">{m.progress}/{m.target}</p>
              </div>
            ))}
          </div>
          {stats && <p className="mt-3 text-xs text-center text-gray-400">{stats.totalXP} XP total</p>}
        </div>
      )}

      <div className="flex min-h-0 flex-1 relative">
        <WorkspaceNav
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace?.id ?? null}
          onSelect={setActive}
          isLoading={wsLoading}
          onCreateWorkspace={createWorkspace}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
          {!activeWorkspace ? (
            <div className="flex flex-1 items-center justify-center flex-col gap-3">
              <p className="text-gray-400 text-sm">
                {wsLoading ? 'Loading workspaces…' : 'Select or create a workspace to get started.'}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">{activeWorkspace.name}</h1>
                <div className="flex gap-2">
                  <Button variant={tab === 'tasks' ? 'primary' : 'ghost'} size="sm" onClick={() => setTab('tasks')}>
                    Tasks
                    {tasks.length > 0 && <span className="ml-1.5 rounded-full bg-white/30 px-1.5 text-xs">{tasks.length}</span>}
                  </Button>
                  <Button variant={tab === 'notes' ? 'primary' : 'ghost'} size="sm" onClick={() => setTab('notes')}>
                    Notes
                    {notes.length > 0 && <span className="ml-1.5 rounded-full bg-white/30 px-1.5 text-xs">{notes.length}</span>}
                  </Button>
                </div>
              </div>

              {tab === 'tasks' && (
                <KanbanBoard
                  tasks={tasks}
                  isLoading={tasksLoading}
                  onStatusChange={handleStatusChange}
                  onTaskClick={setSelectedTask}
                  onCreateTask={handleCreateTask}
                  workspaceId={activeWorkspace.id}
                />
              )}

              {tab === 'notes' && (
                <div className="flex flex-col gap-3">
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => setNewNoteOpen(true)}>+ New note</Button>
                  </div>

                  {notesLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-16 animate-pulse rounded-lg bg-white shadow-sm" />
                      ))}
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="py-12 text-center text-gray-400 text-sm">No notes yet. Create the first one!</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {notes.map((note) => (
                        <li
                          key={note.id}
                          onClick={() => handleOpenEditNote(note)}
                          className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-blue-200 transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate text-sm">{note.title}</p>
                              {note.content && (
                                <p className="mt-1 text-xs text-gray-500 line-clamp-2">{note.content}</p>
                              )}
                              <p className="mt-1 text-xs text-gray-400">{new Date(note.updatedAt).toLocaleDateString()}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 text-red-400 hover:text-red-600"
                              onClick={(e) => { e.stopPropagation(); void deleteNote(note.id); }}
                              aria-label={`Delete note ${note.title}`}
                            >
                              ✕
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <TaskDrawer
        task={selectedTask}
        workspaceId={activeWorkspace?.id ?? null}
        onClose={() => setSelectedTask(null)}
        onUpdate={updateTask}
      />

      {/* New note modal */}
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
          <div className="flex flex-col gap-1">
            <label htmlFor="note-content" className="text-sm font-medium text-gray-700">Content</label>
            <textarea id="note-content" rows={4} placeholder="Write something…" value={noteContent} onChange={(e) => setNoteContent(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </Modal>

      {/* Edit note modal */}
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
          <div className="flex flex-col gap-1">
            <label htmlFor="edit-note-content" className="text-sm font-medium text-gray-700">Content</label>
            <textarea id="edit-note-content" rows={6} value={editNoteContent} onChange={(e) => setEditNoteContent(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </Modal>

      {taskError && <Toast message={taskError} type="error" onDismiss={clearTaskError} />}
      {noteError && <Toast message={noteError} type="error" onDismiss={clearNoteError} />}
    </div>
  );
}
