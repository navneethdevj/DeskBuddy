import { TaskStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '@api/db/prisma';
import { HttpError } from '@api/utils/httpError';
import { toTaskDTO } from '@api/utils/mappers';
import { getIO } from '@api/sockets/socket.server';
import { SOCKET_EVENTS } from '@shared/constants';
import type { TaskDTO } from '@shared/types';
import type { CreateTaskInput, UpdateTaskInput } from '@shared/schemas';

export class TasksService {
  constructor(private readonly db = defaultPrisma) {}

  private async _assertMember(userId: string, workspaceId: string): Promise<void> {
    const member = await this.db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) {
      throw new HttpError(403, 'Access denied to this workspace', 'FORBIDDEN');
    }
  }

  async list(userId: string, workspaceId: string): Promise<TaskDTO[]> {
    await this._assertMember(userId, workspaceId);
    const tasks = await this.db.task.findMany({
      where: { workspaceId },
      include: { assignee: true },
      orderBy: { createdAt: 'asc' },
    });
    return tasks.map(toTaskDTO);
  }

  async create(userId: string, workspaceId: string, data: CreateTaskInput): Promise<TaskDTO> {
    await this._assertMember(userId, workspaceId);
    const task = await this.db.task.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        status: (data.status ?? 'TODO') as TaskStatus,
        assigneeId: data.assigneeId ?? null,
        workspaceId,
        createdBy: userId,
      },
      include: { assignee: true },
    });
    const dto = toTaskDTO(task);
    getIO().to(workspaceId).emit(SOCKET_EVENTS.TASK_CREATED, dto);
    return dto;
  }

  async getById(userId: string, workspaceId: string, taskId: string): Promise<TaskDTO> {
    await this._assertMember(userId, workspaceId);
    const task = await this.db.task.findFirst({
      where: { id: taskId, workspaceId },
      include: { assignee: true },
    });
    if (!task) {
      throw new HttpError(404, 'Task not found', 'NOT_FOUND');
    }
    return toTaskDTO(task);
  }

  async update(
    userId: string,
    workspaceId: string,
    taskId: string,
    data: UpdateTaskInput,
  ): Promise<TaskDTO> {
    await this._assertMember(userId, workspaceId);
    const existing = await this.db.task.findFirst({ where: { id: taskId, workspaceId } });
    if (!existing) {
      throw new HttpError(404, 'Task not found', 'NOT_FOUND');
    }
    const task = await this.db.task.update({
      where: { id: taskId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.status !== undefined && { status: data.status as TaskStatus }),
        ...(data.assigneeId !== undefined && { assigneeId: data.assigneeId }),
      },
      include: { assignee: true },
    });
    const dto = toTaskDTO(task);
    getIO().to(workspaceId).emit(SOCKET_EVENTS.TASK_UPDATED, dto);
    return dto;
  }

  async delete(userId: string, workspaceId: string, taskId: string): Promise<void> {
    await this._assertMember(userId, workspaceId);
    const existing = await this.db.task.findFirst({ where: { id: taskId, workspaceId } });
    if (!existing) {
      throw new HttpError(404, 'Task not found', 'NOT_FOUND');
    }
    await this.db.task.delete({ where: { id: taskId } });
    getIO().to(workspaceId).emit(SOCKET_EVENTS.TASK_DELETED, { taskId, workspaceId });
  }
}
