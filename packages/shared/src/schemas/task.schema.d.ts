import { z } from 'zod';
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<["TODO", "IN_PROGRESS", "DONE"]>;
    priority: z.ZodDefault<z.ZodEnum<["LOW", "MEDIUM", "HIGH", "URGENT"]>>;
    dueDate: z.ZodNullable<z.ZodString>;
    position: z.ZodDefault<z.ZodNumber>;
    assigneeId: z.ZodNullable<z.ZodString>;
    workspaceId: z.ZodString;
    createdBy: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "TODO" | "IN_PROGRESS" | "DONE";
    description: string | null;
    id: string;
    createdAt: string;
    updatedAt: string;
    workspaceId: string;
    title: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate: string | null;
    position: number;
    assigneeId: string | null;
    createdBy: string;
}, {
    status: "TODO" | "IN_PROGRESS" | "DONE";
    description: string | null;
    id: string;
    createdAt: string;
    updatedAt: string;
    workspaceId: string;
    title: string;
    dueDate: string | null;
    assigneeId: string | null;
    createdBy: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | undefined;
    position?: number | undefined;
}>;
export declare const CreateTaskSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    status: z.ZodDefault<z.ZodEnum<["TODO", "IN_PROGRESS", "DONE"]>>;
    priority: z.ZodDefault<z.ZodEnum<["LOW", "MEDIUM", "HIGH", "URGENT"]>>;
    dueDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    position: z.ZodOptional<z.ZodNumber>;
    assigneeId: z.ZodOptional<z.ZodString>;
    labelIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    status: "TODO" | "IN_PROGRESS" | "DONE";
    title: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    description?: string | null | undefined;
    dueDate?: string | null | undefined;
    position?: number | undefined;
    assigneeId?: string | undefined;
    labelIds?: string[] | undefined;
}, {
    title: string;
    status?: "TODO" | "IN_PROGRESS" | "DONE" | undefined;
    description?: string | null | undefined;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | undefined;
    dueDate?: string | null | undefined;
    position?: number | undefined;
    assigneeId?: string | undefined;
    labelIds?: string[] | undefined;
}>;
export declare const UpdateTaskSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    status: z.ZodOptional<z.ZodDefault<z.ZodEnum<["TODO", "IN_PROGRESS", "DONE"]>>>;
    priority: z.ZodOptional<z.ZodDefault<z.ZodEnum<["LOW", "MEDIUM", "HIGH", "URGENT"]>>>;
    dueDate: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    position: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    assigneeId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    labelIds: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    status?: "TODO" | "IN_PROGRESS" | "DONE" | undefined;
    description?: string | null | undefined;
    title?: string | undefined;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | undefined;
    dueDate?: string | null | undefined;
    position?: number | undefined;
    assigneeId?: string | undefined;
    labelIds?: string[] | undefined;
}, {
    status?: "TODO" | "IN_PROGRESS" | "DONE" | undefined;
    description?: string | null | undefined;
    title?: string | undefined;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | undefined;
    dueDate?: string | null | undefined;
    position?: number | undefined;
    assigneeId?: string | undefined;
    labelIds?: string[] | undefined;
}>;
export type Task = z.infer<typeof TaskSchema>;
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.input<typeof UpdateTaskSchema>;
//# sourceMappingURL=task.schema.d.ts.map