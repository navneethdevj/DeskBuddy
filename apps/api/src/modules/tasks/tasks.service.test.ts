import { TasksService } from './tasks.service';
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
const WS_ID = 'ws-1';
const TASK_ID = 'task-1';

const mockMember = { userId: USER_ID, workspaceId: WS_ID, role: 'MEMBER', joinedAt: new Date() };

const mockTask = {
  id: TASK_ID,
  title: 'Do something',
  description: null,
  status: 'TODO' as const,
  assigneeId: null,
  assignee: null,
  workspaceId: WS_ID,
  createdBy: USER_ID,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ── helpers ───────────────────────────────────────────────────────────────────
function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    workspaceMember: { findUnique: jest.fn().mockResolvedValue(mockMember) },
    task: {
      findMany: jest.fn().mockResolvedValue([mockTask]),
      findFirst: jest.fn().mockResolvedValue(mockTask),
      create: jest.fn().mockResolvedValue(mockTask),
      update: jest.fn().mockResolvedValue({ ...mockTask, title: 'Updated' }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('TasksService', () => {
  let service: TasksService;
  let mockDb: ReturnType<typeof makeDb>;
  let mockEmit: jest.Mock;
  let mockTo: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = makeDb();
    service = new TasksService(mockDb);

    mockEmit = jest.fn();
    mockTo = jest.fn(() => ({ emit: mockEmit }));
    (getIO as jest.Mock).mockReturnValue({ to: mockTo });
  });

  // ── list ──────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('returns mapped tasks when user is a member', async () => {
      const result = await service.list(USER_ID, WS_ID);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(TASK_ID);
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.list(USER_ID, WS_ID)).rejects.toBeInstanceOf(HttpError);
      await expect(service.list(USER_ID, WS_ID)).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  // ── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates a task, emits TASK_CREATED, and returns DTO', async () => {
      const result = await service.create(USER_ID, WS_ID, { title: 'Do something', status: 'TODO' });

      expect((mockDb.task.create as jest.Mock)).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(TASK_ID);
      expect(mockTo).toHaveBeenCalledWith(WS_ID);
      expect(mockEmit).toHaveBeenCalledWith('task:created', expect.objectContaining({ id: TASK_ID }));
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.create(USER_ID, WS_ID, { title: 'x', status: 'TODO' }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('returns task DTO', async () => {
      const result = await service.getById(USER_ID, WS_ID, TASK_ID);
      expect(result.id).toBe(TASK_ID);
    });

    it('throws 404 when task not found', async () => {
      (mockDb.task.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getById(USER_ID, WS_ID, TASK_ID)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  // ── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates task and emits TASK_UPDATED', async () => {
      const result = await service.update(USER_ID, WS_ID, TASK_ID, { title: 'Updated' });
      expect(result.title).toBe('Updated');
      expect(mockTo).toHaveBeenCalledWith(WS_ID);
      expect(mockEmit).toHaveBeenCalledWith('task:updated', expect.any(Object));
    });

    it('throws 404 when task not found', async () => {
      (mockDb.task.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update(USER_ID, WS_ID, TASK_ID, { title: 'x' }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deletes task and emits TASK_DELETED', async () => {
      await service.delete(USER_ID, WS_ID, TASK_ID);
      expect((mockDb.task.delete as jest.Mock)).toHaveBeenCalledTimes(1);
      expect(mockTo).toHaveBeenCalledWith(WS_ID);
      expect(mockEmit).toHaveBeenCalledWith(
        'task:deleted',
        expect.objectContaining({ taskId: TASK_ID }),
      );
    });

    it('throws 404 when task not found', async () => {
      (mockDb.task.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.delete(USER_ID, WS_ID, TASK_ID)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
