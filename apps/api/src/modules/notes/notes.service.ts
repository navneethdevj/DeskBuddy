import type { NoteDTO } from '@shared/types';
import type { CreateNoteInput, UpdateNoteInput } from '@shared/schemas';

export class NotesService {
  list(_userId: string, _workspaceId: string): Promise<NoteDTO[]> {
    throw new Error('Not implemented: list');
  }

  create(_userId: string, _workspaceId: string, _data: CreateNoteInput): Promise<NoteDTO> {
    throw new Error('Not implemented: create');
  }

  getById(_userId: string, _workspaceId: string, _noteId: string): Promise<NoteDTO> {
    throw new Error('Not implemented: getById');
  }

  update(
    _userId: string,
    _workspaceId: string,
    _noteId: string,
    _data: UpdateNoteInput
  ): Promise<NoteDTO> {
    throw new Error('Not implemented: update');
  }

  delete(_userId: string, _workspaceId: string, _noteId: string): Promise<void> {
    throw new Error('Not implemented: delete');
  }
}
