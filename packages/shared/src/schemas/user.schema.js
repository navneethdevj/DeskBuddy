"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateUserSchema = exports.UserSchema = void 0;
const zod_1 = require("zod");
exports.UserSchema = zod_1.z.object({
    id: zod_1.z.string().cuid(),
    email: zod_1.z.string().email(),
    name: zod_1.z.string().min(1).max(100),
    avatarUrl: zod_1.z.string().url().nullable(),
    createdAt: zod_1.z.string().datetime(),
    updatedAt: zod_1.z.string().datetime(),
});
exports.CreateUserSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    name: zod_1.z.string().min(1).max(100),
    avatarUrl: zod_1.z.string().url().optional(),
});
//# sourceMappingURL=user.schema.js.map