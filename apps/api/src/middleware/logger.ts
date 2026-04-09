import type { Request, Response, NextFunction } from 'express';
import { logger } from '@api/utils/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();

  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      },
      'Request completed'
    );
  });

  next();
};
