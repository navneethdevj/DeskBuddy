import { Router, type Router as ExpressRouter, type RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { MissionsService } from './missions.service';

const router: ExpressRouter = Router();
const missionsService = new MissionsService();

const getTodayMissions: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const missions = await missionsService.ensureDailyMissions(req.user!.userId);
    res.json(missions);
  } catch (error) {
    next(error);
  }
};

router.use(requireAuth);
router.get('/today', getTodayMissions);

export { router as missionsRouter };
