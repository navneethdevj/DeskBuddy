import { useState, useCallback } from 'react';
import type { WorkspaceDTO } from '@shared/types';
import type { CreateWorkspaceInput } from '@shared/schemas';

interface WorkspaceNavProps {
  workspaces: WorkspaceDTO[];
  activeWorkspaceId: string | null;
  onSelect: (workspace: WorkspaceDTO) => void;
  isLoading: boolean;
  onCreateWorkspace: (data: CreateWorkspaceInput) => Promise<void>;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

/** Deterministic warm accent per workspace */
const WS_COLORS = ['#e8963a', '#4caf7c', '#5090d8', '#9060c8', '#d06040', '#40a0c0', '#c05880'];
const wsColor = (id: string): string =>
  WS_COLORS[id.charCodeAt(0) % WS_COLORS.length] ?? WS_COLORS[0]!;

const NavInner = ({
  workspaces,
  activeWorkspaceId,
  onSelect,
  isLoading,
  onCreateWorkspace,
  onMobileClose,
}: Omit<WorkspaceNavProps, 'isMobileOpen'>): JSX.Element => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSelect = useCallback((ws: WorkspaceDTO): void => {
    onSelect(ws);
    onMobileClose?.();
  }, [onSelect, onMobileClose]);

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreateWorkspace({ name: name.trim() });
      setName('');
      setCreating(false);
    } finally {
      setSaving(false);
    }
  }, [name, onCreateWorkspace]);

  return (
    <nav className="flex h-full flex-col" aria-label="Workspaces">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">Workspaces</p>
        {onMobileClose && (
          <button
            type="button"
            onClick={onMobileClose}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink-2 md:hidden"
            aria-label="Close navigation"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* List */}
      <ul className="flex flex-col gap-0.5 flex-1 overflow-y-auto" aria-busy={isLoading}>
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="skeleton h-8 rounded-lg" />
          ))
        ) : workspaces.length === 0 ? (
          <li className="py-4 text-center text-xs text-ink-3">No workspaces yet</li>
        ) : (
          workspaces.map((ws) => {
            const active = ws.id === activeWorkspaceId;
            return (
              <li key={ws.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(ws)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-all duration-150',
                    active
                      ? 'bg-accent-dim text-ink font-medium'
                      : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                  ].join(' ')}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full transition-transform group-hover:scale-110"
                    style={{ backgroundColor: active ? wsColor(ws.id) : '#3a3730' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{ws.name}</span>
                  {active && (
                    <span className="ml-auto h-1 w-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>

      {/* Create workspace */}
      <div className="mt-3 border-t border-border pt-3">
        {creating ? (
          <div className="animate-slide-up">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
                if (e.key === 'Escape') { setCreating(false); setName(''); }
              }}
              placeholder="Workspace name"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!name.trim() || saving}
                className="flex-1 rounded-lg bg-accent py-1 text-xs font-semibold text-bg transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {saving ? '…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); setName(''); }}
                className="rounded-lg px-2 py-1 text-xs text-ink-3 hover:bg-surface-2 hover:text-ink-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            New workspace
          </button>
        )}
      </div>
    </nav>
  );
};

export const WorkspaceNav = ({
  workspaces,
  activeWorkspaceId,
  onSelect,
  isLoading,
  onCreateWorkspace,
  isMobileOpen = false,
  onMobileClose,
}: WorkspaceNavProps): JSX.Element => {
  const navProps = { workspaces, activeWorkspaceId, onSelect, isLoading, onCreateWorkspace, onMobileClose };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-border bg-surface p-4 md:flex md:flex-col">
        <NavInner {...navProps} />
      </aside>

      {/* Mobile overlay drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-bg/70 backdrop-blur-sm animate-fade-in"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface p-4 shadow-drawer animate-slide-in-left">
            <NavInner {...navProps} />
          </aside>
        </div>
      )}
    </>
  );
};
