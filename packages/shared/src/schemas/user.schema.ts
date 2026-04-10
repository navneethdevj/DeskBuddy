import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().cuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  avatarUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  avatarUrl: z.string().url().optional(),
});

export type User = z.infer<typeof UserSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
