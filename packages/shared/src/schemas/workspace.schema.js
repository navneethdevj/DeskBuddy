"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceMemberSchema = exports.UpdateWorkspaceSchema = exports.CreateWorkspaceSchema = exports.WorkspaceSchema = void 0;
const zod_1 = require("zod");
const roles_1 = require("../constants/roles");
exports.WorkspaceSchema = zod_1.z.object({
    id: zod_1.z.string().cuid(),
    name: zod_1.z.string().min(1).max(100),
    description: zod_1.z.string().max(500).nullable(),
    ownerId: zod_1.z.string().cuid(),
    createdAt: zod_1.z.string().datetime(),
    updatedAt: zod_1.z.string().datetime(),
});
exports.CreateWorkspaceSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    description: zod_1.z.string().max(500).optional(),
});
exports.UpdateWorkspaceSchema = exports.CreateWorkspaceSchema.partial();
exports.WorkspaceMemberSchema = zod_1.z.object({
    userId: zod_1.z.string().cuid(),
    workspaceId: zod_1.z.string().cuid(),
    role: zod_1.z.enum([roles_1.ROLES.OWNER, roles_1.ROLES.ADMIN, roles_1.ROLES.MEMBER]),
    joinedAt: zod_1.z.string().datetime(),
});
//# sourceMappingURL=workspace.schema.js.map