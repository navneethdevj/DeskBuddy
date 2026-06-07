import { z } from 'zod';
export declare const NoteSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    content: z.ZodString;
    workspaceId: z.ZodString;
    createdBy: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: string;
    updatedAt: string;
    workspaceId: string;
    title: string;
    createdBy: string;
    content: string;
}, {
    id: string;
    createdAt: string;
    updatedAt: string;
    workspaceId: string;
    title: string;
    createdBy: string;
    content: string;
}>;
export declare const CreateNoteSchema: z.ZodObject<{
    title: z.ZodString;
    content: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    content: string;
}, {
    title: string;
    content?: string | undefined;
}>;
export declare const UpdateNoteSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodDefault<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    title?: string | undefined;
    content?: string | undefined;
}, {
    title?: string | undefined;
    content?: string | undefined;
}>;
export type Note = z.infer<typeof NoteSchema>;
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>;
//# sourceMappingURL=note.schema.d.ts.map