import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  listMCPServers,
  getMCPSettings,
  patchMCPSettings,
  deleteMCPServer,
  resetMCPOAuth,
  MCPApiError,
} from '../../api/mcp';
import { useSessionStore } from '../../stores/sessionStore';
import { useToastStore } from '../../stores/toastStore';
import type { MCPServer } from '../../types/mcp';
import { Button } from '../common/Button';
import { ConfirmModal } from '../common/ConfirmModal';
import { MCPServerEditor } from './MCPServerEditor';

interface MCPServersTabProps {
  isOpen: boolean;
}

interface ServerGroup {
  key: string;
  label: string;
  path: string;
  servers: MCPServer[];
  readOnly: boolean;
  description: string;
}

/**
 * Settings → MCP Servers tab (Slice 7).
 *
 * Renders the merged MCP server list grouped by source (Global / Agent-only /
 * Plugins) with a per-server "auto-enable on new sessions" toggle. The toggle
 * persists immediately via PATCH /api/mcp/settings — no Save button needed.
 *
 * Add / Edit / Delete affordances are intentionally deferred to the next
 * slice (mcp-add-edit-modal) so this slice ships pure list + toggle behavior.
 */
export function MCPServersTab({ isOpen }: MCPServersTabProps) {
  const availableMcpServers = useSessionStore(s => s.availableMcpServers);
  const setAvailableMcpServers = useSessionStore(s => s.setAvailableMcpServers);
  const upsertAvailableMcpServer = useSessionStore(s => s.upsertAvailableMcpServer);
  const removeAvailableMcpServer = useSessionStore(s => s.removeAvailableMcpServer);
  const setMcpAutoEnableCache = useSessionStore(s => s.setMcpAutoEnable);

  const [autoEnable, setAutoEnable] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNames, setPendingNames] = useState<Set<string>>(new Set());
  const [editorState, setEditorState] = useState<
    | { open: false }
    | { open: true; mode: 'add' }
    | { open: true; mode: 'edit'; server: MCPServer }
  >({ open: false });
  // Pending confirmation dialogs — using ConfirmModal for visual consistency
  // with session-delete confirmations rather than raw window.confirm.
  const [pendingDelete, setPendingDelete] = useState<MCPServer | null>(null);
  const [pendingResetOAuth, setPendingResetOAuth] = useState<MCPServer | null>(null);

  // On open: refresh both the server list and the auto-enable map so toggles
  // reflect persisted state. Errors are surfaced in-place; no global toast.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([listMCPServers(), getMCPSettings()])
      .then(([config, settings]) => {
        if (cancelled) return;
        setAvailableMcpServers(config.servers);
        const map = settings.mcp_auto_enable ?? {};
        setAutoEnable(map);
        setMcpAutoEnableCache(map);
      })
      .catch(err => {
        if (cancelled) return;
        const detail = err instanceof MCPApiError ? err.detail : (err as Error)?.message;
        setError(detail || 'Failed to load MCP servers');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, setAvailableMcpServers, setMcpAutoEnableCache]);

  const groups = useMemo<ServerGroup[]>(
    () => buildGroups(availableMcpServers),
    [availableMcpServers],
  );

  const handleToggle = useCallback(
    async (server: MCPServer, next: boolean) => {
      const name = server.name;

      // Optimistic update + per-row pending flag for visual feedback.
      // Auto-enable applies to ALL servers (including plugin-managed ones) — the
      // overlay is keyed by name and lives outside the MCP config files.
      const previous = autoEnable[name];
      setAutoEnable(prev => ({ ...prev, [name]: next }));
      setPendingNames(prev => new Set(prev).add(name));
      try {
        const updated = await patchMCPSettings({ [name]: next });
        const map = updated.mcp_auto_enable ?? {};
        setAutoEnable(map);
        setMcpAutoEnableCache(map);
        setError(null);
      } catch (err) {
        // Revert on failure so the UI never lies about persisted state.
        setAutoEnable(prev => {
          const reverted = { ...prev };
          if (previous === undefined) {
            delete reverted[name];
          } else {
            reverted[name] = previous;
          }
          return reverted;
        });
        const detail = err instanceof MCPApiError ? err.detail : (err as Error)?.message;
        setError(detail || `Failed to update ${name}`);
      } finally {
        setPendingNames(prev => {
          const nextSet = new Set(prev);
          nextSet.delete(name);
          return nextSet;
        });
      }
    },
    [autoEnable],
  );

  const performDelete = useCallback(
    async (server: MCPServer) => {
      setPendingNames(prev => new Set(prev).add(server.name));
      try {
        await deleteMCPServer(server.name);
        removeAvailableMcpServer(server.name);
        setAutoEnable(prev => {
          const next = { ...prev };
          delete next[server.name];
          return next;
        });
        useToastStore.getState().addToast(
          `Deleted "${server.name}". Open & active chats keep their current MCP setup — start a new chat to use changes.`,
          'success',
          6000,
        );
      } catch (err) {
        const detail = err instanceof MCPApiError ? err.detail : (err as Error)?.message;
        useToastStore.getState().addToast(detail || `Failed to delete ${server.name}`, 'error', 6000);
      } finally {
        setPendingNames(prev => {
          const next = new Set(prev);
          next.delete(server.name);
          return next;
        });
      }
    },
    [removeAvailableMcpServer],
  );

  const performResetOAuth = useCallback(
    async (server: MCPServer) => {
      setPendingNames(prev => new Set(prev).add(server.name));
      try {
        const result = await resetMCPOAuth(server.name);
        const removed = result.removed?.length ?? 0;
        useToastStore.getState().addToast(
          removed === 0
            ? `No OAuth state found for "${server.name}".`
            : `Reset OAuth for "${server.name}". Sign in again the next time you start a session that uses it.`,
          removed === 0 ? 'info' : 'success',
          7000,
        );
      } catch (err) {
        const detail = err instanceof MCPApiError ? err.detail : (err as Error)?.message;
        useToastStore.getState().addToast(detail || `Failed to reset OAuth for ${server.name}`, 'error', 6000);
      } finally {
        setPendingNames(prev => {
          const next = new Set(prev);
          next.delete(server.name);
          return next;
        });
      }
    },
    [],
  );

  const handleOpenConfigFile = useCallback(async (path: string) => {
    try {
      const res = await fetch('/api/filesystem/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg = data?.detail || `Failed to open ${path}`;
        useToastStore.getState().addToast(msg, 'error', 6000);
      }
    } catch (e) {
      useToastStore.getState().addToast(`Failed to open ${path}: ${(e as Error).message}`, 'error', 6000);
    }
  }, []);

  const handleSaved = useCallback(
    (saved: MCPServer, autoEnableNext: boolean) => {
      upsertAvailableMcpServer(saved);
      setAutoEnable(prev => ({ ...prev, [saved.name]: autoEnableNext }));
      useToastStore.getState().addToast(
        `Saved "${saved.name}". Open chats keep their current MCP setup — start a new chat to use changes.`,
        'success',
        6000,
      );
    },
    [upsertAvailableMcpServer],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            MCP Servers
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Toggle which servers are enabled by default when you start a new session.
            Changes persist immediately.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setEditorState({ open: true, mode: 'add' })}
          className="flex-shrink-0"
        >
          + Add Server
        </Button>
      </div>

      {loading && availableMcpServers.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading servers…</p>
      )}

      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md"
        >
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {!loading && availableMcpServers.length === 0 && !error && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No MCP servers configured yet.
        </p>
      )}

      {groups.map(group => (
        <section key={group.key} className="border-t border-gray-200 dark:border-[#3a3a4e] pt-4">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex-shrink-0">
                {group.label}
              </h4>
              <button
                type="button"
                onClick={() => handleOpenConfigFile(group.path)}
                className="text-[11px] font-mono text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline truncate text-left cursor-pointer"
                title={`Open ${group.path} with the OS default application`}
              >
                {group.path}
              </button>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
              {group.description}
            </span>
          </div>
          <ul className="space-y-1">
            {group.servers.map(server => {
              const enabled = !!autoEnable[server.name];
              const pending = pendingNames.has(server.name);
              const writable = !group.readOnly;
              const hasOAuth = !!server.url; // remote servers may have OAuth state
              const detail = server.url
                ? server.url
                : `${server.command || ''} ${(server.args || []).join(' ')}`.trim();
              return (
                <li
                  key={server.name}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-white/40 dark:bg-[#1e1e2e]/60 border border-white/30 dark:border-gray-700"
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                      {server.name}
                    </span>
                    <span
                      className="text-xs text-gray-500 dark:text-gray-400 truncate"
                      title={detail}
                    >
                      {detail || '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {hasOAuth && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingResetOAuth(server)}
                        disabled={pending}
                        aria-label={`Reset OAuth for ${server.name}`}
                      >
                        Reset OAuth
                      </Button>
                    )}
                    <label
                      className="inline-flex items-center gap-2 cursor-pointer"
                      title={
                        writable
                          ? 'Auto-enable on new sessions'
                          : 'Auto-enable on new sessions (plugin config itself is managed by the plugin)'
                      }
                    >
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        Auto-enable
                      </span>
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={pending}
                        onChange={e => handleToggle(server, e.target.checked)}
                        aria-label={`Auto-enable ${server.name}`}
                        className="h-4 w-4 accent-blue-600"
                      />
                    </label>
                    {writable && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditorState({ open: true, mode: 'edit', server })}
                          disabled={pending}
                          aria-label={`Edit ${server.name}`}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setPendingDelete(server)}
                          disabled={pending}
                          aria-label={`Delete ${server.name}`}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <MCPServerEditor
        isOpen={editorState.open}
        mode={editorState.open ? editorState.mode : 'add'}
        server={editorState.open && editorState.mode === 'edit' ? editorState.server : undefined}
        initialAutoEnable={
          editorState.open && editorState.mode === 'edit'
            ? !!autoEnable[editorState.server.name]
            : false
        }
        onClose={() => setEditorState({ open: false })}
        onSaved={handleSaved}
      />

      <ConfirmModal
        isOpen={pendingDelete !== null}
        title="Delete MCP Server"
        message={
          pendingDelete
            ? `Delete MCP server "${pendingDelete.name}"? This removes it from ${
                pendingDelete.source === 'global'
                  ? '~/.copilot/mcp-config.json'
                  : '~/.copilot-console/mcp-config.json'
              }. Open & active chats keep their current setup.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void performDelete(target);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmModal
        isOpen={pendingResetOAuth !== null}
        title="Reset OAuth"
        message={
          pendingResetOAuth
            ? `Reset OAuth for "${pendingResetOAuth.name}"? This deletes the cached registration and tokens. The next session that uses this server will trigger a fresh sign-in.`
            : ''
        }
        confirmLabel="Reset"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={() => {
          const target = pendingResetOAuth;
          setPendingResetOAuth(null);
          if (target) void performResetOAuth(target);
        }}
        onCancel={() => setPendingResetOAuth(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGroups(servers: MCPServer[]): ServerGroup[] {
  const global: MCPServer[] = [];
  const agent: MCPServer[] = [];
  const pluginsBySource = new Map<string, MCPServer[]>();
  for (const s of servers) {
    if (s.source === 'global') {
      global.push(s);
    } else if (s.source === 'agent-only') {
      agent.push(s);
    } else {
      const arr = pluginsBySource.get(s.source) ?? [];
      arr.push(s);
      pluginsBySource.set(s.source, arr);
    }
  }
  const byName = (a: MCPServer, b: MCPServer) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  global.sort(byName);
  agent.sort(byName);
  for (const list of pluginsBySource.values()) list.sort(byName);

  const groups: ServerGroup[] = [];
  if (global.length > 0) {
    groups.push({
      key: 'global',
      label: 'Global',
      path: '~/.copilot/mcp-config.json',
      servers: global,
      readOnly: false,
      description: 'Shared with the Copilot CLI',
    });
  }
  if (agent.length > 0) {
    groups.push({
      key: 'agent-only',
      label: 'App',
      path: '~/.copilot-console/mcp-config.json',
      servers: agent,
      readOnly: false,
      description: 'Visible only inside copilot-console',
    });
  }
  const pluginEntries = Array.from(pluginsBySource.entries()).sort((a, b) =>
    a[0].toLowerCase().localeCompare(b[0].toLowerCase()),
  );
  for (const [source, list] of pluginEntries) {
    groups.push({
      key: `plugin:${source}`,
      label: 'Plugin',
      path: `~/.copilot/installed-plugins/copilot-plugins/`,
      servers: list,
      readOnly: true,
      description: 'Managed by Copilot CLI plugin',
    });
  }
  return groups;
}
