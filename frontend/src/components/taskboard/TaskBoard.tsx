/**
 * Task Board — shows running, recent, and upcoming task runs.
 * Clicking a run opens its chat session tab for viewing/continuing.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTabStore, tabId } from '../../stores/tabStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useAgentStore } from '../../stores/agentStore';
import { useChatStore } from '../../stores/chatStore';
import { formatDateTime } from '../../utils/formatters';
import { listTaskRuns, abortTaskRun, deleteTaskRun } from '../../api/automations';
import { getSession, connectSession, getResponseStatus, resumeResponseStream } from '../../api/sessions';
import { Dropdown } from '../common/Dropdown';
import type { TaskRunSummary, TaskRunStatus } from '../../types/automation';

const STATUS_CONFIG: Record<TaskRunStatus, { label: string; color: string; bg: string; darkColor: string; darkBg: string }> = {
  pending: { label: 'Pending', color: 'text-amber-700', bg: 'bg-amber-100', darkColor: 'dark:text-amber-400', darkBg: 'dark:bg-amber-900/30' },
  running: { label: 'Running', color: 'text-blue-700', bg: 'bg-blue-100', darkColor: 'dark:text-blue-400', darkBg: 'dark:bg-blue-900/30' },
  completed: { label: 'Completed', color: 'text-emerald-700', bg: 'bg-emerald-100', darkColor: 'dark:text-emerald-400', darkBg: 'dark:bg-emerald-900/30' },
  failed: { label: 'Failed', color: 'text-red-700', bg: 'bg-red-100', darkColor: 'dark:text-red-400', darkBg: 'dark:bg-red-900/30' },
  timed_out: { label: 'Timed Out', color: 'text-orange-700', bg: 'bg-orange-100', darkColor: 'dark:text-orange-400', darkBg: 'dark:bg-orange-900/30' },
  aborted: { label: 'Aborted', color: 'text-gray-700', bg: 'bg-gray-100', darkColor: 'dark:text-gray-400', darkBg: 'dark:bg-gray-800' },
};

function StatusBadge({ status }: { status: TaskRunStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.color} ${config.darkBg} ${config.darkColor}`}>
      {status === 'running' && <span className="mr-1 animate-pulse">●</span>}
      {config.label}
    </span>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatTokens(usage: Record<string, number> | null): string | null {
  if (!usage) return null;
  // SDK returns { currentTokens, tokenLimit, messagesLength }
  const current = usage.currentTokens ?? usage.current_tokens;
  const messages = usage.messagesLength ?? usage.messages_length;
  // Also handle inputTokens/outputTokens if format changes
  const input = usage.inputTokens ?? usage.input_tokens;
  const output = usage.outputTokens ?? usage.output_tokens;

  const parts: string[] = [];
  if (current != null) parts.push(`${Math.round(current).toLocaleString()} tokens`);
  else {
    if (input != null) parts.push(`${input.toLocaleString()} in`);
    if (output != null) parts.push(`${output.toLocaleString()} out`);
  }
  if (messages != null) parts.push(`${Math.round(messages)} turns`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function TaskRunCard({
  run,
  onAbort,
  onDelete,
  onClick,
}: {
  run: TaskRunSummary;
  onAbort: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tokenStr = formatTokens(run.token_usage);

  return (
    <button
      onClick={onClick}
      className="w-full bg-white/50 dark:bg-[#2a2a3c]/50 backdrop-blur border border-white/40 dark:border-[#3a3a4e] rounded-xl p-4 text-left hover:border-blue-300/60 dark:hover:border-blue-500/40 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{run.agent_name}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">{run.prompt}</p>
        </div>
        <StatusBadge status={run.status} />
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500 mt-2">
        {run.started_at && <span>{formatDateTime(run.started_at)}</span>}
        {run.duration_seconds !== null && <span>{formatDuration(run.duration_seconds)}</span>}
        {tokenStr && <span>🎟 {tokenStr}</span>}
      </div>

      {run.error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-2 line-clamp-2">{run.error}</p>
      )}

      <div className="mt-3 pt-2 border-t border-white/40 dark:border-[#3a3a4e] flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {run.status === 'running' && (
          <button
            onClick={onAbort}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-50/80 text-red-700 hover:bg-red-100/80 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
          >
            ⛔ Abort
          </button>
        )}
        {run.session_id && run.status !== 'pending' && run.status !== 'running' && (
          <span className="text-xs text-blue-500 dark:text-blue-400">💬 Click to open chat</span>
        )}
        <div className="flex-1" />
        {confirmDelete ? (
          <div className="flex gap-1">
            <button onClick={onDelete} className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">
              Confirm
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            title="Delete run & session"
          >
            🗑
          </button>
        )}
      </div>
    </button>
  );
}

export function TaskBoard({ automationId, automationName }: { automationId?: string; automationName?: string }) {
  const [runs, setRuns] = useState<TaskRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [agentFilter, setAgentFilter] = useState<string>('');
  const { openTab, closeTab } = useTabStore();
  const { agents, fetchAgents } = useAgentStore();

  useEffect(() => {
    if (agents.length === 0) fetchAgents();
  }, [fetchAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    try {
      const data = await listTaskRuns({ limit: 100, automation_id: automationId, agent_id: agentFilter || undefined });
      setRuns(data);
    } catch (e) {
      console.error('Failed to load task runs:', e);
    } finally {
      setLoading(false);
    }
  }, [automationId, agentFilter]);

  useEffect(() => {
    refresh();
    // Poll every 5 seconds for live updates
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleAbort = async (runId: string) => {
    try {
      await abortTaskRun(runId);
      refresh();
    } catch (e) {
      console.error('Failed to abort run:', e);
    }
  };

  const handleDelete = async (run: TaskRunSummary) => {
    try {
      await deleteTaskRun(run.id);
      if (run.session_id) closeTab(tabId.session(run.session_id));
      refresh();
    } catch (e) {
      console.error('Failed to delete run:', e);
    }
  };

  const handleClick = async (run: TaskRunSummary) => {
    if (run.session_id && run.status !== 'pending') {
      const { setMessages, setStreaming, appendStreamingContent, addStreamingStep, finalizeStreaming } = useChatStore.getState();
      const { sessions, setSessions } = useSessionStore.getState();
      try {
        const sessionData = await getSession(run.session_id);
        setMessages(run.session_id, sessionData.messages);
        if (!sessions.find(s => s.session_id === run.session_id)) {
          setSessions([...sessions, { ...sessionData, trigger: 'automation' }]);
        }
      } catch (e) {
        console.error('Failed to load session:', e);
      }
      openTab({
        id: tabId.session(run.session_id),
        type: 'session',
        label: run.prompt.slice(0, 40) || run.agent_name,
        sessionId: run.session_id,
      });
      // Resume active stream if run is still in progress (same as SessionItem)
      if (run.status === 'running') {
        try {
          await connectSession(run.session_id);
          const status = await getResponseStatus(run.session_id);
          if (status.active) {
            setStreaming(run.session_id, true);
            await resumeResponseStream(
              run.session_id,
              status.chunks_count || 0,
              status.steps_count || 0,
              (content) => appendStreamingContent(run.session_id!, content),
              (step) => addStreamingStep(run.session_id!, step),
              () => {
                finalizeStreaming(run.session_id!, '');
                getSession(run.session_id!).then(s => setMessages(run.session_id!, s.messages)).catch(() => {});
              },
              (error) => {
                console.error('Resume stream error:', error);
                setStreaming(run.session_id!, false);
              }
            );
          }
        } catch (e) {
          console.error('Failed to resume stream:', e);
        }
      }
    }
  };

  const filteredRuns = filter === 'all' ? runs : runs.filter((r) => r.status === filter);
  const runningCount = runs.filter((r) => r.status === 'running').length;
  const pendingCount = runs.filter((r) => r.status === 'pending').length;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {automationName ? `Runs: ${automationName}` : '📋 Runs'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {runningCount > 0 && <span className="text-blue-600 dark:text-blue-400">{runningCount} running</span>}
              {runningCount > 0 && pendingCount > 0 && ' · '}
              {pendingCount > 0 && <span className="text-amber-600 dark:text-amber-400">{pendingCount} pending</span>}
              {runningCount === 0 && pendingCount === 0 && 'No active runs'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {automationId && (
              <button
                onClick={() => openTab({ id: tabId.taskBoard(), type: 'task-board', label: 'Runs' })}
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                ← All Runs
              </button>
            )}
            <button
              onClick={refresh}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Agent filter */}
        {!automationId && agents.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm text-gray-500 dark:text-gray-400">Filter by agent:</label>
            <Dropdown
              options={[
                { value: '', label: 'All Agents' },
                ...agents.map(a => ({ value: a.id, label: `${a.icon} ${a.name}` })),
              ]}
              value={agentFilter}
              onChange={setAgentFilter}
              variant="compact"
            />
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-1 mb-6 bg-white/40 dark:bg-[#2a2a3c]/40 backdrop-blur p-1 rounded-lg w-fit">
          {['all', 'running', 'completed', 'failed'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-white/70 dark:bg-[#32324a] text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'running' && runningCount > 0 && ` (${runningCount})`}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">Loading...</div>
        ) : filteredRuns.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-500 dark:text-gray-400">No runs {filter !== 'all' ? `with status "${filter}"` : 'yet'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRuns.map((run) => (
              <TaskRunCard
                key={run.id}
                run={run}
                onAbort={() => handleAbort(run.id)}
                onDelete={() => handleDelete(run)}
                onClick={() => handleClick(run)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
