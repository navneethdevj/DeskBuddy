import { z } from 'zod';

export const NoteSchema = z.object({
  id: z.string().cuid(),
  title: z.string().min(1).max(200),
  content: z.string().max(50000),
  workspaceId: z.string().cuid(),
  createdBy: z.string().cuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateNoteSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(50000).default(''),
});

export const UpdateNoteSchema = CreateNoteSchema.partial();

export type Note = z.infer<typeof NoteSchema>;
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>;
