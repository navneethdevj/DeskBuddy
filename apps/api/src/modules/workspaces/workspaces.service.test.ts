import { WorkspacesService } from './workspaces.service';
import { HttpError } from '@api/utils/httpError';
import type { PrismaClient } from '@prisma/client';

jest.mock('@api/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── test data ─────────────────────────────────────────────────────────────────
const USER_ID = 'user-1';
const WS_ID = 'ws-1';

const mockWorkspace = {
  id: WS_ID,
  name: 'My Workspace',
  description: 'A description',
  ownerId: USER_ID,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const ownerMember = { userId: USER_ID, workspaceId: WS_ID, role: 'OWNER', joinedAt: new Date() };
const adminMember = { userId: USER_ID, workspaceId: WS_ID, role: 'ADMIN', joinedAt: new Date() };
const regularMember = { userId: USER_ID, workspaceId: WS_ID, role: 'MEMBER', joinedAt: new Date() };

// ── helpers ───────────────────────────────────────────────────────────────────
function makeDb(overrides: Record<string, unknown> = {}) {
  // $transaction calls fn(db) synchronously for easy testing
  const db = {
    workspaceMember: {
      findUnique: jest.fn().mockResolvedValue(ownerMember),
      findMany: jest
        .fn()
        .mockResolvedValue([{ ...ownerMember, workspace: mockWorkspace }]),
      create: jest.fn().mockResolvedValue(ownerMember),
    },
    workspace: {
      findUnique: jest.fn().mockResolvedValue(mockWorkspace),
      create: jest.fn().mockResolvedValue(mockWorkspace),
      update: jest.fn().mockResolvedValue({ ...mockWorkspace, name: 'Updated' }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as PrismaClient;

  // $transaction calls the callback with the same db object
  (db as unknown as Record<string, unknown>)['$transaction'] = jest.fn(
    (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  );
  return db;
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let mockDb: ReturnType<typeof makeDb>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = makeDb();
    service = new WorkspacesService(mockDb);
  });

  // ── list ──────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('returns workspaces the user is a member of', async () => {
      const result = await service.list(USER_ID);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(WS_ID);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates workspace and adds creator as OWNER in a transaction', async () => {
      const result = await service.create(USER_ID, { name: 'My Workspace' });
      expect((mockDb.workspace.create as jest.Mock)).toHaveBeenCalledTimes(1);
      expect((mockDb.workspaceMember.create as jest.Mock)).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'OWNER' }) }),
      );
      expect(result.id).toBe(WS_ID);
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('returns workspace DTO when user is a member', async () => {
      const result = await service.getById(USER_ID, WS_ID);
      expect(result.id).toBe(WS_ID);
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getById(USER_ID, WS_ID)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('throws 404 when workspace is deleted mid-request', async () => {
      (mockDb.workspace.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getById(USER_ID, WS_ID)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates workspace when user is OWNER', async () => {
      const result = await service.update(USER_ID, WS_ID, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('updates workspace when user is ADMIN', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(adminMember);
      await expect(service.update(USER_ID, WS_ID, { name: 'Updated' })).resolves.toBeDefined();
    });

    it('throws 403 when user is a regular MEMBER', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(regularMember);
      await expect(service.update(USER_ID, WS_ID, { name: 'x' })).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.update(USER_ID, WS_ID, { name: 'x' })).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deletes workspace when user is OWNER', async () => {
      await service.delete(USER_ID, WS_ID);
      expect((mockDb.workspace.delete as jest.Mock)).toHaveBeenCalledTimes(1);
    });

    it('throws 403 when user is ADMIN (not OWNER)', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(adminMember);
      await expect(service.delete(USER_ID, WS_ID)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('throws 403 when user is not a member', async () => {
      (mockDb.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.delete(USER_ID, WS_ID)).rejects.toBeInstanceOf(HttpError);
    });
  });
});
