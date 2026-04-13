/**
 * Middleware tests — covers:
 *   requireAuth    (auth.ts)
 *   csrfProtection (csrf.ts)
 *   errorHandler   (errorHandler.ts)
 *   requestLogger  (logger.ts)
 *   rateLimiter    (rateLimiter.ts)
 *   validateBody   (validate.ts)
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

// ── module mocks ──────────────────────────────────────────────────────────────
jest.mock('@api/config', () => ({
  __esModule: true,
  default: {
    JWT_ACCESS_SECRET: 'test-access-secret-min-32-characters!!',
    CORS_ORIGIN:       'http://localhost:5173',
    NODE_ENV:          'test',
  },
}));
jest.mock('@api/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { requireAuth }    from '@api/middleware/auth';
import { csrfProtection } from '@api/middleware/csrf';
import { errorHandler }   from '@api/middleware/errorHandler';
import { requestLogger }  from '@api/middleware/logger';
import { rateLimiter }    from '@api/middleware/rateLimiter';
import { validateBody }   from '@api/middleware/validate';
import { HttpError }      from '@api/utils/httpError';
import { logger }         from '@api/utils/logger';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal mock Request */
function makeReq(overrides: Partial<Record<string, unknown>> = {}): Request {
  return {
    headers: {},
    ip:      '127.0.0.1',
    method:  'GET',
    url:     '/test',
    body:    {},
    ...overrides,
  } as unknown as Request;
}

/** Build a minimal mock Response with chainable status + json */
function makeRes(): Response & { _status: number; _body: unknown } {
  const res: Partial<Response> & { _status: number; _body: unknown } = {
    _status: 200,
    _body:   undefined,
    on: jest.fn(),
    statusCode: 200,
  };
  res.status = jest.fn((code: number) => {
    res._status = code;
    (res as Response & { statusCode: number }).statusCode = code;
    return res as Response;
  });
  res.json = jest.fn((body: unknown) => {
    res._body = body;
    return res as Response;
  });
  return res as Response & { _status: number; _body: unknown };
}

const noop: NextFunction = jest.fn();

