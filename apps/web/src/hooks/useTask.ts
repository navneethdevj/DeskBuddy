import { useEffect } from 'react';
import { useTaskStore } from '@web/stores/taskStore';
import type { TaskDTO } from '@shared/types';
import type { TaskStatus } from '@shared/constants';
import type { CreateTaskInput, UpdateTaskInput } from '@shared/schemas';

interface UseTaskReturn {
  tasks: TaskDTO[];
  isLoading: boolean;
  error: string | null;
  fetchTasks: (workspaceId: string) => Promise<void>;
  createTask: (workspaceId: string, data: CreateTaskInput) => Promise<void>;
  updateTask: (workspaceId: string, taskId: string, data: UpdateTaskInput) => Promise<void>;
  deleteTask: (workspaceId: string, taskId: string) => Promise<void>;
  clearError: () => void;
}

export const useTask = (workspaceId: string | null): UseTaskReturn => {
  const { tasks, isLoading, error, fetchTasks, createTask, updateTask, deleteTask, clearError } =
    useTaskStore();

  useEffect(() => {
    if (workspaceId) {
      void fetchTasks(workspaceId);
    }
  }, [workspaceId, fetchTasks]);

  return { tasks, isLoading, error, fetchTasks, createTask, updateTask, deleteTask, clearError };
};

export type { TaskStatus };
