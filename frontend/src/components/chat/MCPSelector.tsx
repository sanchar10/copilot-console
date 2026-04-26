import { useState, useRef, useEffect } from 'react';
import type { MCPServer, MCPServerSelections } from '../../types/mcp';
import { onEvent, openEventsChannel, type EventEnvelope } from '../../api/events';
import type {
  MCPServerStatusEvent,
  MCPOAuthRequiredEvent,
  MCPOAuthCompletedEvent,
  MCPOAuthFailedEvent,
} from '../../api/sessions';
import { retriggerMcpOAuth } from '../../api/mcpOAuth';
import { useToastStore } from '../../stores/toastStore';

interface MCPSelectorProps {
  availableServers: MCPServer[];
  selections: MCPServerSelections;
  onSelectionsChange: (selections: MCPServerSelections) => void;
  disabled?: boolean;
  /** When true, dropdown opens for viewing but all controls inside are disabled */
  readOnly?: boolean;
  /**
   * Active session id. When provided, the selector subscribes to MCP status
   * events for this session and renders per-server health badges. When
   * undefined (e.g., AgentEditor where there is no live session), badges are
   * suppressed and the selector behaves as a pure config picker.
   */
  sessionId?: string;
}

type ServerStatus =
  | 'connected'
  | 'pending'
  | 'needs-auth'
  | 'failed'
  | 'disabled'
  | 'not_configured'
  | null;

interface BadgeMeta {
  symbol: string;
  className: string;
  title: string;
}

function badgeMetaFor(status: ServerStatus, error?: string | null): BadgeMeta | null {
  switch (status) {
    case 'connected':
      return { symbol: '●', className: 'text-emerald-500', title: 'Connected' };
    case 'needs-auth':
      return { symbol: '🔐', className: 'text-amber-500', title: 'Sign-in required — click to start OAuth' };
    case 'pending':
    case 'not_configured':
      return { symbol: '◌', className: 'text-blue-500 animate-pulse', title: 'Connecting…' };
    case 'failed':
      return {
        symbol: '⚠',
        className: 'text-red-500',
        title: error ? `Failed: ${error}` : 'Failed',
      };
    case 'disabled':
      return { symbol: '○', className: 'text-gray-400', title: 'Disabled by server' };
    default:
      return null;
  }
}

