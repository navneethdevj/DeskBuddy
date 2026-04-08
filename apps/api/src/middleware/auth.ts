import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '@api/config';
import { HttpError } from '@api/utils/httpError';
import { logger } from '@api/utils/logger';

export interface AuthPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    next(new HttpError(401, 'Missing or invalid authorization header', 'UNAUTHORIZED'));
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch (error) {
    logger.warn({ error }, 'JWT verification failed');
    next(new HttpError(401, 'Invalid or expired token', 'UNAUTHORIZED'));
  }
};
