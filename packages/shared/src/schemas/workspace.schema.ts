import { z } from 'zod';
import { ROLES } from '../constants/roles';

export const WorkspaceSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable(),
  ownerId: z.string().cuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const UpdateWorkspaceSchema = CreateWorkspaceSchema.partial();

export const WorkspaceMemberSchema = z.object({
  userId: z.string().cuid(),
  workspaceId: z.string().cuid(),
  role: z.enum([ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER]),
  joinedAt: z.string().datetime(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
