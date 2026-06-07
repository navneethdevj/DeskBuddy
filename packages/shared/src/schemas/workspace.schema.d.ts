import { z } from 'zod';
export declare const WorkspaceSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    ownerId: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string | null;
    id: string;
    createdAt: string;
    updatedAt: string;
    ownerId: string;
}, {
    name: string;
    description: string | null;
    id: string;
    createdAt: string;
    updatedAt: string;
    ownerId: string;
}>;
export declare const CreateWorkspaceSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description?: string | undefined;
}, {
    name: string;
    description?: string | undefined;
}>;
export declare const UpdateWorkspaceSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    description?: string | undefined;
}, {
    name?: string | undefined;
    description?: string | undefined;
}>;
export declare const WorkspaceMemberSchema: z.ZodObject<{
    userId: z.ZodString;
    workspaceId: z.ZodString;
    role: z.ZodEnum<["OWNER", "ADMIN", "MEMBER"]>;
    joinedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "OWNER" | "ADMIN" | "MEMBER";
    userId: string;
    workspaceId: string;
    joinedAt: string;
}, {
    role: "OWNER" | "ADMIN" | "MEMBER";
    userId: string;
    workspaceId: string;
    joinedAt: string;
}>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
//# sourceMappingURL=workspace.schema.d.ts.map