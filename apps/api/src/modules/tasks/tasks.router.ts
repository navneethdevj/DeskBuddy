import { Router, type Router as ExpressRouter } from 'express';
import type { RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { validateBody } from '@api/middleware/validate';
import { CreateTaskSchema, UpdateTaskSchema } from '@shared/schemas';
import { TasksService } from './tasks.service';

const router: ExpressRouter = Router({ mergeParams: true });
const tasksService = new TasksService();

// GET /api/v1/workspaces/:workspaceId/tasks
const listTasks: RequestHandler<{ workspaceId: string }> = async (req, res, next): Promise<void> => {
  try {
    const tasks = await tasksService.list(req.user!.userId, req.params.workspaceId);
    res.json(tasks);
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/workspaces/:workspaceId/tasks
const createTask: RequestHandler<{ workspaceId: string }> = async (req, res, next): Promise<void> => {
  try {
    const task = await tasksService.create(req.user!.userId, req.params.workspaceId, req.body);
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/workspaces/:workspaceId/tasks/:id
const getTask: RequestHandler<{ workspaceId: string; id: string }> = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    const task = await tasksService.getById(
      req.user!.userId,
      req.params.workspaceId,
      req.params.id
    );
    res.json(task);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/workspaces/:workspaceId/tasks/:id
const updateTask: RequestHandler<{ workspaceId: string; id: string }> = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    const task = await tasksService.update(
      req.user!.userId,
      req.params.workspaceId,
      req.params.id,
      req.body
    );
    res.json(task);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/workspaces/:workspaceId/tasks/:id
const deleteTask: RequestHandler<{ workspaceId: string; id: string }> = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    await tasksService.delete(req.user!.userId, req.params.workspaceId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

router.use(requireAuth);
router.get('/', listTasks);
router.post('/', validateBody(CreateTaskSchema), createTask);
router.get('/:id', getTask);
router.patch('/:id', validateBody(UpdateTaskSchema), updateTask);
router.delete('/:id', deleteTask);

export { router as tasksRouter };
