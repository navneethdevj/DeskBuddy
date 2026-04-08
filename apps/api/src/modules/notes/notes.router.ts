import { Router, type Router as ExpressRouter } from 'express';
import type { RequestHandler } from 'express';
import { requireAuth } from '@api/middleware/auth';
import { rateLimiter } from '@api/middleware/rateLimiter';
import { validateBody } from '@api/middleware/validate';
import { CreateNoteSchema, UpdateNoteSchema } from '@shared/schemas';
import { NotesService } from './notes.service';

const router: ExpressRouter = Router({ mergeParams: true });
const notesService = new NotesService();
const apiLimiter = rateLimiter({ windowMs: 60_000, max: 100 });

// GET /api/v1/workspaces/:workspaceId/notes
const listNotes: RequestHandler<{ workspaceId: string }> = async (req, res, next): Promise<void> => {
  try {
    const notes = await notesService.list(req.user!.userId, req.params.workspaceId);
    res.json(notes);
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/workspaces/:workspaceId/notes
const createNote: RequestHandler<{ workspaceId: string }> = async (req, res, next): Promise<void> => {
  try {
    const note = await notesService.create(req.user!.userId, req.params.workspaceId, req.body);
    res.status(201).json(note);
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/workspaces/:workspaceId/notes/:id
const getNote: RequestHandler<{ workspaceId: string; id: string }> = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    const note = await notesService.getById(req.user!.userId, req.params.workspaceId, req.params.id);
    res.json(note);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/workspaces/:workspaceId/notes/:id
const updateNote: RequestHandler<{ workspaceId: string; id: string }> = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    const note = await notesService.update(
      req.user!.userId,
      req.params.workspaceId,
      req.params.id,
      req.body
    );
    res.json(note);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/workspaces/:workspaceId/notes/:id
const deleteNote: RequestHandler<{ workspaceId: string; id: string }> = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    await notesService.delete(req.user!.userId, req.params.workspaceId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

router.use(requireAuth);
router.use(apiLimiter);
router.get('/', listNotes);
router.post('/', validateBody(CreateNoteSchema), createNote);
router.get('/:id', getNote);
router.patch('/:id', validateBody(UpdateNoteSchema), updateNote);
router.delete('/:id', deleteNote);

export { router as notesRouter };
