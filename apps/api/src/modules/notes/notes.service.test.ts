import { NotesService } from './notes.service';
import { HttpError } from '@api/utils/httpError';
import type { PrismaClient } from '@prisma/client';

// ── module mocks ──────────────────────────────────────────────────────────────
jest.mock('@api/sockets/socket.server', () => ({
  getIO: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
}));
jest.mock('@api/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { getIO } from '@api/sockets/socket.server';

// ── test data ─────────────────────────────────────────────────────────────────
const USER_ID = 'user-1';
const WS_ID   = 'ws-1';
const NOTE_ID = 'note-1';

const mockMember = { userId: USER_ID, workspaceId: WS_ID, role: 'MEMBER', joinedAt: new Date() };

const mockNote = {
  id:          NOTE_ID,
  title:       'Meeting notes',
  content:     'Discussed roadmap',
  workspaceId: WS_ID,
  createdBy:   USER_ID,
  createdAt:   new Date('2024-01-01'),
  updatedAt:   new Date('2024-01-01'),
};

// ── helpers ───────────────────────────────────────────────────────────────────
function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    workspaceMember: { findUnique: jest.fn().mockResolvedValue(mockMember) },
    note: {
      findMany:  jest.fn().mockResolvedValue([mockNote]),
      findFirst: jest.fn().mockResolvedValue(mockNote),
      create:    jest.fn().mockResolvedValue(mockNote),
      update:    jest.fn().mockResolvedValue({ ...mockNote, title: 'Updated title' }),
      delete:    jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('NotesService', () => {
  let service: NotesService;
  let mockDb: ReturnType<typeof makeDb>;
  let mockEmit: jest.Mock;
  let mockTo: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb  = makeDb();
    service = new NotesService(mockDb);

    mockEmit = jest.fn();
    mockTo   = jest.fn(() => ({ emit: mockEmit }));
    (getIO as jest.Mock).mockReturnValue({ to: mockTo });
  });

  // ── list ──────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('returns mapped notes when user is a member', async () => {
      const result = await service.list(USER_ID, WS_ID);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(NOTE_ID);
      expect(result[0].title).toBe('Meeting notes');
    });

    it('queries by workspaceId and orders by updatedAt desc', async () => {
      await service.list(USER_ID, WS_ID);
      expect(mockDb.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where:   { workspaceId: WS_ID },
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.list(USER_ID, WS_ID)).rejects.toMatchObject({
        statusCode: 403,
        code:       'FORBIDDEN',
      });
    });

    it('returns empty array when workspace has no notes', async () => {
      (mockDb.note.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.list(USER_ID, WS_ID);
      expect(result).toEqual([]);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates a note, emits NOTE_CREATED, and returns DTO', async () => {
      const result = await service.create(USER_ID, WS_ID, {
        title:   'Meeting notes',
        content: 'Discussed roadmap',
      });

      expect(mockDb.note.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(NOTE_ID);
      expect(mockTo).toHaveBeenCalledWith(WS_ID);
      expect(mockEmit).toHaveBeenCalledWith(
        'note:created',
        expect.objectContaining({ id: NOTE_ID }),
      );
    });

    it('stores an empty string content when passed explicitly', async () => {
      await service.create(USER_ID, WS_ID, { title: 'No content', content: '' });
      expect(mockDb.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ content: '' }),
        }),
      );
    });

    it('uses provided content when given', async () => {
      await service.create(USER_ID, WS_ID, { title: 'With content', content: 'some text' });
      expect(mockDb.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ content: 'some text' }),
        }),
      );
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.create(USER_ID, WS_ID, { title: 'x', content: '' }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('returns the note DTO when found', async () => {
      const result = await service.getById(USER_ID, WS_ID, NOTE_ID);
      expect(result.id).toBe(NOTE_ID);
    });

    it('queries with both noteId and workspaceId', async () => {
      await service.getById(USER_ID, WS_ID, NOTE_ID);
      expect(mockDb.note.findFirst).toHaveBeenCalledWith({
        where: { id: NOTE_ID, workspaceId: WS_ID },
      });
    });

    it('throws 404 when note is not found', async () => {
      (mockDb.note.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getById(USER_ID, WS_ID, NOTE_ID)).rejects.toMatchObject({
        statusCode: 404,
        code:       'NOT_FOUND',
      });
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getById(USER_ID, WS_ID, NOTE_ID)).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  // ── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates the note title and emits NOTE_UPDATED', async () => {
      const result = await service.update(USER_ID, WS_ID, NOTE_ID, { title: 'Updated title' });
      expect(result.title).toBe('Updated title');
      expect(mockTo).toHaveBeenCalledWith(WS_ID);
      expect(mockEmit).toHaveBeenCalledWith('note:updated', expect.any(Object));
    });

    it('passes only defined fields to Prisma update', async () => {
      await service.update(USER_ID, WS_ID, NOTE_ID, { title: 'New title' });
      const call = (mockDb.note.update as jest.Mock).mock.calls[0][0];
      expect(call.data.title).toBe('New title');
      expect(call.data.content).toBeUndefined();
    });

    it('updates content when provided', async () => {
      (mockDb.note.update as jest.Mock).mockResolvedValue({ ...mockNote, content: 'new body' });
      const result = await service.update(USER_ID, WS_ID, NOTE_ID, { content: 'new body' });
      expect(result.content).toBe('new body');
    });

    it('throws 404 when note does not exist', async () => {
      (mockDb.note.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update(USER_ID, WS_ID, NOTE_ID, { title: 'x' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update(USER_ID, WS_ID, NOTE_ID, { title: 'x' }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deletes the note and emits NOTE_DELETED', async () => {
      await service.delete(USER_ID, WS_ID, NOTE_ID);
      expect(mockDb.note.delete).toHaveBeenCalledWith({ where: { id: NOTE_ID } });
      expect(mockTo).toHaveBeenCalledWith(WS_ID);
      expect(mockEmit).toHaveBeenCalledWith(
        'note:deleted',
        expect.objectContaining({ noteId: NOTE_ID, workspaceId: WS_ID }),
      );
    });

    it('throws 404 when note does not exist', async () => {
      (mockDb.note.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.delete(USER_ID, WS_ID, NOTE_ID)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.delete(USER_ID, WS_ID, NOTE_ID)).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });
});
