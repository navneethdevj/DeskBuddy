import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '@web/hooks/useWorkspace';
import { useTask } from '@web/hooks/useTask';
import { useNote } from '@web/hooks/useNote';
import { usePresence } from '@web/hooks/usePresence';
import { useAuthStore } from '@web/stores/authStore';
import { KanbanBoard } from '@web/components/features/KanbanBoard';
import { WorkspaceNav } from '@web/components/features/WorkspaceNav';
import { Avatar } from '@web/components/ui/Avatar';
import { Button } from '@web/components/ui/Button';
import { Modal } from '@web/components/ui/Modal';
import { Input } from '@web/components/ui/Input';
import api from '@web/lib/api';
import type { TaskStatus } from '@shared/constants';

// Default export allowed for page-level components
export default function Dashboard(): JSX.Element {
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, isLoading: wsLoading, setActive } = useWorkspace();
  const { tasks, isLoading: tasksLoading, updateTask } = useTask(activeWorkspace?.id ?? null);
  const { notes, isLoading: notesLoading, createNote, deleteNote } = useNote(activeWorkspace?.id ?? null);
  const { onlineUsers } = usePresence(activeWorkspace?.id ?? null);
  const { user, clearAuth } = useAuthStore();

  const [tab, setTab] = useState<'tasks' | 'notes'>('tasks');
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');

  const handleStatusChange = (taskId: string, status: TaskStatus): void => {
    if (!activeWorkspace) return;
    void updateTask(activeWorkspace.id, taskId, { status });
  };

  const handleCreateNote = async (): Promise<void> => {
    if (!noteTitle.trim()) return;
    await createNote({ title: noteTitle.trim(), content: noteContent });
    setNoteTitle('');
    setNoteContent('');
    setNewNoteOpen(false);
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearAuth();
      void navigate('/login');
    }
  };

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
        <span className="text-lg font-bold text-blue-700">DeskBuddy</span>

        <div className="flex items-center gap-3">
          {/* Online users presence */}
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
          <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Workspace sidebar */}
        <WorkspaceNav
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace?.id ?? null}
          onSelect={setActive}
          isLoading={wsLoading}
        />

        {/* Main content */}
        <main className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
          {!activeWorkspace ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-gray-400">
                {wsLoading ? 'Loading workspaces…' : 'Select a workspace to get started.'}
              </p>
            </div>
          ) : (
            <>
              {/* Workspace title + tab bar */}
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">{activeWorkspace.name}</h1>

                <div className="flex gap-2">
                  <Button
                    variant={tab === 'tasks' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setTab('tasks')}
                  >
                    Tasks
                  </Button>
                  <Button
                    variant={tab === 'notes' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setTab('notes')}
                  >
                    Notes
                    {notes.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-white/30 px-1.5 text-xs">
                        {notes.length}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {tab === 'tasks' && (
                <KanbanBoard
                  tasks={tasks}
                  isLoading={tasksLoading}
                  onStatusChange={handleStatusChange}
                />
              )}

              {tab === 'notes' && (
                <div className="flex flex-col gap-3">
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => setNewNoteOpen(true)}>
                      + New note
                    </Button>
                  </div>

                  {notesLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-16 animate-pulse rounded-lg bg-white shadow-sm"
                        />
                      ))}
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="py-12 text-center text-gray-400">
                      No notes yet. Create the first one!
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {notes.map((note) => (
                        <li
                          key={note.id}
                          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">{note.title}</p>
                              {note.content && (
                                <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                                  {note.content}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 text-red-500 hover:text-red-700"
                              onClick={() => void deleteNote(note.id)}
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

      {/* New note modal */}
      <Modal
        isOpen={newNoteOpen}
        onClose={() => setNewNoteOpen(false)}
        title="New note"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setNewNoteOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleCreateNote()}>
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            id="note-title"
            label="Title"
            placeholder="Note title"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="note-content" className="text-sm font-medium text-gray-700">
              Content
            </label>
            <textarea
              id="note-content"
              rows={4}
              placeholder="Write something…"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
