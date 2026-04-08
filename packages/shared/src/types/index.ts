export type {
  User,
  CreateUserInput,
} from '../schemas/user.schema';

export type {
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceMember,
} from '../schemas/workspace.schema';

export type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
} from '../schemas/task.schema';

export type {
  Note,
  CreateNoteInput,
  UpdateNoteInput,
} from '../schemas/note.schema';

// DTO types (mapped from Prisma — defined alongside mappers in api, re-exported here)
export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDTO {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  assignee?: UserDTO;
  workspaceId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDTO {
  id: string;
  title: string;
  content: string;
  workspaceId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
