import { z } from 'zod';
import { TASK_STATUSES } from '../constants/task-statuses';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const TaskSchema = z.object({
  id: z.string().cuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  dueDate: z.string().datetime().nullable(),
  position: z.number().int().default(0),
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
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  dueDate: z.string().datetime().optional().nullable(),
  position: z.number().int().optional(),
  assigneeId: z.string().cuid().optional(),
  labelIds: z.array(z.string()).optional(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial();

export type Task = z.infer<typeof TaskSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
