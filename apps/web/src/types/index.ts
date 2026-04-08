// Re-export all types from @shared/types — never redefine in frontend
export type {
  UserDTO,
  WorkspaceDTO,
  TaskDTO,
  NoteDTO,
  User,
  Workspace,
  Task,
  Note,
  CreateUserInput,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  CreateTaskInput,
  UpdateTaskInput,
  CreateNoteInput,
  UpdateNoteInput,
} from '@shared/types';
