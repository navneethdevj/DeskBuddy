import { useState, useEffect, useRef, useCallback } from 'react';
import type { TaskDTO } from '@shared/types';
import type { UpdateTaskInput } from '@shared/schemas';
import { Badge } from '@web/components/ui/Badge';
import { Avatar } from '@web/components/ui/Avatar';
import { Button } from '@web/components/ui/Button';

interface TaskDrawerProps {
  task: TaskDTO | null;
  workspaceId: string | null;
  onClose: () => void;
  onUpdate: (workspaceId: string, taskId: string, data: UpdateTaskInput) => Promise<void>;
  onDelete?: (workspaceId: string, taskId: string) => Promise<void>;
}

const STATUS_CONFIG: Record<TaskDTO['status'], { label: string; cls: string; activeCls: string }> = {
  TODO:        { label: 'To Do',       cls: 'text-ink-3 border-border hover:border-border-2',               activeCls: 'bg-surface-3 text-ink border-border-2 font-semibold' },
  IN_PROGRESS: { label: 'In Progress', cls: 'text-ink-3 border-border hover:border-accent/40',              activeCls: 'bg-accent-dim text-accent border-accent/40 font-semibold' },
  DONE:        { label: 'Done',        cls: 'text-ink-3 border-border hover:border-ok/40',                  activeCls: 'bg-ok-muted text-ok border-ok/40 font-semibold' },
};

const PRIORITY_CONFIG: Record<TaskDTO['priority'], { label: string; cls: string; activeCls: string }> = {
  LOW:    { label: 'Low',    cls: 'text-ink-3 border-border hover:border-border-2',  activeCls: 'bg-surface-3 text-ink-2 border-border-2 font-medium' },
  MEDIUM: { label: 'Medium', cls: 'text-ink-3 border-border hover:border-info/40',   activeCls: 'bg-info-muted text-info border-info/40 font-medium' },
  HIGH:   { label: 'High',   cls: 'text-ink-3 border-border hover:border-warn/50',   activeCls: 'bg-warn-muted text-warn border-warn/50 font-medium' },
  URGENT: { label: 'Urgent', cls: 'text-ink-3 border-border hover:border-err/50',    activeCls: 'bg-err-muted text-err border-err/50 font-medium' },
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div className="flex flex-col gap-1.5">
    <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{label}</p>
    {children}
  </div>
);

