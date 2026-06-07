export type { User, CreateUserInput, } from '../schemas/user.schema';
export type { Workspace, CreateWorkspaceInput, UpdateWorkspaceInput, WorkspaceMember, } from '../schemas/workspace.schema';
export type { Task, CreateTaskInput, UpdateTaskInput, } from '../schemas/task.schema';
export type { Note, CreateNoteInput, UpdateNoteInput, } from '../schemas/note.schema';
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
export interface LabelDTO {
    id: string;
    name: string;
    color: string;
}
export interface TaskDTO {
    id: string;
    title: string;
    description: string | null;
    status: 'TODO' | 'IN_PROGRESS' | 'DONE';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    dueDate: string | null;
    position: number;
    labels: LabelDTO[];
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
export interface UserStatsDTO {
    currentStreak: number;
    longestStreak: number;
    totalTasksDone: number;
    totalXP: number;
}
export interface DailyMissionDTO {
    id: string;
    missionType: string;
    target: number;
    progress: number;
    completed: boolean;
    xpReward: number;
    label: string;
}
//# sourceMappingURL=index.d.ts.map