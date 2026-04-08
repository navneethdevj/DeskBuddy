import { z } from 'zod';
import { TASK_STATUSES } from '../constants/task-statuses';

export const TaskSchema = z.object({
  id: z.string().cuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  status: z.enum(TASK_STATUSES),
  assigneeId: z.string().cuid().nullable(),
  workspaceId: z.string().cuid(),
  createdBy: z.string().cuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(TASK_STATUSES).default('TODO'),
  assigneeId: z.string().cuid().optional(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial();

export type Task = z.infer<typeof TaskSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