export const TaskDrawer = ({
  task,
  workspaceId,
  onClose,
  onUpdate,
  onDelete,
}: TaskDrawerProps): JSX.Element | null => {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft]     = useState('');
  const [editingDesc, setEditingDesc]   = useState(false);
  const [descDraft, setDescDraft]       = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const descRef  = useRef<HTMLTextAreaElement>(null);

  // Sync state when task changes
  useEffect(() => {
    setEditingTitle(false);
    setEditingDesc(false);
    setConfirmDelete(false);
  }, [task?.id]);

  // Focus inputs when entering edit mode
  useEffect(() => { if (editingTitle) titleRef.current?.focus(); }, [editingTitle]);
  useEffect(() => { if (editingDesc)  descRef.current?.focus();  }, [editingDesc]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const patch = useCallback(async (data: UpdateTaskInput): Promise<void> => {
    if (!task || !workspaceId) return;
    setSaving(true);
    try { await onUpdate(workspaceId, task.id, data); }
    finally { setSaving(false); }
  }, [task, workspaceId, onUpdate]);

  const saveTitle = useCallback(async (): Promise<void> => {
    setEditingTitle(false);
    if (!titleDraft.trim() || titleDraft.trim() === task?.title) return;
    await patch({ title: titleDraft.trim() });
  }, [titleDraft, task?.title, patch]);

  const saveDesc = useCallback(async (): Promise<void> => {
    setEditingDesc(false);
    if (descDraft === (task?.description ?? '')) return;
    await patch({ description: descDraft || null });
  }, [descDraft, task?.description, patch]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    if (!task || !workspaceId || !onDelete) return;
    await onDelete(workspaceId, task.id);
    onClose();
  }, [confirmDelete, task, workspaceId, onDelete, onClose]);

  if (!task || !workspaceId) return null;

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'DONE';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-bg/50 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-drawer animate-slide-in-right"
        aria-label="Task details"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-4 py-4">
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input
                ref={titleRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                className="w-full bg-transparent text-base font-semibold text-ink outline-none focus:underline focus:decoration-accent"
              />
            ) : (
              <h2
                className="cursor-text text-base font-semibold text-ink hover:text-accent transition-colors line-clamp-2"
                title="Click to edit title"
                onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }}
              >
                {task.title}
              </h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink-2 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Status */}
          <Row label="Status">
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(STATUS_CONFIG) as TaskDTO['status'][]).map((s) => {
                const cfg = STATUS_CONFIG[s];
                const active = task.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void patch({ status: s })}
                    disabled={saving}
                    className={`rounded-lg border px-3 py-1 text-xs transition-all duration-150 ${active ? cfg.activeCls : cfg.cls}`}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </Row>

          {/* Priority */}
          <Row label="Priority">
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(PRIORITY_CONFIG) as TaskDTO['priority'][]).map((p) => {
                const cfg = PRIORITY_CONFIG[p];
                const active = task.priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void patch({ priority: p })}
                    disabled={saving}
                    className={`rounded-lg border px-3 py-1 text-xs transition-all duration-150 ${active ? cfg.activeCls : cfg.cls}`}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </Row>

          {/* Description */}
          <Row label="Description">
            {editingDesc ? (
              <textarea
                ref={descRef}
                rows={4}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={() => void saveDesc()}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingDesc(false); }}
                placeholder="Add a description…"
                className="w-full resize-none rounded-lg border border-accent/40 bg-surface-2 p-2.5 text-sm text-ink placeholder:text-ink-4 outline-none"
              />
            ) : (
              <div
                className="cursor-text rounded-lg border border-border bg-surface-2 p-2.5 text-sm transition-colors hover:border-border-2"
                onClick={() => { setDescDraft(task.description ?? ''); setEditingDesc(true); }}
              >
                {task.description
                  ? <p className="whitespace-pre-wrap text-ink-2">{task.description}</p>
                  : <p className="text-ink-4 italic">Add a description…</p>
                }
              </div>
            )}
          </Row>

          {/* Due date */}
          {task.dueDate && (
            <Row label="Due date">
              <p className={`text-sm font-medium ${isOverdue ? 'text-err' : 'text-ink-2'}`}>
                {isOverdue && '⚠ '}
                {new Date(task.dueDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </Row>
          )}

          {/* Assignee */}
          {task.assignee && (
            <Row label="Assignee">
              <div className="flex items-center gap-2">
                <Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size="sm" />
                <span className="text-sm text-ink-2">{task.assignee.name}</span>
              </div>
            </Row>
          )}

          {/* Labels */}
          {task.labels?.length > 0 && (
            <Row label="Labels">
              <div className="flex flex-wrap gap-1.5">
                {task.labels.map((lbl) => (
                  <span
                    key={lbl.id}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: `${lbl.color}20`, color: lbl.color, border: `1px solid ${lbl.color}30` }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lbl.color }} />
                    {lbl.name}
                  </span>
                ))}
              </div>
            </Row>
          )}

          {/* Timestamps */}
          <div className="border-t border-border pt-4 space-y-1">
            <p className="text-[11px] text-ink-4">Created {new Date(task.createdAt).toLocaleString()}</p>
            <p className="text-[11px] text-ink-4">Updated {new Date(task.updatedAt).toLocaleString()}</p>
          </div>
        </div>

        {/* Footer */}
        {onDelete && (
          <div className="border-t border-border p-4">
            {confirmDelete ? (
              <div className="flex items-center gap-2 animate-scale-in">
                <p className="flex-1 text-xs text-err">Delete this task?</p>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="rounded-lg bg-err px-3 py-1.5 text-xs font-semibold text-ink hover:bg-red-500 transition-colors"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-ink-3 hover:bg-surface-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-ink-3 transition-colors hover:bg-err-muted hover:text-err"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M1 3h10M4 3V2h4v1M2 3l.5 7h7L10 3M5 5.5v3M7 5.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                Delete task
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
};
