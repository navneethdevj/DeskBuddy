import { Router, type Router as ExpressRouter } from 'express';
import type { RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { rateLimiter } from '@api/middleware/rateLimiter';
import { csrfProtection } from '@api/middleware/csrf';
import config from '@api/config';
import { AuthService } from './auth.service';

const router: ExpressRouter = Router();
const authService = new AuthService();

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: REFRESH_COOKIE_MAX_AGE_MS,
};

// POST /api/v1/auth/google/callback
const googleCallback: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const { accessToken, refreshToken, user } = await authService.handleGoogleCallback(req.body);
    res.cookie('refreshToken', refreshToken, cookieOptions);
    res.json({ accessToken, user });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/auth/refresh
const refresh: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const cookie = req.cookies['refreshToken'] as string | undefined;
    const { accessToken, refreshToken } = await authService.refreshAccessToken(cookie ?? '');
    res.cookie('refreshToken', refreshToken, cookieOptions);
    res.json({ accessToken });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/auth/logout
const logout: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    await authService.logout(req.user!.userId);
    res.clearCookie('refreshToken');
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

router.post(
  '/google/callback',
  rateLimiter({ windowMs: 60_000, max: 10 }),
  googleCallback,
);
router.post('/refresh', rateLimiter({ windowMs: 60_000, max: 20 }), csrfProtection, refresh);
router.post('/logout', requireAuth, rateLimiter({ windowMs: 60_000, max: 20 }), logout);

export { router as authRouter };
