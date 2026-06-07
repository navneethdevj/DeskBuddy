"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateNoteSchema = exports.CreateNoteSchema = exports.NoteSchema = void 0;
const zod_1 = require("zod");
exports.NoteSchema = zod_1.z.object({
    id: zod_1.z.string().cuid(),
    title: zod_1.z.string().min(1).max(200),
    content: zod_1.z.string().max(50000),
    workspaceId: zod_1.z.string().cuid(),
    createdBy: zod_1.z.string().cuid(),
    createdAt: zod_1.z.string().datetime(),
    updatedAt: zod_1.z.string().datetime(),
});
exports.CreateNoteSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(200),
    content: zod_1.z.string().max(50000).default(''),
});
exports.UpdateNoteSchema = exports.CreateNoteSchema.partial();
//# sourceMappingURL=note.schema.js.map