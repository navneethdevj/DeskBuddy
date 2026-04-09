import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { TaskDTO } from '@shared/types';
import type { CreateTaskInput } from '@shared/schemas';
import api from '@web/lib/api';

interface TaskState {
  tasks: TaskDTO[];
  isLoading: boolean;
  error: string | null;

  fetchTasks: (workspaceId: string) => Promise<void>;
  createTask: (workspaceId: string, data: CreateTaskInput) => Promise<void>;
  handleSocketTaskCreated: (task: TaskDTO) => void;
  handleSocketTaskUpdated: (task: TaskDTO) => void;
  handleSocketTaskDeleted: (taskId: string) => void;
}

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
};

export const useTaskStore = create<TaskState>()(
  immer((set) => ({
    tasks: [],
    isLoading: false,
    error: null,

    fetchTasks: async (workspaceId) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const { data } = await api.get<TaskDTO[]>(`/workspaces/${workspaceId}/tasks`);
        set((state) => {
          state.tasks = data;
        });
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err);
        });
      } finally {
        set((state) => {
          state.isLoading = false;
        });
      }
    },

    createTask: async (workspaceId, data) => {
      set((state) => {
        state.error = null;
      });
      try {
        const { data: task } = await api.post<TaskDTO>(`/workspaces/${workspaceId}/tasks`, data);
        set((state) => {
          state.tasks.push(task);
        });
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err);
        });
      }
    },

    handleSocketTaskCreated: (task) => {
      set((state) => {
        const exists = state.tasks.some((t) => t.id === task.id);
        if (!exists) {
          state.tasks.push(task);
        }
      });
    },

    handleSocketTaskUpdated: (task) => {
      set((state) => {
        const index = state.tasks.findIndex((t) => t.id === task.id);
        if (index !== -1) {
          state.tasks[index] = task;
        }
      });
    },

    handleSocketTaskDeleted: (taskId) => {
      set((state) => {
        state.tasks = state.tasks.filter((t) => t.id !== taskId);
      });
    },
  }))
);
