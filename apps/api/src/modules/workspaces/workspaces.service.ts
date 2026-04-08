import type { WorkspaceDTO } from '@shared/types';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from '@shared/schemas';

export class WorkspacesService {
  list(_userId: string): Promise<WorkspaceDTO[]> {
    throw new Error('Not implemented: list');
  }

  create(_userId: string, _data: CreateWorkspaceInput): Promise<WorkspaceDTO> {
    throw new Error('Not implemented: create');
  }

  getById(_userId: string, _workspaceId: string): Promise<WorkspaceDTO> {
    throw new Error('Not implemented: getById');
  }

  update(_userId: string, _workspaceId: string, _data: UpdateWorkspaceInput): Promise<WorkspaceDTO> {
    throw new Error('Not implemented: update');
  }

  delete(_userId: string, _workspaceId: string): Promise<void> {
    throw new Error('Not implemented: delete');
  }
}
