import type { Prisma } from '@prisma/client';
import type { UserDTO, TaskDTO, WorkspaceDTO, NoteDTO } from '@shared/types';

type PrismaUser = Prisma.UserGetPayload<Record<string, never>>;
type PrismaTask = Prisma.TaskGetPayload<{ include: { assignee: true } }>;
type PrismaWorkspace = Prisma.WorkspaceGetPayload<Record<string, never>>;
type PrismaNote = Prisma.NoteGetPayload<Record<string, never>>;

export const toUserDTO = (user: PrismaUser): UserDTO => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl ?? null,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

export const toWorkspaceDTO = (workspace: PrismaWorkspace): WorkspaceDTO => ({
  id: workspace.id,
  name: workspace.name,
  description: workspace.description ?? null,
  ownerId: workspace.ownerId,
  createdAt: workspace.createdAt.toISOString(),
  updatedAt: workspace.updatedAt.toISOString(),
});

export const toTaskDTO = (
  task: PrismaTask
): TaskDTO => ({
  id: task.id,
  title: task.title,
  description: task.description ?? null,
  status: task.status as TaskDTO['status'],
  assignee: task.assignee ? toUserDTO(task.assignee) : undefined,
  workspaceId: task.workspaceId,
  createdBy: task.createdBy,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
});

export const toNoteDTO = (note: PrismaNote): NoteDTO => ({
  id: note.id,
  title: note.title,
  content: note.content,
  workspaceId: note.workspaceId,
  createdBy: note.createdBy,
  createdAt: note.createdAt.toISOString(),
  updatedAt: note.updatedAt.toISOString(),
});
