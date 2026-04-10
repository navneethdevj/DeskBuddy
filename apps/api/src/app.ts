import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import config from '@api/config';
import { errorHandler } from '@api/middleware/errorHandler';
import { requestLogger } from '@api/middleware/logger';
import { csrfProtection } from '@api/middleware/csrf';
import { authRouter } from '@api/modules/auth/auth.router';
import { usersRouter } from '@api/modules/users/users.router';
import { workspacesRouter } from '@api/modules/workspaces/workspaces.router';
import { tasksRouter } from '@api/modules/tasks/tasks.router';
import { notesRouter } from '@api/modules/notes/notes.router';

const app: Application = express();

// §5.6 — Security response headers (helmet-equivalent, no extra dependency).
// Applied before any route handler so every response carries these headers.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-XSS-Protection', '0'); // disable legacy buggy browser filter
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(requestLogger);

// CSRF check for all state-mutating requests (POST/PUT/PATCH/DELETE).
// All API routes that perform mutations are protected by one of two mechanisms:
//  1. Bearer JWT in the Authorization header — inherently CSRF-safe because
//     cross-origin requests cannot set custom Authorization headers.
//  2. Cookie-based refresh (/auth/refresh) — explicitly guarded by the
//     csrfProtection middleware that validates the Origin header.
// Applying csrfProtection globally here provides defence-in-depth and ensures
// any future cookie-based route is covered without extra configuration.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req: Request, res: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(req.method)) return next();
  csrfProtection(req, res, next);
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/workspaces', workspacesRouter);
app.use('/api/v1/workspaces/:workspaceId/tasks', tasksRouter);
app.use('/api/v1/workspaces/:workspaceId/notes', notesRouter);

app.use(errorHandler);

export { app };
