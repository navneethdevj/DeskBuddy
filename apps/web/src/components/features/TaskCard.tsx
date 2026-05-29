import type { TaskDTO } from '@shared/types';
import { Badge } from '@web/components/ui/Badge';
import { Avatar } from '@web/components/ui/Avatar';

interface TaskCardProps {
  task: TaskDTO;
  onTaskClick: (task: TaskDTO) => void;
  isLoading?: boolean;
}

const STATUS_VARIANT = {
  TODO: 'gray',
  IN_PROGRESS: 'blue',
  DONE: 'green',
} as const;

const STATUS_LABEL = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
} as const;

const PRIORITY_INDICATOR = {
  LOW: { dot: 'bg-gray-300', label: '' },
  MEDIUM: { dot: 'bg-blue-400', label: '' },
  HIGH: { dot: 'bg-amber-400', label: '!' },
  URGENT: { dot: 'bg-red-500', label: '!!' },
} as const;

const getAgingDot = (updatedAt: string, status: string): string | null => {
  if (status === 'DONE') return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days >= 7) return 'bg-red-400';
  if (days >= 3) return 'bg-amber-300';
  return null;
};

export const TaskCard = ({
  task,
  onTaskClick,
  isLoading = false,
}: TaskCardProps): JSX.Element => {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm animate-pulse" aria-busy="true">
        <div className="h-4 w-3/4 rounded bg-gray-200 mb-2" />
        <div className="h-3 w-1/2 rounded bg-gray-200" />
      </div>
    );
  }

  const priority = PRIORITY_INDICATOR[task.priority] ?? PRIORITY_INDICATOR.MEDIUM;
  const agingDot = getAgingDot(task.updatedAt, task.status);
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'DONE';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}. Click to view details.`}
      onClick={() => onTaskClick(task)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTaskClick(task); }}
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-blue-200 transition-all select-none"
    >
      <div className="flex gap-2">
        <div className={`w-0.5 rounded-full self-stretch shrink-0 ${priority.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5">
            <p className="font-medium text-gray-900 text-sm line-clamp-2 flex-1">{task.title}</p>
            {agingDot && (
              <span
                className={`mt-1 h-2 w-2 rounded-full shrink-0 ${agingDot}`}
                title="Task hasn't been updated recently"
              />
            )}
          </div>

          {task.description && (
            <p className="mt-0.5 text-xs text-gray-400 line-clamp-1">{task.description}</p>
          )}

          {task.dueDate && (
            <p className={`mt-0.5 text-xs font-medium ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
              {isOverdue ? '⚠ ' : ''}Due {new Date(task.dueDate).toLocaleDateString()}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between">
            <Badge
              label={STATUS_LABEL[task.status as keyof typeof STATUS_LABEL]}
              variant={STATUS_VARIANT[task.status as keyof typeof STATUS_VARIANT]}
            />
            <div className="flex items-center gap-1">
              {priority.label && (
                <span className={`text-xs font-bold ${task.priority === 'URGENT' ? 'text-red-500' : 'text-amber-500'}`}>
                  {priority.label}
                </span>
              )}
              {task.assignee && (
                <Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size="sm" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
