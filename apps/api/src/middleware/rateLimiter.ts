import type { Request, Response, NextFunction, RequestHandler } from 'express';

interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

const requestCounts = new Map<string, { count: number; resetAt: number }>();

/** Prune entries whose window has already expired to prevent unbounded Map growth. */
const pruneExpired = (now: number): void => {
  for (const [key, record] of requestCounts) {
    if (now > record.resetAt) {
      requestCounts.delete(key);
    }
  }
};

export const rateLimiter = ({ windowMs, max }: RateLimiterOptions): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();

    // Opportunistically clean up stale entries on each request.
    // Amortised O(n) — fine for typical API traffic volumes.
    pruneExpired(now);

    const record = requestCounts.get(key);

    if (!record || now > record.resetAt) {
      requestCounts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (record.count >= max) {
      res.status(429).json({ error: { message: 'Too many requests', code: 'RATE_LIMITED' } });
      return;
    }

    record.count += 1;
    next();
  };

/** Exposed for testing — clears all tracked state. */
export const _resetRateLimiterState = (): void => {
  requestCounts.clear();
};
