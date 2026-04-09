import { Role } from '@prisma/client';
import { prisma as defaultPrisma } from '@api/db/prisma';
import { HttpError } from '@api/utils/httpError';
import { toWorkspaceDTO } from '@api/utils/mappers';
import type { WorkspaceDTO } from '@shared/types';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from '@shared/schemas';

export class WorkspacesService {
  constructor(private readonly db = defaultPrisma) {}

  async list(userId: string): Promise<WorkspaceDTO[]> {
    const memberships = await this.db.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
    return memberships.map((m) => toWorkspaceDTO(m.workspace));
  }

  async create(userId: string, data: CreateWorkspaceInput): Promise<WorkspaceDTO> {
    const workspace = await this.db.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          ownerId: userId,
        },
      });
      await tx.workspaceMember.create({
        data: { userId, workspaceId: ws.id, role: Role.OWNER },
      });
      return ws;
    });
    return toWorkspaceDTO(workspace);
  }

  async getById(userId: string, workspaceId: string): Promise<WorkspaceDTO> {
    const member = await this.db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) {
      throw new HttpError(403, 'Access denied to this workspace', 'FORBIDDEN');
    }
    const workspace = await this.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new HttpError(404, 'Workspace not found', 'NOT_FOUND');
    }
    return toWorkspaceDTO(workspace);
  }

  async update(
    userId: string,
    workspaceId: string,
    data: UpdateWorkspaceInput,
  ): Promise<WorkspaceDTO> {
    const member = await this.db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member || !([Role.OWNER, Role.ADMIN] as Role[]).includes(member.role)) {
      throw new HttpError(
        403,
        'Only workspace owners and admins can update the workspace',
        'FORBIDDEN',
      );
    }
    const workspace = await this.db.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });
    return toWorkspaceDTO(workspace);
  }

  async delete(userId: string, workspaceId: string): Promise<void> {
    const member = await this.db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member || member.role !== Role.OWNER) {
      throw new HttpError(403, 'Only workspace owners can delete the workspace', 'FORBIDDEN');
    }
    await this.db.workspace.delete({ where: { id: workspaceId } });
  }
}
