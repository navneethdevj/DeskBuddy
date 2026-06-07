import { useState, useMemo, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useDroppable,
  closestCorners, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskDTO } from '@shared/types';
import type { TaskStatus } from '@shared/constants';
import { TaskCard } from './TaskCard';

interface KanbanBoardProps {
  tasks: TaskDTO[];
  isLoading: boolean;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onTaskClick: (task: TaskDTO) => void;
  onCreateTask: (status: TaskStatus, title: string) => void;
  workspaceId: string | null;
  filterText?: string;
  filterPriority?: TaskDTO['priority'] | null;
  sortBy?: 'created' | 'priority' | 'due';
}

const PRIORITY_ORDER: Record<TaskDTO['priority'], number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const COLUMNS: Array<{
  status: TaskStatus;
  label: string;
  emptyMessage: string;
  headerClass: string;
  bodyClass: string;
  borderClass: string;
}> = [
  {
    status: 'TODO',
    label: 'To Do',
    emptyMessage: 'Nothing queued yet',
    headerClass: 'text-ink-2',
    bodyClass:   'bg-surface/60',
    borderClass: 'border-border',
  },
  {
    status: 'IN_PROGRESS',
    label: 'In Progress',
    emptyMessage: 'Nothing in motion',
    headerClass: 'text-accent',
    bodyClass:   'bg-accent/[0.03]',
    borderClass: 'border-accent/20',
  },
  {
    status: 'DONE',
    label: 'Done',
    emptyMessage: 'Completed tasks appear here',
    headerClass: 'text-ok',
    bodyClass:   'bg-ok/[0.03]',
    borderClass: 'border-ok/20',
  },
];

// ── Tiny column status icons ──────────────────────────────────────────────────
const ColumnIcon = ({ status }: { status: TaskStatus }): JSX.Element => {
  if (status === 'TODO') return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3.5 2.5"/>
    </svg>
  );
  if (status === 'IN_PROGRESS') return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M6.5 1a5.5 5.5 0 0 1 0 11" fill="currentColor" fillOpacity="0.25"/>
    </svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M4 6.5l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// ── Droppable column container ────────────────────────────────────────────────
const DroppableArea = ({
  id, children, className,
}: { id: string; children: React.ReactNode; className?: string }): JSX.Element => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={[
        className,
        isOver ? 'ring-1 ring-accent/30' : '',
        'transition-all duration-100',
      ].join(' ')}
    >
      {children}
    </div>
  );
};

// ── Sortable task card wrapper ────────────────────────────────────────────────
const SortableTaskCard = memo(({
  task, onTaskClick, index,
}: { task: TaskDTO; onTaskClick: (t: TaskDTO) => void; index: number }): JSX.Element => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} onTaskClick={onTaskClick} index={index} />
    </div>
  );
});

SortableTaskCard.displayName = 'SortableTaskCard';

// ── Inline add task form ──────────────────────────────────────────────────────
const AddTaskInline = ({
  status, onAdd,
}: { status: TaskStatus; onAdd: (status: TaskStatus, title: string) => void }): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const submit = useCallback((): void => {
    if (!value.trim()) { setOpen(false); return; }
    onAdd(status, value.trim());
    setValue('');
    setOpen(false);
  }, [value, status, onAdd]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-ink-4 transition-colors hover:bg-surface-hover hover:text-ink-3"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        Add task
      </button>
    );
  }

  return (
    <div className="mt-1 rounded-xl border border-accent/40 bg-surface-2 p-2.5 animate-scale-in">
      <textarea
        ref={inputRef}
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { setValue(''); setOpen(false); }
        }}
        placeholder="Task title… Enter to add"
        className="w-full resize-none bg-transparent text-sm text-ink placeholder:text-ink-4 outline-none"
      />
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-bg transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => { setValue(''); setOpen(false); }}
          className="rounded-lg px-2 py-1 text-xs text-ink-3 hover:bg-surface-3 transition-colors"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-ink-4 hidden sm:inline">Shift+Enter for newline</span>
      </div>
    </div>
  );
};

// We need these imports at the top (fixing missing React imports for memo/useRef/useEffect)
import { memo, useRef, useEffect } from 'react';

