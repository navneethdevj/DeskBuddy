/**
 * Tests for utils/mappers.ts, utils/httpError.ts, and db/redis.ts
 */

// ── module mocks (must appear before any imports that need them) ─────────────
jest.mock('@api/config', () => ({
  __esModule: true,
  default: {
    REDIS_URL: 'redis://localhost:6379',
  },
}));
jest.mock('@api/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── imports ──────────────────────────────────────────────────────────────────
import { HttpError }                            from '@api/utils/httpError';
import { toUserDTO, toWorkspaceDTO, toTaskDTO, toNoteDTO } from '@api/utils/mappers';
import type { Prisma }                          from '@prisma/client';

// ═══════════════════════════════════════════════════════════════════════════════
//  HttpError
// ═══════════════════════════════════════════════════════════════════════════════
describe('HttpError', () => {
  it('stores statusCode, message, and code', () => {
    const err = new HttpError(404, 'Not found', 'NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.code).toBe('NOT_FOUND');
  });

  it('defaults code to INTERNAL_ERROR', () => {
    const err = new HttpError(500, 'Oops');
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('is an instance of Error', () => {
    expect(new HttpError(400, 'bad')).toBeInstanceOf(Error);
  });

  it('has name "HttpError"', () => {
    expect(new HttpError(400, 'bad').name).toBe('HttpError');
  });

  it('captures a stack trace', () => {
    const err = new HttpError(400, 'bad');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('HttpError');
  });

  it('works with various HTTP status codes', () => {
    [400, 401, 403, 404, 409, 422, 429, 500, 503].forEach((code) => {
      expect(new HttpError(code, 'msg').statusCode).toBe(code);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Mappers
// ═══════════════════════════════════════════════════════════════════════════════
describe('mappers', () => {
  const baseDate = new Date('2024-06-01T00:00:00.000Z');

  // ── toUserDTO ──────────────────────────────────────────────────────────────
  describe('toUserDTO', () => {
    const prismaUser: Prisma.UserGetPayload<Record<string, never>> = {
      id:        'u-1',
      email:     'alice@example.com',
      name:      'Alice',
      avatarUrl: 'https://example.com/pic.jpg',
      googleId:  'g-abc',
      createdAt: baseDate,
      updatedAt: baseDate,
    };

    it('maps all fields correctly', () => {
      const dto = toUserDTO(prismaUser);
      expect(dto.id).toBe('u-1');
      expect(dto.email).toBe('alice@example.com');
      expect(dto.name).toBe('Alice');
      expect(dto.avatarUrl).toBe('https://example.com/pic.jpg');
      expect(dto.createdAt).toBe(baseDate.toISOString());
      expect(dto.updatedAt).toBe(baseDate.toISOString());
    });

    it('maps null avatarUrl correctly', () => {
      const dto = toUserDTO({ ...prismaUser, avatarUrl: null });
      expect(dto.avatarUrl).toBeNull();
    });

    it('does not include googleId in the DTO', () => {
      const dto = toUserDTO(prismaUser);
      expect((dto as unknown as Record<string, unknown>).googleId).toBeUndefined();
    });
  });

  // ── toWorkspaceDTO ─────────────────────────────────────────────────────────
  describe('toWorkspaceDTO', () => {
    const prismaWs: Prisma.WorkspaceGetPayload<Record<string, never>> = {
      id:          'ws-1',
      name:        'My Workspace',
      description: 'A nice place',
      ownerId:     'u-1',
      createdAt:   baseDate,
      updatedAt:   baseDate,
    };

    it('maps all fields correctly', () => {
      const dto = toWorkspaceDTO(prismaWs);
      expect(dto.id).toBe('ws-1');
      expect(dto.name).toBe('My Workspace');
      expect(dto.description).toBe('A nice place');
      expect(dto.ownerId).toBe('u-1');
      expect(dto.createdAt).toBe(baseDate.toISOString());
    });

    it('maps null description correctly', () => {
      const dto = toWorkspaceDTO({ ...prismaWs, description: null });
      expect(dto.description).toBeNull();
    });
  });

  // ── toTaskDTO ──────────────────────────────────────────────────────────────
  describe('toTaskDTO', () => {
    const prismaUser: Prisma.UserGetPayload<Record<string, never>> = {
      id: 'u-2', email: 'bob@example.com', name: 'Bob',
      avatarUrl: null, googleId: null, createdAt: baseDate, updatedAt: baseDate,
    };

    const prismaTask: Prisma.TaskGetPayload<{ include: { assignee: true } }> = {
      id:          'task-1',
      title:       'Fix bug',
      description: 'See issue #42',
      status:      'IN_PROGRESS',
      assigneeId:  'u-2',
      assignee:    prismaUser,
      workspaceId: 'ws-1',
      createdBy:   'u-1',
      createdAt:   baseDate,
      updatedAt:   baseDate,
    };

    it('maps all fields including assignee DTO', () => {
      const dto = toTaskDTO(prismaTask);
      expect(dto.id).toBe('task-1');
      expect(dto.title).toBe('Fix bug');
      expect(dto.description).toBe('See issue #42');
      expect(dto.status).toBe('IN_PROGRESS');
      expect(dto.assignee?.id).toBe('u-2');
      expect(dto.workspaceId).toBe('ws-1');
      expect(dto.createdBy).toBe('u-1');
    });

    it('maps null description correctly', () => {
      const dto = toTaskDTO({ ...prismaTask, description: null });
      expect(dto.description).toBeNull();
    });

    it('maps null assignee to undefined', () => {
      const dto = toTaskDTO({ ...prismaTask, assignee: null, assigneeId: null });
      expect(dto.assignee).toBeUndefined();
    });

    it('maps all three task status values', () => {
      (['TODO', 'IN_PROGRESS', 'DONE'] as const).forEach((s) => {
        const dto = toTaskDTO({ ...prismaTask, status: s });
        expect(dto.status).toBe(s);
      });
    });
  });

  // ── toNoteDTO ──────────────────────────────────────────────────────────────
  describe('toNoteDTO', () => {
    const prismaNote: Prisma.NoteGetPayload<Record<string, never>> = {
      id:          'note-1',
      title:       'Stand-up',
      content:     'Discussed X',
      workspaceId: 'ws-1',
      createdBy:   'u-1',
      createdAt:   baseDate,
      updatedAt:   baseDate,
    };

    it('maps all fields correctly', () => {
      const dto = toNoteDTO(prismaNote);
      expect(dto.id).toBe('note-1');
      expect(dto.title).toBe('Stand-up');
      expect(dto.content).toBe('Discussed X');
      expect(dto.workspaceId).toBe('ws-1');
      expect(dto.createdBy).toBe('u-1');
      expect(dto.createdAt).toBe(baseDate.toISOString());
      expect(dto.updatedAt).toBe(baseDate.toISOString());
    });

    it('maps empty content correctly', () => {
      const dto = toNoteDTO({ ...prismaNote, content: '' });
      expect(dto.content).toBe('');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  db/redis
// ═══════════════════════════════════════════════════════════════════════════════
describe('redis module', () => {
  const mockQuit    = jest.fn().mockResolvedValue(undefined);
  const mockConnect = jest.fn().mockResolvedValue(undefined);
  const mockOn      = jest.fn();

  const mockRedisClient = {
    connect:  mockConnect,
    quit:     mockQuit,
    on:       mockOn,
    isOpen:   true,
    get:      jest.fn(),
    set:      jest.fn(),
    del:      jest.fn(),
  };

  jest.mock('redis', () => ({
    createClient: jest.fn(() => mockRedisClient),
  }));

  // Force re-import to pick up the mock
  let getRedis:   typeof import('@api/db/redis').getRedis;
  let closeRedis: typeof import('@api/db/redis').closeRedis;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    jest.mock('@api/config', () => ({
      __esModule: true,
      default: { REDIS_URL: 'redis://localhost:6379' },
    }));
    jest.mock('@api/utils/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));
    jest.mock('redis', () => ({
      createClient: jest.fn(() => ({ ...mockRedisClient, isOpen: true })),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@api/db/redis') as typeof import('@api/db/redis');
    getRedis   = mod.getRedis;
    closeRedis = mod.closeRedis;
  });

  it('connects on first call and returns a RedisOps-compatible client', async () => {
    const client = await getRedis();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(client).toBeDefined();
  });

  it('reuses the same client on subsequent calls (singleton)', async () => {
    await getRedis();
    await getRedis();
    // createClient should only be called once — second call reuses cached client
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('redis') as { createClient: jest.Mock };
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('registers an error listener', async () => {
    await getRedis();
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('closeRedis quits and nullifies the client when isOpen', async () => {
    await getRedis();     // ensure client is initialised
    await closeRedis();
    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it('closeRedis is a no-op when no client is initialised', async () => {
    // Never called getRedis — should not throw
    await expect(closeRedis()).resolves.toBeUndefined();
    expect(mockQuit).not.toHaveBeenCalled();
  });
});
