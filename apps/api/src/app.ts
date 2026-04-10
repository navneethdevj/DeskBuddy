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

app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(requestLogger);

// CSRF check for all state-mutating requests (POST/PUT/PATCH/DELETE).
// Bearer-token-protected routes are inherently CSRF-safe, but applying this
// globally prevents CodeQL warnings and adds defence-in-depth.
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
