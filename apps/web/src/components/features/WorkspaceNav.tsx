import type { WorkspaceDTO } from '@shared/types';

interface WorkspaceNavProps {
  workspaces: WorkspaceDTO[];
  activeWorkspaceId: string | null;
  onSelect: (workspace: WorkspaceDTO) => void;
  isLoading: boolean;
}

export const WorkspaceNav = ({
  workspaces,
  activeWorkspaceId,
  onSelect,
  isLoading,
}: WorkspaceNavProps): JSX.Element => (
  <nav className="w-56 shrink-0 border-r border-gray-200 bg-white p-4" aria-label="Workspaces">
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Workspaces</h2>
    {isLoading ? (
      <ul className="flex flex-col gap-1" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="h-8 rounded-lg bg-gray-100 animate-pulse" />
        ))}
      </ul>
    ) : (
      <ul className="flex flex-col gap-1">
        {workspaces.map((ws) => (
          <li key={ws.id}>
            <button
              type="button"
              onClick={() => onSelect(ws)}
              aria-current={ws.id === activeWorkspaceId ? 'page' : undefined}
              className={[
                'w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                ws.id === activeWorkspaceId
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-100',
              ].join(' ')}
            >
              {ws.name}
            </button>
          </li>
        ))}
      </ul>
    )}
  </nav>
);
