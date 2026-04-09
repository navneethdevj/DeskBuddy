import type { TaskDTO } from '@shared/types';
import type { TaskStatus } from '@shared/constants';
import { TaskCard } from './TaskCard';

interface KanbanBoardProps {
  tasks: TaskDTO[];
  isLoading: boolean;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
}

const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'TODO', label: 'To Do' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'DONE', label: 'Done' },
];

export const KanbanBoard = ({ tasks, isLoading, onStatusChange }: KanbanBoardProps): JSX.Element => (
  <div className="grid grid-cols-3 gap-4" role="region" aria-label="Kanban board">
    {COLUMNS.map(({ status, label }) => {
      const columnTasks = tasks.filter((t) => t.status === status);

      return (
        <div key={status} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            {label}
            <span className="ml-2 text-gray-400">({columnTasks.length})</span>
          </h3>
          <div className="flex flex-col gap-2 min-h-24 rounded-lg bg-gray-50 p-2">
            {isLoading
              ? Array.from({ length: 2 }).map((_, i) => (
                  <TaskCard
                    key={i}
                    task={{} as TaskDTO}
                    onStatusChange={() => undefined}
                    isLoading
                  />
                ))
              : columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onStatusChange={(newStatus) => onStatusChange(task.id, newStatus)}
                  />
                ))}
          </div>
        </div>
      );
    })}
  </div>
);
