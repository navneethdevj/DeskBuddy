import { Router, type Router as ExpressRouter } from 'express';
import type { RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { rateLimiter } from '@api/middleware/rateLimiter';
import { AuthService } from './auth.service';

const router: ExpressRouter = Router();
const authService = new AuthService();

// POST /api/v1/auth/google/callback
const googleCallback: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const result = await authService.handleGoogleCallback(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/auth/refresh
const refreshToken: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const result = await authService.refreshAccessToken(req.cookies['refreshToken'] as string);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/auth/logout
const logout: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    requireAuth(req, res, async () => {
      await authService.logout(req.user!.userId);
      res.clearCookie('refreshToken');
      res.status(204).send();
    });
  } catch (error) {
    next(error);
  }
};

router.post(
  '/google/callback',
  rateLimiter({ windowMs: 60_000, max: 10 }),
  googleCallback
);
router.post('/refresh', rateLimiter({ windowMs: 60_000, max: 20 }), refreshToken);
router.post('/logout', requireAuth, logout);

export { router as authRouter };
