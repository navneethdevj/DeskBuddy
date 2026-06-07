import { memo } from 'react';
import type { TaskDTO } from '@shared/types';
import { Badge } from '@web/components/ui/Badge';
import { Avatar } from '@web/components/ui/Avatar';

interface TaskCardProps {
  task: TaskDTO;
  onTaskClick: (task: TaskDTO) => void;
  isLoading?: boolean;
  index?: number;
}

const STATUS_VARIANT = {
  TODO:        'gray',
  IN_PROGRESS: 'yellow',
  DONE:        'green',
} as const;

const STATUS_LABEL = {
  TODO:        'To Do',
  IN_PROGRESS: 'In Progress',
  DONE:        'Done',
} as const;

const PRIORITY_BAR: Record<TaskDTO['priority'], string> = {
  LOW:    'bg-ink-4',
  MEDIUM: 'bg-info/50',
  HIGH:   'bg-warn',
  URGENT: 'bg-err',
};

const PRIORITY_LABEL: Record<TaskDTO['priority'], string> = {
  LOW:    '',
  MEDIUM: '',
  HIGH:   '!',
  URGENT: '!!',
};

const getAgingClass = (updatedAt: string, status: string): string | null => {
  if (status === 'DONE') return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
  if (days >= 7) return 'bg-err/70';
  if (days >= 3) return 'bg-warn/70';
  return null;
};

/** Skeleton */
const TaskCardSkeleton = (): JSX.Element => (
  <div className="rounded-xl border border-border bg-surface-2 p-3" aria-busy="true">
    <div className="skeleton mb-2.5 h-4 w-3/4" />
    <div className="skeleton h-3 w-1/2" />
  </div>
);

const TaskCardInner = ({ task, onTaskClick, isLoading = false, index = 0 }: TaskCardProps): JSX.Element => {
  if (isLoading) return <TaskCardSkeleton />;

  const priorityBar  = PRIORITY_BAR[task.priority] ?? 'bg-ink-4';
  const priorityText = PRIORITY_LABEL[task.priority] ?? '';
  const agingClass   = getAgingClass(task.updatedAt, task.status);
  const isOverdue    = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'DONE';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}`}
      onClick={() => onTaskClick(task)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick(task); } }}
      className="group cursor-pointer rounded-xl border border-border bg-surface-2 p-3 shadow-card transition-all duration-150 hover:border-border-2 hover:bg-surface-3 hover:shadow-card-lg select-none animate-slide-up"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <div className="flex gap-2.5">
        {/* Priority bar */}
        <div className={`w-0.5 shrink-0 self-stretch rounded-full ${priorityBar}`} aria-hidden="true" />

        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-start gap-1.5">
            <p className="flex-1 text-sm font-medium text-ink line-clamp-2 leading-snug">{task.title}</p>
            <div className="flex shrink-0 items-center gap-1">
              {priorityText && (
                <span className={`text-xs font-bold ${task.priority === 'URGENT' ? 'text-err' : 'text-warn'}`}>
                  {priorityText}
                </span>
              )}
              {agingClass && (
                <span className={`h-2 w-2 rounded-full ${agingClass}`} title="Stale task" aria-label="Task hasn't been updated recently" />
              )}
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <p className="mt-1 text-xs text-ink-3 line-clamp-1">{task.description}</p>
          )}

          {/* Due date */}
          {task.dueDate && (
            <p className={`mt-1 text-xs font-medium ${isOverdue ? 'text-err' : 'text-ink-3'}`}>
              {isOverdue ? '⚠ Overdue · ' : 'Due '}
              {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </p>
          )}

          {/* Footer */}
          <div className="mt-2.5 flex items-center justify-between">
            <Badge
              label={STATUS_LABEL[task.status]}
              variant={STATUS_VARIANT[task.status]}
            />
            <div className="flex items-center gap-1.5">
              {task.labels?.slice(0, 2).map((lbl) => (
                <span
                  key={lbl.id}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: lbl.color }}
                  title={lbl.name}
                  aria-label={lbl.name}
                />
              ))}
              {task.assignee && (
                <Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size="xs" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const TaskCard = memo(TaskCardInner);
