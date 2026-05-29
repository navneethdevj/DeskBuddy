import { useState, useRef, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
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
}

const COLUMNS: Array<{ status: TaskStatus; label: string; emptyMessage: string }> = [
  { status: 'TODO', label: 'To Do', emptyMessage: 'Drop tasks here or add one below' },
  { status: 'IN_PROGRESS', label: 'In Progress', emptyMessage: 'Nothing in progress yet' },
  { status: 'DONE', label: 'Done', emptyMessage: 'Completed tasks appear here' },
];

const AddTaskInline = ({
  status,
  onAdd,
}: {
  status: TaskStatus;
  onAdd: (status: TaskStatus, title: string) => void;
}): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSubmit = (): void => {
    if (!value.trim()) { setIsOpen(false); return; }
    onAdd(status, value.trim());
    setValue('');
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    if (e.key === 'Escape') { setValue(''); setIsOpen(false); }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="mt-1 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
      >
        <span className="text-base leading-none">+</span>
        <span>Add task</span>
      </button>
    );
  }

  return (
    <div className="mt-1 rounded-lg border border-blue-300 bg-white p-2 shadow-sm">
      <textarea
        ref={inputRef}
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Task title… (Enter to add, Esc to cancel)"
        className="w-full resize-none text-sm text-gray-800 placeholder-gray-400 outline-none"
      />
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => { setValue(''); setIsOpen(false); }}
          className="rounded-md px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

const SortableTaskCard = ({
  task,
  onTaskClick,
}: {
  task: TaskDTO;
  onTaskClick: (task: TaskDTO) => void;
}): JSX.Element => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onTaskClick={onTaskClick} />
    </div>
  );
};

export const KanbanBoard = ({
  tasks,
  isLoading,
  onStatusChange,
  onTaskClick,
  onCreateTask,
}: KanbanBoardProps): JSX.Element => {
  const [activeTask, setActiveTask] = useState<TaskDTO | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragStart = (event: DragStartEvent): void => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedTask = tasks.find((t) => t.id === active.id);
    if (!draggedTask) return;

    const targetStatus =
      COLUMNS.find((c) => c.status === over.id)?.status ??
      tasks.find((t) => t.id === over.id)?.status;

    if (targetStatus && targetStatus !== draggedTask.status) {
      onStatusChange(draggedTask.id, targetStatus as TaskStatus);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-3 gap-4" role="region" aria-label="Kanban board">
        {COLUMNS.map(({ status, label, emptyMessage }) => {
          const columnTasks = tasks.filter((t) => t.status === status);
          const todayCount = columnTasks.filter((t) => {
            const updated = new Date(t.updatedAt);
            return updated.toDateString() === new Date().toDateString();
          }).length;

          return (
            <div key={status} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</h3>
                <div className="flex items-center gap-1">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {columnTasks.length}
                  </span>
                  {todayCount > 0 && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-600 font-medium">
                      +{todayCount} today
                    </span>
                  )}
                </div>
              </div>

              <SortableContext
                items={columnTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  id={status}
                  className="flex min-h-24 flex-col gap-2 rounded-xl bg-gray-50 p-2"
                >
                  {isLoading
                    ? Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="h-20 animate-pulse rounded-lg bg-white shadow-sm" />
                      ))
                    : columnTasks.length === 0
                    ? <p className="py-6 text-center text-xs text-gray-300">{emptyMessage}</p>
                    : columnTasks.map((task) => (
                        <SortableTaskCard key={task.id} task={task} onTaskClick={onTaskClick} />
                      ))}

                  <AddTaskInline status={status} onAdd={onCreateTask} />
                </div>
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
