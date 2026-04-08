import { Router, type Router as ExpressRouter } from 'express';
import type { RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { UsersService } from './users.service';

const router: ExpressRouter = Router();
const usersService = new UsersService();

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

router.use(requireAuth);
router.get('/me', getMe);
router.patch('/me', updateMe);

export { router as usersRouter };