export function MCPSelector({
  availableServers,
  selections,
  onSelectionsChange,
  disabled = false,
  readOnly = false,
  sessionId,
}: MCPSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [serverStatus, setServerStatus] = useState<Record<string, { status: ServerStatus; error?: string | null }>>({});
  const [retriggering, setRetriggering] = useState<Record<string, boolean>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Subscribe to MCP status / OAuth events from the global bus, scoped to
  // this session. Reset state whenever the session id changes so a stale
  // session's badges don't leak into a fresh tab.
  useEffect(() => {
    if (!sessionId) {
      setServerStatus({});
      return;
    }
    openEventsChannel();
    setServerStatus({});

    const unsubs: Array<() => void> = [];

    unsubs.push(onEvent<MCPServerStatusEvent>('mcp_server_status', (env: EventEnvelope<MCPServerStatusEvent>) => {
      if (env.data?.sessionId !== sessionId) return;
      setServerStatus((prev) => {
        const next = { ...prev };
        for (const entry of env.data.statuses || []) {
          if (!entry.serverName) continue;
          next[entry.serverName] = {
            status: (entry.status as ServerStatus) ?? null,
            error: entry.error ?? null,
          };
        }
        return next;
      });
    }));

    unsubs.push(onEvent<MCPOAuthRequiredEvent>('mcp_oauth_required', (env) => {
      if (env.data?.sessionId !== sessionId) return;
      setServerStatus((prev) => ({
        ...prev,
        [env.data.serverName]: { status: 'needs-auth', error: null },
      }));
    }));

    unsubs.push(onEvent<MCPOAuthCompletedEvent>('mcp_oauth_completed', (env) => {
      if (env.data?.sessionId !== sessionId) return;
      setServerStatus((prev) => ({
        ...prev,
        [env.data.serverName]: { status: 'connected', error: null },
      }));
    }));

    unsubs.push(onEvent<MCPOAuthFailedEvent>('mcp_oauth_failed', (env) => {
      if (env.data?.sessionId !== sessionId) return;
      setServerStatus((prev) => {
        // Don't override a known-good status with "failed" — only flip when
        // we currently believe the server needs auth or is pending. This
        // avoids the OAuth-poll-timeout event clobbering a server that
        // genuinely connected meanwhile.
        const current = prev[env.data.serverName]?.status;
        if (current === 'connected') return prev;
        return {
          ...prev,
          [env.data.serverName]: { status: 'needs-auth', error: env.data.reason ?? null },
        };
      });
    }));

    return () => {
      for (const off of unsubs) off();
    };
  }, [sessionId]);

  // Count enabled servers
  const enabledCount = availableServers.filter(
    (server) => selections[server.name] !== false
  ).length;

  // Aggregate badge for the picker button: needs-auth wins over failed wins
  // over pending wins over all-connected. Only counts servers the user has
  // actually enabled — disabling a needs-auth server should clear the
  // header indicator.
  const aggregateStatus: ServerStatus = (() => {
    if (!sessionId) return null;
    let sawPending = false;
    let sawFailed = false;
    let sawConnected = false;
    let sawAny = false;
    for (const server of availableServers) {
      if (selections[server.name] === false) continue;
      const meta = serverStatus[server.name];
      if (!meta) continue;
      sawAny = true;
      if (meta.status === 'needs-auth') return 'needs-auth';
      if (meta.status === 'failed') sawFailed = true;
      else if (meta.status === 'pending' || meta.status === 'not_configured') sawPending = true;
      else if (meta.status === 'connected') sawConnected = true;
    }
    if (sawFailed) return 'failed';
    if (sawPending) return 'pending';
    if (sawConnected && sawAny) return 'connected';
    return null;
  })();
  const aggregateBadge = badgeMetaFor(aggregateStatus);

  const handleToggle = (serverName: string) => {
    const currentValue = selections[serverName] !== false;
    onSelectionsChange({
      ...selections,
      [serverName]: !currentValue,
    });
  };

  const handleSelectAll = () => {
    const allEnabled: MCPServerSelections = {};
    availableServers.forEach((server) => {
      allEnabled[server.name] = true;
    });
    onSelectionsChange(allEnabled);
  };

  const handleDeselectAll = () => {
    const allDisabled: MCPServerSelections = {};
    availableServers.forEach((server) => {
      allDisabled[server.name] = false;
    });
    onSelectionsChange(allDisabled);
  };

  const handleRetrigger = async (serverName: string) => {
    if (!sessionId) return;
    if (retriggering[serverName]) return;
    setRetriggering((prev) => ({ ...prev, [serverName]: true }));
    try {
      await retriggerMcpOAuth(sessionId, serverName);
      // Optimistic: flip to pending so the badge gives instant feedback.
      // The bus will replace this with the real status soon.
      setServerStatus((prev) => ({
        ...prev,
        [serverName]: { status: 'pending', error: null },
      }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to start sign-in';
      useToastStore.getState().addToast(`${serverName}: ${message}`, 'error', 6000);
    } finally {
      setRetriggering((prev) => {
        const next = { ...prev };
        delete next[serverName];
        return next;
      });
    }
  };

  if (availableServers.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md
          transition-colors duration-150
          ${disabled 
            ? 'bg-gray-100/80 dark:bg-gray-800/80 text-gray-400 border border-gray-200/60 dark:border-gray-700/60 cursor-not-allowed' 
            : 'bg-blue-50 dark:bg-blue-900/[0.18] text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-500/35 hover:bg-blue-100 dark:hover:bg-blue-800/40 cursor-pointer'
          }
        `}
        title={aggregateBadge ? aggregateBadge.title : `${enabledCount}/${availableServers.length} MCP servers enabled`}
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
          />
        </svg>
        <span>MCP</span>
        <span className="bg-blue-200/80 dark:bg-blue-800/40 text-blue-800 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-semibold min-w-[2.5rem] text-center">
          {enabledCount}/{availableServers.length}
        </span>
        {/* Reserve a fixed-width slot so adding/removing the aggregate badge
            (e.g., a green dot or a 🔐 lock) doesn't make the trigger button
            jitter in width. */}
        <span className="inline-block w-3.5 text-center text-[11px] leading-none">
          {aggregateBadge && (
            <span className={aggregateBadge.className} aria-label={aggregateBadge.title}>
              {aggregateBadge.symbol}
            </span>
          )}
        </span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white/95 dark:bg-[#2a2a3c]/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          <div className="p-2 border-b border-white/40 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">MCP Servers</span>
              {!readOnly && (
              <div className="flex gap-1">
                <button
                  onClick={handleSelectAll}
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-1.5 py-0.5"
                >
                  All
                </button>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <button
                  onClick={handleDeselectAll}
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-1.5 py-0.5"
                >
                  None
                </button>
              </div>
              )}
            </div>
          </div>
          
          <div className="max-h-64 overflow-y-auto py-1">
            {availableServers.map((server) => {
              const isEnabled = selections[server.name] !== false;
              const meta = serverStatus[server.name];
              // Per-row badge mirrors the aggregate's "active set" semantic:
              // a deselected server shows no dot, symmetric with a server
              // that has never been selected. Without this, unchecking a
              // connected server would leave a stale green dot behind even
              // though the trigger's aggregate badge has already cleared.
              const badge = sessionId && isEnabled ? badgeMetaFor(meta?.status ?? null, meta?.error) : null;
              const isNeedsAuth = isEnabled && meta?.status === 'needs-auth';
              const isRetriggering = retriggering[server.name] === true;
              return (
                <div
                  key={server.name}
                  className={`flex items-start gap-2 px-3 py-2 ${readOnly ? 'opacity-60' : 'hover:bg-white/40 dark:hover:bg-gray-700/40'}`}
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => handleToggle(server.name)}
                    className="mt-0.5 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                    disabled={readOnly}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {server.name}
                      </span>
                      <span className="text-[10px] text-gray-400 bg-white/50 dark:bg-gray-700/50 px-1 py-0.5 rounded">
                        {server.source}
                      </span>
                      {badge && (
                        <span
                          className={`text-[11px] leading-none ${badge.className}`}
                          title={badge.title}
                          aria-label={badge.title}
                        >
                          {badge.symbol}
                        </span>
                      )}
                      {isNeedsAuth && sessionId && (
                        <button
                          type="button"
                          onClick={() => handleRetrigger(server.name)}
                          disabled={isRetriggering}
                          className="ml-auto text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 underline disabled:opacity-50 disabled:no-underline"
                          // Intentionally NOT keyed off readOnly: even when the picker
                          // is read-only mid-turn, we still want sign-in actionable —
                          // it doesn't change the server set, just refreshes auth.
                          title="Start a fresh sign-in flow for this server"
                        >
                          {isRetriggering ? 'Starting…' : 'Sign in'}
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate mt-0.5">
                      {server.url 
                        ? server.url 
                        : `${server.command || ''} ${(server.args || []).join(' ')}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {availableServers.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-gray-500">
              No MCP servers configured
            </div>
          )}
        </div>
      )}
    </div>
  );
}
