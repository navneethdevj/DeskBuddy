import { prisma as defaultPrisma } from '@api/db/prisma';
import { HttpError } from '@api/utils/httpError';
import { toNoteDTO } from '@api/utils/mappers';
import { getIO } from '@api/sockets/socket.server';
import { SOCKET_EVENTS } from '@shared/constants';
import type { NoteDTO } from '@shared/types';
import type { CreateNoteInput, UpdateNoteInput } from '@shared/schemas';

export class NotesService {
  constructor(private readonly db = defaultPrisma) {}

  private async _assertMember(userId: string, workspaceId: string): Promise<void> {
    const member = await this.db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) {
      throw new HttpError(403, 'Access denied to this workspace', 'FORBIDDEN');
    }
  }

  async list(userId: string, workspaceId: string): Promise<NoteDTO[]> {
    await this._assertMember(userId, workspaceId);
    const notes = await this.db.note.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
    });
    return notes.map(toNoteDTO);
  }

  async create(userId: string, workspaceId: string, data: CreateNoteInput): Promise<NoteDTO> {
    await this._assertMember(userId, workspaceId);
    const note = await this.db.note.create({
      data: {
        title: data.title,
        content: data.content ?? '',
        workspaceId,
        createdBy: userId,
      },
    });
    const dto = toNoteDTO(note);
    getIO().to(workspaceId).emit(SOCKET_EVENTS.NOTE_CREATED, dto);
    return dto;
  }

  async getById(userId: string, workspaceId: string, noteId: string): Promise<NoteDTO> {
    await this._assertMember(userId, workspaceId);
    const note = await this.db.note.findFirst({ where: { id: noteId, workspaceId } });
    if (!note) {
      throw new HttpError(404, 'Note not found', 'NOT_FOUND');
    }
    return toNoteDTO(note);
  }

  async update(
    userId: string,
    workspaceId: string,
    noteId: string,
    data: UpdateNoteInput,
  ): Promise<NoteDTO> {
    await this._assertMember(userId, workspaceId);
    const existing = await this.db.note.findFirst({ where: { id: noteId, workspaceId } });
    if (!existing) {
      throw new HttpError(404, 'Note not found', 'NOT_FOUND');
    }
    const note = await this.db.note.update({
      where: { id: noteId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { content: data.content }),
      },
    });
    const dto = toNoteDTO(note);
    getIO().to(workspaceId).emit(SOCKET_EVENTS.NOTE_UPDATED, dto);
    return dto;
  }

  async delete(userId: string, workspaceId: string, noteId: string): Promise<void> {
    await this._assertMember(userId, workspaceId);
    const existing = await this.db.note.findFirst({ where: { id: noteId, workspaceId } });
    if (!existing) {
      throw new HttpError(404, 'Note not found', 'NOT_FOUND');
    }
    await this.db.note.delete({ where: { id: noteId } });
    getIO().to(workspaceId).emit(SOCKET_EVENTS.NOTE_DELETED, { noteId, workspaceId });
  }
}
