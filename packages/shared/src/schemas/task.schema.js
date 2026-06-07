"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateTaskSchema = exports.CreateTaskSchema = exports.TaskSchema = void 0;
const zod_1 = require("zod");
const task_statuses_1 = require("../constants/task-statuses");
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
exports.TaskSchema = zod_1.z.object({
    id: zod_1.z.string().cuid(),
    title: zod_1.z.string().min(1).max(200),
    description: zod_1.z.string().max(2000).nullable(),
    status: zod_1.z.enum(task_statuses_1.TASK_STATUSES),
    priority: zod_1.z.enum(PRIORITIES).default('MEDIUM'),
    dueDate: zod_1.z.string().datetime().nullable(),
    position: zod_1.z.number().int().default(0),
    assigneeId: zod_1.z.string().cuid().nullable(),
    workspaceId: zod_1.z.string().cuid(),
    createdBy: zod_1.z.string().cuid(),
    createdAt: zod_1.z.string().datetime(),
    updatedAt: zod_1.z.string().datetime(),
});
exports.CreateTaskSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(200),
    description: zod_1.z.string().max(2000).optional().nullable(),
    status: zod_1.z.enum(task_statuses_1.TASK_STATUSES).default('TODO'),
    priority: zod_1.z.enum(PRIORITIES).default('MEDIUM'),
    dueDate: zod_1.z.string().datetime().optional().nullable(),
    position: zod_1.z.number().int().optional(),
    assigneeId: zod_1.z.string().cuid().optional(),
    labelIds: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.UpdateTaskSchema = exports.CreateTaskSchema.partial();
//# sourceMappingURL=task.schema.js.map