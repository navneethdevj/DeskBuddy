import { UsersService } from './users.service';
import { HttpError } from '@api/utils/httpError';
import type { PrismaClient } from '@prisma/client';

// ── module mocks ──────────────────────────────────────────────────────────────
jest.mock('@api/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── test data ─────────────────────────────────────────────────────────────────
const USER_ID = 'user-cuid-01';

const mockUser = {
  id:        USER_ID,
  email:     'alice@example.com',
  name:      'Alice',
  avatarUrl: 'https://example.com/pic.jpg',
  googleId:  'g-abc123',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// ── helpers ───────────────────────────────────────────────────────────────────
function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(mockUser),
      update:     jest.fn().mockResolvedValue({ ...mockUser, name: 'Updated Name' }),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('UsersService', () => {
  let service: UsersService;
  let mockDb: ReturnType<typeof makeDb>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb  = makeDb();
    service = new UsersService(mockDb);
  });

  // ── getById ───────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('returns UserDTO when user exists', async () => {
      const result = await service.getById(USER_ID);
      expect(result.id).toBe(USER_ID);
      expect(result.email).toBe(mockUser.email);
      expect(result.name).toBe(mockUser.name);
    });

    it('maps avatarUrl to null when the field is null on the DB row', async () => {
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, avatarUrl: null });
      const result = await service.getById(USER_ID);
      expect(result.avatarUrl).toBeNull();
    });

    it('returns ISO strings for createdAt and updatedAt', async () => {
      const result = await service.getById(USER_ID);
      expect(result.createdAt).toBe(mockUser.createdAt.toISOString());
      expect(result.updatedAt).toBe(mockUser.updatedAt.toISOString());
    });

    it('queries by userId', async () => {
      await service.getById(USER_ID);
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({ where: { id: USER_ID } });
    });

    it('throws 404 when user is not found', async () => {
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getById(USER_ID)).rejects.toBeInstanceOf(HttpError);
      await expect(service.getById(USER_ID)).rejects.toMatchObject({
        statusCode: 404,
        code:       'NOT_FOUND',
      });
    });
  });

  // ── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates the user name and returns DTO', async () => {
      const result = await service.update(USER_ID, { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('passes only name when avatarUrl is not provided', async () => {
      await service.update(USER_ID, { name: 'New Name' });
      const call = (mockDb.user.update as jest.Mock).mock.calls[0][0];
      expect(call.data.name).toBe('New Name');
      expect(call.data.avatarUrl).toBeUndefined();
    });

    it('passes avatarUrl when provided', async () => {
      (mockDb.user.update as jest.Mock).mockResolvedValue({
        ...mockUser,
        avatarUrl: 'https://example.com/new.png',
      });
      const result = await service.update(USER_ID, { avatarUrl: 'https://example.com/new.png' });
      expect(result.avatarUrl).toBe('https://example.com/new.png');
    });

    it('passes both fields when both are provided', async () => {
      (mockDb.user.update as jest.Mock).mockResolvedValue({
        ...mockUser,
        name: 'Bob',
        avatarUrl: 'https://example.com/bob.png',
      });
      await service.update(USER_ID, { name: 'Bob', avatarUrl: 'https://example.com/bob.png' });
      const call = (mockDb.user.update as jest.Mock).mock.calls[0][0];
      expect(call.data.name).toBe('Bob');
      expect(call.data.avatarUrl).toBe('https://example.com/bob.png');
    });

    it('throws 404 when user does not exist', async () => {
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.update(USER_ID, { name: 'x' })).rejects.toMatchObject({
        statusCode: 404,
        code:       'NOT_FOUND',
      });
    });

    it('does not call db.user.update when user is not found', async () => {
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(null);
      await service.update(USER_ID, { name: 'x' }).catch(() => {});
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });
  });
});