// ── Main Board ────────────────────────────────────────────────────────────────
export const KanbanBoard = ({
  tasks,
  isLoading,
  onStatusChange,
  onTaskClick,
  onCreateTask,
  filterText = '',
  filterPriority = null,
  sortBy = 'created',
}: KanbanBoardProps): JSX.Element => {
  const [activeTask, setActiveTask] = useState<TaskDTO | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Filter + sort (memoised for perf)
  const processed = useMemo((): TaskDTO[] => {
    const q = filterText.trim().toLowerCase();
    let result = tasks;
    if (q) result = result.filter((t) =>
      t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
    );
    if (filterPriority) result = result.filter((t) => t.priority === filterPriority);

    return [...result].sort((a, b) => {
      if (sortBy === 'priority') return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (sortBy === 'due') {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [tasks, filterText, filterPriority, sortBy]);

  const totalTasks = tasks.length;
  const doneTasks  = tasks.filter((t) => t.status === 'DONE').length;
  const donePercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const handleDragStart = useCallback((e: DragStartEvent): void => {
    const task = tasks.find((t) => t.id === e.active.id);
    if (task) setActiveTask(task);
  }, [tasks]);

  const handleDragEnd = useCallback((e: DragEndEvent): void => {
    setActiveTask(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const dragged = tasks.find((t) => t.id === active.id);
    if (!dragged) return;
    const targetStatus =
      COLUMNS.find((c) => c.status === over.id)?.status ??
      tasks.find((t) => t.id === over.id)?.status;
    if (targetStatus && targetStatus !== dragged.status) {
      onStatusChange(dragged.id, targetStatus as TaskStatus);
    }
  }, [tasks, onStatusChange]);

  const isFiltering = Boolean(filterText.trim() || filterPriority);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* Progress bar */}
      {totalTasks > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-ok transition-all duration-700"
              style={{ width: `${donePercent}%` }}
            />
          </div>
          <span className="shrink-0 text-xs text-ink-3">{doneTasks}/{totalTasks} done</span>
        </div>
      )}

      {isFiltering && processed.length === 0 && (
        <p className="mb-3 text-xs text-ink-3">No tasks match your filters.</p>
      )}

      {/* Board — horizontal scroll snap on mobile, grid on md+ */}
      <div
        className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory md:grid md:grid-cols-3 md:overflow-x-visible md:snap-none"
        role="region"
        aria-label="Kanban board"
      >
        {COLUMNS.map(({ status, label, emptyMessage, headerClass, bodyClass, borderClass }) => {
          const colTasks = processed.filter((t) => t.status === status);
          const overdueInCol = colTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date()).length;
          const rawCount = tasks.filter((t) => t.status === status).length;

          return (
            <div
              key={status}
              className="flex w-[83vw] min-w-[260px] shrink-0 snap-start flex-col gap-2 md:w-auto md:min-w-0"
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-1">
                <span className={`flex items-center gap-1.5 ${headerClass}`}>
                  <ColumnIcon status={status} />
                  <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
                </span>
                <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-3">
                  {rawCount}
                </span>
                {overdueInCol > 0 && (
                  <span className="rounded-full bg-err-muted px-2 py-0.5 text-xs font-medium text-err">
                    {overdueInCol} late
                  </span>
                )}
              </div>

              {/* Progress bar on DONE column */}
              {status === 'DONE' && totalTasks > 0 && (
                <div className="px-1">
                  <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-ok/60 rounded-full transition-all duration-700" style={{ width: `${donePercent}%` }} />
                  </div>
                </div>
              )}

              <SortableContext items={colTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <DroppableArea
                  id={status}
                  className={`flex min-h-28 flex-col gap-2 rounded-2xl border p-2.5 ${bodyClass} ${borderClass}`}
                >
                  {isLoading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="skeleton h-20" />
                    ))
                  ) : colTasks.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8">
                      <span className={`opacity-30 ${headerClass}`}>
                        <ColumnIcon status={status} />
                      </span>
                      <p className="text-center text-xs text-ink-4">{emptyMessage}</p>
                    </div>
                  ) : (
                    colTasks.map((task, i) => (
                      <SortableTaskCard key={task.id} task={task} onTaskClick={onTaskClick} index={i} />
                    ))
                  )}
                  <AddTaskInline status={status} onAdd={onCreateTask} />
                </DroppableArea>
              </SortableContext>
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} onTaskClick={() => undefined} /> : null}
      </DragOverlay>
    </DndContext>
  );
};
