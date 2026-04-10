import type { Request, Response, NextFunction, RequestHandler } from 'express';

interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export const rateLimiter = ({ windowMs, max }: RateLimiterOptions): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
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
