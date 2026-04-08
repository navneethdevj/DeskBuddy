import { useEffect } from 'react';
import { useTaskStore } from '@web/stores/taskStore';
import type { TaskDTO } from '@shared/types';
import type { TaskStatus } from '@shared/constants';

interface UseTaskReturn {
  tasks: TaskDTO[];
  isLoading: boolean;
  error: string | null;
  fetchTasks: (workspaceId: string) => Promise<void>;
}

export const useTask = (workspaceId: string | null): UseTaskReturn => {
  const { tasks, isLoading, error, fetchTasks } = useTaskStore();

  useEffect(() => {
    if (workspaceId) {
      void fetchTasks(workspaceId);
    }
  }, [workspaceId, fetchTasks]);

  return { tasks, isLoading, error, fetchTasks };
};

export type { TaskStatus };
