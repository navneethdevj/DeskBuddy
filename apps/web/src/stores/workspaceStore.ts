import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { WorkspaceDTO } from '@shared/types';
import type { CreateWorkspaceInput } from '@shared/schemas';
import api from '@web/lib/api';

interface WorkspaceState {
  workspaces: WorkspaceDTO[];
  activeWorkspace: WorkspaceDTO | null;
  isLoading: boolean;
  error: string | null;

  fetchWorkspaces: () => Promise<void>;
  createWorkspace: (data: CreateWorkspaceInput) => Promise<void>;
  setActiveWorkspace: (workspace: WorkspaceDTO) => void;
}

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
};

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set) => ({
    workspaces: [],
    activeWorkspace: null,
    isLoading: false,
    error: null,

    fetchWorkspaces: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const { data } = await api.get<WorkspaceDTO[]>('/workspaces');
        set((state) => {
          state.workspaces = data;
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

    createWorkspace: async (data) => {
      set((state) => {
        state.error = null;
      });
      try {
        const { data: workspace } = await api.post<WorkspaceDTO>('/workspaces', data);
        set((state) => {
          state.workspaces.push(workspace);
        });
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err);
        });
      }
    },

    setActiveWorkspace: (workspace) => {
      set((state) => {
        state.activeWorkspace = workspace;
      });
    },
  }))
);
