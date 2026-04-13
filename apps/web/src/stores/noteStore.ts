import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { NoteDTO } from '@shared/types';
import type { CreateNoteInput, UpdateNoteInput } from '@shared/schemas';
import api from '@web/lib/api';

interface NoteState {
  notes: NoteDTO[];
  isLoading: boolean;
  error: string | null;

  fetchNotes: (workspaceId: string) => Promise<void>;
  createNote: (workspaceId: string, data: CreateNoteInput) => Promise<void>;
  updateNote: (workspaceId: string, noteId: string, data: UpdateNoteInput) => Promise<void>;
  deleteNote: (workspaceId: string, noteId: string) => Promise<void>;
  handleSocketNoteCreated: (note: NoteDTO) => void;
  handleSocketNoteUpdated: (note: NoteDTO) => void;
  handleSocketNoteDeleted: (noteId: string) => void;
}

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred';
};

export const useNoteStore = create<NoteState>()(
  immer((set) => ({
    notes: [],
    isLoading: false,
    error: null,

    fetchNotes: async (workspaceId) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const { data } = await api.get<NoteDTO[]>(`/workspaces/${workspaceId}/notes`);
        set((state) => {
          state.notes = data;
        });
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err);
        });
      } finally {
        set((state) => {
          state.isLoading = false;
        });
      }
    },

    createNote: async (workspaceId, data) => {
      set((state) => {
        state.error = null;
      });
      try {
        const { data: note } = await api.post<NoteDTO>(`/workspaces/${workspaceId}/notes`, data);
        set((state) => {
          state.notes.unshift(note);
        });
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err);
        });
      }
    },

    updateNote: async (workspaceId, noteId, data) => {
      set((state) => {
        state.error = null;
      });
      try {
        const { data: note } = await api.patch<NoteDTO>(
          `/workspaces/${workspaceId}/notes/${noteId}`,
          data,
        );
        set((state) => {
          const index = state.notes.findIndex((n) => n.id === noteId);
          if (index !== -1) {
            state.notes[index] = note;
          }
        });
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err);
        });
      }
    },

    deleteNote: async (workspaceId, noteId) => {
      set((state) => {
        state.error = null;
      });
      try {
        await api.delete(`/workspaces/${workspaceId}/notes/${noteId}`);
        set((state) => {
          state.notes = state.notes.filter((n) => n.id !== noteId);
        });
      } catch (err) {
        set((state) => {
          state.error = getErrorMessage(err);
        });
      }
    },

    handleSocketNoteCreated: (note) => {
      set((state) => {
        const exists = state.notes.some((n) => n.id === note.id);
        if (!exists) {
          state.notes.unshift(note);
        }
      });
    },

    handleSocketNoteUpdated: (note) => {
      set((state) => {
        const index = state.notes.findIndex((n) => n.id === note.id);
        if (index !== -1) {
          state.notes[index] = note;
        }
      });
    },

    handleSocketNoteDeleted: (noteId) => {
      set((state) => {
        state.notes = state.notes.filter((n) => n.id !== noteId);
      });
    },
  }))
);
