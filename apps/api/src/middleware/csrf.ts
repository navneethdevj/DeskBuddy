import type { Request, Response, NextFunction, RequestHandler } from 'express';
import config from '@api/config';
import { HttpError } from '@api/utils/httpError';

/**
 * Validates that the request Origin header matches the configured CORS origin.
 * Applied to state-mutating endpoints that rely on httpOnly cookies (e.g. /auth/refresh).
 * Endpoints protected by Authorization: Bearer header are inherently CSRF-safe.
 */
export const csrfProtection: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const origin = req.headers['origin'];

  if (!origin || origin !== config.CORS_ORIGIN) {
    next(new HttpError(403, 'CSRF check failed: invalid origin', 'FORBIDDEN'));
    return;
  }

  next();
};
