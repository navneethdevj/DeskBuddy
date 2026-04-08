import type { TaskDTO } from '@shared/types';
import type { CreateTaskInput, UpdateTaskInput } from '@shared/schemas';
import { prisma } from '@api/db/prisma';

export class TasksService {
  constructor(private readonly db = prisma) {}

  list(_userId: string, _workspaceId: string): Promise<TaskDTO[]> {
    throw new Error('Not implemented: list');
  }

  create(_userId: string, _workspaceId: string, _data: CreateTaskInput): Promise<TaskDTO> {
    throw new Error('Not implemented: create');
  }

  getById(_userId: string, _workspaceId: string, _taskId: string): Promise<TaskDTO> {
    throw new Error('Not implemented: getById');
  }

  update(
    _userId: string,
    _workspaceId: string,
    _taskId: string,
    _data: UpdateTaskInput
  ): Promise<TaskDTO> {
    throw new Error('Not implemented: update');
  }

  delete(_userId: string, _workspaceId: string, _taskId: string): Promise<void> {
    throw new Error('Not implemented: delete');
  }
}
