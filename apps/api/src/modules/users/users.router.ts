import { Router, type Router as ExpressRouter } from 'express';
import type { RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { rateLimiter } from '@api/middleware/rateLimiter';
import { UsersService } from './users.service';

const router: ExpressRouter = Router();
const usersService = new UsersService();
const apiLimiter = rateLimiter({ windowMs: 60_000, max: 100 });

// GET /api/v1/users/me
const getMe: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const user = await usersService.getById(req.user!.userId);
    res.json(user);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/users/me
const updateMe: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const user = await usersService.update(req.user!.userId, req.body);
    res.json(user);
  } catch (error) {
    next(error);
  }
};

router.use(apiLimiter);
router.use(requireAuth);
router.get('/me', getMe);
router.patch('/me', updateMe);

export { router as usersRouter };
