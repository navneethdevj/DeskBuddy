import type { TaskDTO } from '@shared/types';
import type { TaskStatus } from '@shared/constants';
import { Badge } from '@web/components/ui/Badge';
import { Avatar } from '@web/components/ui/Avatar';

interface TaskCardProps {
  task: TaskDTO;
  onStatusChange: (status: TaskStatus) => void;
  isLoading?: boolean;
}

const STATUS_CYCLE: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];

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

export const TaskCard = ({ task, onStatusChange, isLoading = false }: TaskCardProps): JSX.Element => {
  if (isLoading) {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm animate-pulse"
        aria-busy="true"
        aria-label="Loading task"
      >
        <div className="h-4 w-3/4 rounded bg-gray-200 mb-2" />
        <div className="h-3 w-1/2 rounded bg-gray-200" />
      </div>
    );
  }

  const handleClick = (): void => {
    const currentIndex = STATUS_CYCLE.indexOf(task.status as TaskStatus);
    const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length] as TaskStatus;
    onStatusChange(nextStatus);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}. Status: ${STATUS_LABEL[task.status as TaskStatus]}. Click to advance status.`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      }}
      className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
    >
      {/* Title */}
      <p className="font-medium text-gray-900 line-clamp-1">{task.title}</p>

      {/* Description */}
      {task.description ? (
        <p className="mt-1 text-sm text-gray-500 line-clamp-2">{task.description}</p>
      ) : null}

      {/* Footer: badge + assignee */}
      <div className="mt-3 flex items-center justify-between">
        <Badge label={STATUS_LABEL[task.status as TaskStatus]} variant={STATUS_VARIANT[task.status as TaskStatus]} />
        {task.assignee ? (
          <Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size="sm" />
        ) : null}
      </div>
    </div>
  );
};
