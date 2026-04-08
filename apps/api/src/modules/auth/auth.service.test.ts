import axios from 'axios';
import jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';
import type { RedisGetter } from '@api/db/redis';
import type { PrismaClient } from '@prisma/client';

// ── module mocks ─────────────────────────────────────────────────────────────
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
}));
jest.mock('@api/config', () => ({
  __esModule: true,
  default: {
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3000/cb',
    JWT_ACCESS_SECRET: 'test-access-secret-min-32-characters!!',
    JWT_ACCESS_EXPIRES_IN: '15m',
    NODE_ENV: 'test',
  },
}));
jest.mock('@api/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── helpers ──────────────────────────────────────────────────────────────────
const mockUser = {
  id: 'user-cuid-01',
  email: 'alice@example.com',
  name: 'Alice',
  avatarUrl: 'https://example.com/pic.jpg',
  googleId: 'g-abc123',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const googleProfile = {
  id: mockUser.googleId,
  email: mockUser.email,
  name: mockUser.name,
  picture: mockUser.avatarUrl,
};

const axiosMock = axios as jest.Mocked<typeof axios>;

interface RedisMock { get: jest.Mock; set: jest.Mock; del: jest.Mock }
function makeRedis(overrides: Partial<RedisMock> = {}): RedisMock {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('AuthService', () => {
  let service: AuthService;
  let mockDb: Pick<PrismaClient, 'user'>;
  let mockRedis: RedisMock;
  let mockGetRedis: RedisGetter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = makeRedis();
    mockGetRedis = jest.fn().mockResolvedValue(mockRedis);
    mockDb = {
      user: {
        upsert: jest.fn().mockResolvedValue(mockUser),
        findUnique: jest.fn().mockResolvedValue(mockUser),
      } as unknown as PrismaClient['user'],
    };
    service = new AuthService(mockDb as PrismaClient, mockGetRedis);
  });

  // ── handleGoogleCallback ───────────────────────────────────────────────────
  describe('handleGoogleCallback', () => {
    beforeEach(() => {
      (axiosMock.post as jest.Mock).mockResolvedValue({ data: { access_token: 'gat' } });
      (axiosMock.get as jest.Mock).mockResolvedValue({ data: googleProfile });
    });

    it('exchanges code, upserts user, stores refresh token, and returns tokens', async () => {
      const result = await service.handleGoogleCallback({ code: 'auth-code' });

      expect(axiosMock.post).toHaveBeenCalledTimes(1);
      expect(axiosMock.get).toHaveBeenCalledTimes(1);
      expect((mockDb.user as jest.Mocked<PrismaClient['user']>).upsert).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledTimes(1);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toContain(mockUser.id);
      expect(result.user.email).toBe(mockUser.email);

      // access token should be a valid JWT
      const decoded = jwt.decode(result.accessToken) as Record<string, unknown>;
      expect(decoded['userId']).toBe(mockUser.id);
      expect(decoded['email']).toBe(mockUser.email);
    });

    it('throws UNAUTHORIZED when Google token exchange fails', async () => {
      (axiosMock.post as jest.Mock).mockRejectedValue(new Error('network'));
      await expect(service.handleGoogleCallback({ code: 'bad' })).rejects.toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('throws UNAUTHORIZED when Google userinfo fetch fails', async () => {
      (axiosMock.get as jest.Mock).mockRejectedValue(new Error('network'));
      await expect(service.handleGoogleCallback({ code: 'code' })).rejects.toMatchObject({
        statusCode: 401,
      });
    });
  });

  // ── refreshAccessToken ─────────────────────────────────────────────────────
  describe('refreshAccessToken', () => {
    const opaqueToken = 'a'.repeat(64); // 32 bytes hex

    it('issues new access + rotated refresh token when token is valid', async () => {
      mockRedis.get.mockResolvedValue(opaqueToken);

      const result = await service.refreshAccessToken(`${mockUser.id}:${opaqueToken}`);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toContain(mockUser.id);
      // old token was replaced
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      const decoded = jwt.decode(result.accessToken) as Record<string, unknown>;
      expect(decoded['userId']).toBe(mockUser.id);
    });

    it('throws UNAUTHORIZED when refresh token is empty', async () => {
      await expect(service.refreshAccessToken('')).rejects.toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('throws UNAUTHORIZED when refresh token has no colon separator', async () => {
      await expect(service.refreshAccessToken('invalidtoken')).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it('throws UNAUTHORIZED when stored token does not match provided token', async () => {
      mockRedis.get.mockResolvedValue('stored-opaque-different');
      await expect(
        service.refreshAccessToken(`${mockUser.id}:wrong-opaque-token`),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('throws UNAUTHORIZED and cleans up Redis when user is deleted', async () => {
      mockRedis.get.mockResolvedValue(opaqueToken);
      (mockDb.user as jest.Mocked<PrismaClient['user']>).findUnique = jest
        .fn()
        .mockResolvedValue(null);

      await expect(
        service.refreshAccessToken(`${mockUser.id}:${opaqueToken}`),
      ).rejects.toMatchObject({ statusCode: 401 });

      expect(mockRedis.del).toHaveBeenCalledWith(`rt:${mockUser.id}`);
    });
  });

  // ── logout ────────────────────────────────────────────────────────────────
  describe('logout', () => {
    it('deletes the refresh token from Redis', async () => {
      await service.logout(mockUser.id);
      expect(mockRedis.del).toHaveBeenCalledWith(`rt:${mockUser.id}`);
    });
  });
});
