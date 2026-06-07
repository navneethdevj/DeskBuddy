import { z } from 'zod';
export declare const UserSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    name: z.ZodString;
    avatarUrl: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    id: string;
    email: string;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
}, {
    name: string;
    id: string;
    email: string;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
}>;
export declare const CreateUserSchema: z.ZodObject<{
    email: z.ZodString;
    name: z.ZodString;
    avatarUrl: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    email: string;
    avatarUrl?: string | undefined;
}, {
    name: string;
    email: string;
    avatarUrl?: string | undefined;
}>;
export type User = z.infer<typeof UserSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
//# sourceMappingURL=user.schema.d.ts.map