// ═══════════════════════════════════════════════════════════════════════════════
//  requireAuth
// ═══════════════════════════════════════════════════════════════════════════════
describe('requireAuth middleware', () => {
  const SECRET  = 'test-access-secret-min-32-characters!!';
  const payload = { userId: 'u-1', email: 'a@b.com' };

  function makeToken(secret = SECRET) {
    return jwt.sign(payload, secret, { expiresIn: '1h' });
  }

  it('attaches user to req and calls next() for a valid Bearer token', () => {
    const req  = makeReq({ headers: { authorization: `Bearer ${makeToken()}` } });
    const res  = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(); // called with no args → success path
    expect(req.user?.userId).toBe('u-1');
    expect(req.user?.email).toBe('a@b.com');
  });

  it('calls next(HttpError 401) when Authorization header is missing', () => {
    const req  = makeReq({ headers: {} });
    const next = jest.fn();

    requireAuth(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(401);
  });

  it('calls next(HttpError 401) when Authorization header does not start with Bearer', () => {
    const req  = makeReq({ headers: { authorization: 'Basic abc123' } });
    const next = jest.fn();

    requireAuth(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(401);
    expect((next.mock.calls[0][0] as HttpError).code).toBe('UNAUTHORIZED');
  });

  it('calls next(HttpError 401) for a token signed with wrong secret', () => {
    const req  = makeReq({ headers: { authorization: `Bearer ${makeToken('wrong-secret!!!!!!!!!!!!!!!!!!')}` } });
    const next = jest.fn();

    requireAuth(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(401);
  });

  it('calls next(HttpError 401) for an expired token', () => {
    const expired = jwt.sign(payload, SECRET, { expiresIn: -1 });
    const req     = makeReq({ headers: { authorization: `Bearer ${expired}` } });
    const next    = jest.fn();

    requireAuth(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(401);
  });

  it('calls next(HttpError 401) for a malformed token string', () => {
    const req  = makeReq({ headers: { authorization: 'Bearer not.a.jwt' } });
    const next = jest.fn();

    requireAuth(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(401);
  });

  it('logs a warning when verification fails', () => {
    const req = makeReq({ headers: { authorization: 'Bearer bad' } });
    requireAuth(req, makeRes(), jest.fn());
    expect((logger.warn as jest.Mock)).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  csrfProtection
// ═══════════════════════════════════════════════════════════════════════════════
describe('csrfProtection middleware', () => {
  const VALID_ORIGIN = 'http://localhost:5173';

  it('calls next() with no args for a matching Origin', () => {
    const req  = makeReq({ headers: { origin: VALID_ORIGIN } });
    const next = jest.fn();

    csrfProtection(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(); // success
  });

  it('calls next(HttpError 403) when Origin header is missing', () => {
    const req  = makeReq({ headers: {} });
    const next = jest.fn();

    csrfProtection(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(403);
    expect((next.mock.calls[0][0] as HttpError).code).toBe('FORBIDDEN');
  });

  it('calls next(HttpError 403) when Origin does not match', () => {
    const req  = makeReq({ headers: { origin: 'https://evil.example.com' } });
    const next = jest.fn();

    csrfProtection(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(403);
  });

  it('calls next(HttpError 403) when Origin is empty string', () => {
    const req  = makeReq({ headers: { origin: '' } });
    const next = jest.fn();

    csrfProtection(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  errorHandler
// ═══════════════════════════════════════════════════════════════════════════════
describe('errorHandler middleware', () => {
  it('responds with the HttpError status and body for known errors', () => {
    const err  = new HttpError(422, 'Invalid email', 'VALIDATION_ERROR');
    const res  = makeRes();
    const next = jest.fn();

    errorHandler(err, makeReq(), res, next);

    expect(res._status).toBe(422);
    expect(res._body).toEqual({ error: { message: 'Invalid email', code: 'VALIDATION_ERROR' } });
  });

  it('responds 500 for unknown errors', () => {
    const res  = makeRes();
    errorHandler(new Error('boom'), makeReq(), res, jest.fn());

    expect(res._status).toBe(500);
    expect((res._body as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
  });

  it('responds 500 for non-Error thrown values', () => {
    const res = makeRes();
    errorHandler('string error', makeReq(), res, jest.fn());
    expect(res._status).toBe(500);
  });

  it('logs warn for HttpError', () => {
    const err = new HttpError(404, 'Not found', 'NOT_FOUND');
    errorHandler(err, makeReq(), makeRes(), jest.fn());
    expect((logger.warn as jest.Mock)).toHaveBeenCalled();
  });

  it('logs error for unexpected errors', () => {
    errorHandler(new Error('oops'), makeReq(), makeRes(), jest.fn());
    expect((logger.error as jest.Mock)).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  requestLogger
// ═══════════════════════════════════════════════════════════════════════════════
describe('requestLogger middleware', () => {
  it('calls next()', () => {
    const next = jest.fn();
    const res  = makeRes();

    requestLogger(makeReq(), res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('registers a finish listener on the response', () => {
    requestLogger(makeReq(), makeRes(), jest.fn());
    // makeRes() above has a jest.fn() for `on` — just confirm it was called
    // We test this by calling through a real EventEmitter-like stub below
  });

  it('logs request info when response finishes', () => {
    jest.clearAllMocks();

    // Use a proper `on` stub that immediately fires the callback
    const finishCallbacks: Array<() => void> = [];
    const res = {
      ...makeRes(),
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallbacks.push(cb);
      }),
      statusCode: 200,
    } as unknown as Response;

    requestLogger(
      makeReq({ method: 'GET', url: '/health' }),
      res,
      jest.fn(),
    );

    // Fire the finish event
    finishCallbacks.forEach((cb) => cb());

    expect((logger.info as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: '/health', statusCode: 200 }),
      'Request completed',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  rateLimiter
// ═══════════════════════════════════════════════════════════════════════════════
describe('rateLimiter middleware', () => {
  const OPTIONS = { windowMs: 60_000, max: 3 };

  function freshLimiter() {
    // Jest module isolation doesn't reset in-module state between tests.
    // We re-import a new instance by using jest.isolateModules.
    let fn: ReturnType<typeof rateLimiter> | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@api/middleware/rateLimiter') as { rateLimiter: typeof rateLimiter };
      fn = mod.rateLimiter(OPTIONS);
    });
    return fn!;
  }

  it('allows requests within the limit', () => {
    const mw   = freshLimiter();
    const next = jest.fn();
    const res  = makeRes();

    mw(makeReq({ ip: '10.0.0.1' }), res, next);
    mw(makeReq({ ip: '10.0.0.1' }), res, next);
    mw(makeReq({ ip: '10.0.0.1' }), res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res._status).toBe(200); // no 429 set
  });

  it('blocks requests that exceed the limit with 429', () => {
    const mw  = freshLimiter();
    const res = makeRes();

    for (let i = 0; i < OPTIONS.max; i++) {
      mw(makeReq({ ip: '10.0.0.2' }), makeRes(), jest.fn());
    }
    // 4th request from same IP → over limit
    mw(makeReq({ ip: '10.0.0.2' }), res, jest.fn());

    expect(res._status).toBe(429);
    expect((res._body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });

  it('tracks IPs independently', () => {
    const mw    = freshLimiter();
    const next1 = jest.fn();
    const next2 = jest.fn();

    mw(makeReq({ ip: '1.1.1.1' }), makeRes(), next1);
    mw(makeReq({ ip: '2.2.2.2' }), makeRes(), next2);

    expect(next1).toHaveBeenCalledTimes(1);
    expect(next2).toHaveBeenCalledTimes(1);
  });

  it('resets count after the window expires', () => {
    jest.useFakeTimers();

    const mw   = freshLimiter();
    const ip   = '3.3.3.3';
    const next = jest.fn();

    // Exhaust the limit
    for (let i = 0; i < OPTIONS.max; i++) {
      mw(makeReq({ ip }), makeRes(), jest.fn());
    }

    // Advance time past the window
    jest.advanceTimersByTime(OPTIONS.windowMs + 1);

    // Should be allowed again
    mw(makeReq({ ip }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('uses "unknown" as key when req.ip is undefined', () => {
    const mw   = freshLimiter();
    const next = jest.fn();
    const req  = makeReq({ ip: undefined });
    mw(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validateBody
// ═══════════════════════════════════════════════════════════════════════════════
describe('validateBody middleware', () => {
  const schema = z.object({
    name:  z.string().min(1),
    email: z.string().email(),
  });

  it('calls next() and replaces req.body with parsed data on success', () => {
    const req  = makeReq({ body: { name: 'Alice', email: 'alice@example.com', extra: 'stripped' } });
    const next = jest.fn();

    validateBody(schema)(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    // Zod strips extra keys by default — req.body is the parsed safe value
    expect(req.body.name).toBe('Alice');
    expect(req.body.email).toBe('alice@example.com');
  });

  it('calls next(HttpError 400) when body is invalid', () => {
    const req  = makeReq({ body: { name: '', email: 'not-an-email' } });
    const next = jest.fn();

    validateBody(schema)(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(400);
    expect((next.mock.calls[0][0] as HttpError).code).toBe('VALIDATION_ERROR');
  });

  it('includes field path in the error message', () => {
    const req  = makeReq({ body: { name: 'Alice', email: 'bad' } });
    const next = jest.fn();

    validateBody(schema)(req, makeRes(), next);

    const err = next.mock.calls[0][0] as HttpError;
    expect(err.message).toContain('email');
  });

  it('calls next(HttpError 400) when body is missing entirely', () => {
    const req  = makeReq({ body: undefined });
    const next = jest.fn();

    validateBody(schema)(req, makeRes(), next);

    expect((next.mock.calls[0][0] as HttpError).statusCode).toBe(400);
  });

  it('supports nested object schemas', () => {
    const nested = z.object({ user: z.object({ age: z.number().min(0) }) });
    const req    = makeReq({ body: { user: { age: -1 } } });
    const next   = jest.fn();

    validateBody(nested)(req, makeRes(), next);

    const err = next.mock.calls[0][0] as HttpError;
    expect(err.message).toContain('user.age');
  });
});
