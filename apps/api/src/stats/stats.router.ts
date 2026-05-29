import { Router, type Router as ExpressRouter, type RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { StatsService } from './stats.service';

const router: ExpressRouter = Router();
const statsService = new StatsService();

const getMyStats: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const stats = await statsService.getStats(req.user!.userId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
};

router.use(requireAuth);
router.get('/me', getMyStats);

export { router as statsRouter };

