import { useEffect } from 'react';
import { useWorkspaceStore } from '@web/stores/workspaceStore';
import type { WorkspaceDTO } from '@shared/types';

interface UseWorkspaceReturn {
  workspaces: WorkspaceDTO[];
  activeWorkspace: WorkspaceDTO | null;
  isLoading: boolean;
  error: string | null;
  setActive: (workspace: WorkspaceDTO) => void;
}

export const useWorkspace = (): UseWorkspaceReturn => {
  const { workspaces, activeWorkspace, isLoading, error, fetchWorkspaces, setActiveWorkspace } =
    useWorkspaceStore();

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  return {
    workspaces,
    activeWorkspace,
    isLoading,
    error,
    setActive: setActiveWorkspace,
  };
};
