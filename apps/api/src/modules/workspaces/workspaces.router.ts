import { Router, type Router as ExpressRouter } from 'express';
import type { RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { rateLimiter } from '@api/middleware/rateLimiter';
import { validateBody } from '@api/middleware/validate';
import { CreateWorkspaceSchema, UpdateWorkspaceSchema } from '@shared/schemas';
import { WorkspacesService } from './workspaces.service';

const router: ExpressRouter = Router();
const workspacesService = new WorkspacesService();
const apiLimiter = rateLimiter({ windowMs: 60_000, max: 100 });

// GET /api/v1/workspaces
const listWorkspaces: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const workspaces = await workspacesService.list(req.user!.userId);
    res.json(workspaces);
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/workspaces
const createWorkspace: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    const workspace = await workspacesService.create(req.user!.userId, req.body);
    res.status(201).json(workspace);
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/workspaces/:id
const getWorkspace: RequestHandler<{ id: string }> = async (req, res, next): Promise<void> => {
  try {
    const workspace = await workspacesService.getById(req.user!.userId, req.params.id);
    res.json(workspace);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/workspaces/:id
const updateWorkspace: RequestHandler<{ id: string }> = async (req, res, next): Promise<void> => {
  try {
    const workspace = await workspacesService.update(req.user!.userId, req.params.id, req.body);
    res.json(workspace);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/workspaces/:id
const deleteWorkspace: RequestHandler<{ id: string }> = async (req, res, next): Promise<void> => {
  try {
    await workspacesService.delete(req.user!.userId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

router.use(apiLimiter);
router.use(requireAuth);
router.get('/', listWorkspaces);
router.post('/', validateBody(CreateWorkspaceSchema), createWorkspace);
router.get('/:id', getWorkspace);
router.patch('/:id', validateBody(UpdateWorkspaceSchema), updateWorkspace);
router.delete('/:id', deleteWorkspace);

export { router as workspacesRouter };
