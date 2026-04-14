import { useEffect } from 'react';
import { useNoteStore } from '@web/stores/noteStore';
import type { NoteDTO } from '@shared/types';
import type { CreateNoteInput, UpdateNoteInput } from '@shared/schemas';

interface UseNoteReturn {
  notes: NoteDTO[];
  isLoading: boolean;
  error: string | null;
  createNote: (data: CreateNoteInput) => Promise<void>;
  updateNote: (noteId: string, data: UpdateNoteInput) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
}

export const useNote = (workspaceId: string | null): UseNoteReturn => {
  const { notes, isLoading, error, fetchNotes, createNote, updateNote, deleteNote } =
    useNoteStore();

  useEffect(() => {
    if (workspaceId) {
      void fetchNotes(workspaceId);
    }
  }, [workspaceId, fetchNotes]);

  return {
    notes,
    isLoading,
    error,
    createNote: (data) => (workspaceId ? createNote(workspaceId, data) : Promise.resolve()),
    updateNote: (noteId, data) =>
      workspaceId ? updateNote(workspaceId, noteId, data) : Promise.resolve(),
    deleteNote: (noteId) =>
      workspaceId ? deleteNote(workspaceId, noteId) : Promise.resolve(),
  };
};
