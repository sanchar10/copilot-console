/**
 * Workflow Run View — Mermaid diagram (left) + event/chat panel (right).
 * Connects to SSE stream for real-time updates.
 */

import { useEffect, useMemo, useState, useRef } from 'react';
import { formatDateTime } from '../../utils/formatters';
import { MermaidDiagram } from '../chat/MermaidDiagram';
import * as workflowsApi from '../../api/workflows';
import { getSession } from '../../api/sessions';
import { useChatStore } from '../../stores/chatStore';
import { useTabStore, tabId } from '../../stores/tabStore';
import { useToastStore } from '../../stores/toastStore';
import type {
  HumanInputChoice,
  HumanInputKind,
  WorkflowRun,
} from '../../types/workflow';

interface WorkflowRunViewProps {
  workflowId: string;
  runId: string;
}

interface RunEvent {
  type: string;
  run_id?: string;
  executor_id?: string;
  source_executor_id?: string;
  output?: string;
  error?: string;
  error_type?: string;
  error_message?: string;
  error_executor_id?: string;
  request_id?: string;
  request_type?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
  state?: string;
  iteration?: number;
  status?: string;
  workflow_name?: string;
  session_id?: string;
  [key: string]: unknown;
}

export function WorkflowRunView({ workflowId, runId }: WorkflowRunViewProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [mermaid, setMermaid] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  // Highest workflow_event id seen so far. Used to skip re-replayed events on
  // SSE reconnect (StrictMode double-mount, EventSource auto-retry, network
  // blips). Backend assigns numeric event_idx as the SSE id.
  const lastEventIdRef = useRef<number>(-1);

  // Load initial run data and mermaid
  useEffect(() => {
    // Reset event-id high-water mark whenever the run changes so a fresh
    // SSE stream gets the full backlog from event 0.
    lastEventIdRef.current = -1;
    setEvents([]);
    workflowsApi.getWorkflowRun(runId)
      .then((loadedRun) => {
        setRun(loadedRun);
        // For completed/failed runs, replay stored events — no SSE needed
        if (loadedRun.status === 'completed' || loadedRun.status === 'failed') {
          if (loadedRun.events && loadedRun.events.length > 0) {
            setEvents(loadedRun.events as RunEvent[]);
          } else {
            // Fallback for runs stored before events field existed
            const historicEvents: RunEvent[] = [];
            historicEvents.push({ type: 'workflow_started', workflow_name: loadedRun.workflow_name });
            if (loadedRun.node_results) {
              for (const [nodeId, result] of Object.entries(loadedRun.node_results)) {
                const r = result as Record<string, unknown>;
                historicEvents.push({
                  type: r.status === 'failed' ? 'executor_failed' : 'executor_completed',
                  executor_id: nodeId,
                  output: r.output as string | undefined,
                  error: r.error as string | undefined,
                });
              }
            }
            if (loadedRun.status === 'failed') {
              historicEvents.push({ type: 'workflow_failed', error: loadedRun.error || 'Workflow failed' });
            } else {
              historicEvents.push({ type: 'workflow_completed' });
            }
            setEvents(historicEvents);
          }
        }
      })
      .catch((e) => setError((e as Error).message));

    workflowsApi.visualizeWorkflow(workflowId)
      .then((r) => setMermaid(r.mermaid))
      .catch(() => {});
  }, [workflowId, runId]);

  // SSE connection — only for active runs
  useEffect(() => {
    // Don't connect SSE if run is already terminal
    if (run && (run.status === 'completed' || run.status === 'failed' || run.status === 'aborted')) {
      return;
    }
    // Wait for run data to load before deciding
    if (!run) return;

    const es = workflowsApi.createWorkflowRunStream(runId, lastEventIdRef.current + 1);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    const terminalTypes = new Set(['run_complete', 'workflow_completed', 'workflow_failed']);

    es.addEventListener('workflow_event', (e) => {
      // Numeric dedupe by SSE id — backend labels every workflow_event with
      // its append-order index. Skip anything we've already seen so reconnects
      // never duplicate the trace.
      const idStr = (e as MessageEvent).lastEventId;
      const idNum = idStr ? parseInt(idStr, 10) : NaN;
      if (!Number.isNaN(idNum)) {
        if (idNum <= lastEventIdRef.current) return;
        lastEventIdRef.current = idNum;
      }
      try {
        const data = JSON.parse(e.data);
        // status_changed is a badge-only carrier — patch run.status in place
        // and skip appending to the trace (filtered out anyway, but avoid
        // triggering downstream effects unnecessarily).
        if (data.type === 'status_changed' && typeof data.status === 'string') {
          const newStatus = data.status as import('../../types/workflow').WorkflowRunStatus;
          setRun((prev) => (prev ? { ...prev, status: newStatus } : prev));
          return;
        }
        setEvents((prev) => [...prev, data]);
        // Terminal event — close SSE and refresh run data
        if (terminalTypes.has(data.type)) {
          workflowsApi.getWorkflowRun(runId)
            .then(setRun)
            .catch(() => {});
          setConnected(false);
          es.close();
        }
        // Sticky failure toast — keep visible even if user navigates away.
        // Stable id so re-streaming the same terminal event doesn't stack.
        if (data.type === 'workflow_failed') {
          const errMsg = (data.error_message || data.error || 'Workflow run failed.') as string;
          useToastStore.getState().addToast(
            `Workflow failed: ${errMsg}`,
            'error',
            { duration: 0, id: `workflow-run-failed-${runId}` },
          );
        }
      } catch {
        // ignore parse errors
      }
    });

    es.addEventListener('human_input_required', (e) => {
      try {
        const data = JSON.parse(e.data) as RunEvent;
        // De-dupe by request_id — backend now emits once per pause but
        // guard against any retry / reconnect duplicates so we never
        // render two HumanInputRows for the same prompt.
        setEvents((prev) => {
          const rid = data.request_id;
          if (rid && prev.some((p) => p.type === 'human_input_required' && p.request_id === rid)) {
            return prev;
          }
          return [...prev, data];
        });
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [runId, run]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Track which request_ids we've already submitted a response for so the
  // row goes read-only after click and survives any SSE re-emit.
  // Map of request_id -> the value the user submitted. Presence in the map
  // (regardless of value, since `false` and `null` are valid answers) means
  // "responded". The value is shown back to the user on the dimmed card.
  const [submittedAnswers, setSubmittedAnswers] = useState<Map<string, unknown>>(new Map());

  // Pull responses out of human_input_received events (covers reload + history
  // replay paths). Older runs lack the `data` field; we still mark them as
  // responded but with `undefined` so the card falls back to a bare label.
  useEffect(() => {
    const responded: Array<[string, unknown]> = [];
    for (const e of events) {
      if (e.type === 'human_input_received' && typeof e.request_id === 'string') {
        responded.push([e.request_id, (e as { data?: unknown }).data]);
      }
    }
    if (responded.length === 0) return;
    setSubmittedAnswers((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, value] of responded) {
        if (!next.has(id) || (next.get(id) === undefined && value !== undefined)) {
          next.set(id, value);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [events]);

  const submitInput = async (requestId: string, data: unknown): Promise<void> => {
    if (submittedAnswers.has(requestId)) return;
    // Optimistically lock the row + record the value so the dimmed card can
    // show it immediately, before the receipt event round-trips.
    setSubmittedAnswers((prev) => {
      const next = new Map(prev);
      next.set(requestId, data);
      return next;
    });
    try {
      await workflowsApi.sendHumanInput(runId, { request_id: requestId, data });
    } catch (e) {
      // Roll back so the user can retry on transient failure.
      setSubmittedAnswers((prev) => {
        const next = new Map(prev);
        next.delete(requestId);
        return next;
      });
      setError((e as Error).message);
    }
  };

  // Memoize the visible event list with HITL de-dupe (defensive — also
  // applied at SSE handler level). Also drops status_changed carriers which
  // are not meant to render as trace rows.
  const visibleEvents = useMemo(() => {
    const seen = new Set<string>();
    const out: RunEvent[] = [];
    for (const ev of events) {
      if (ev.type === 'status_changed') continue;
      if (ev.type === 'human_input_required' && typeof ev.request_id === 'string') {
        if (seen.has(ev.request_id)) continue;
        seen.add(ev.request_id);
      }
      out.push(ev);
    }
    return out;
  }, [events]);

  const statusColor = run?.status === 'completed' ? 'text-green-500' :
    run?.status === 'failed' ? 'text-red-500' :
    run?.status === 'running' ? 'text-blue-500' :
    run?.status === 'paused' ? 'text-yellow-500' :
    'text-gray-500';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#252536]">
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${statusColor}`}>
            {run?.status?.toUpperCase() || 'LOADING'}
          </span>
          {connected && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex-1" />
        {run?.started_at && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Started {formatDateTime(run.started_at)}
          </span>
        )}
        {run?.duration_seconds != null && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {run.duration_seconds.toFixed(1)}s
          </span>
        )}
      </div>

      {/* Main content: Events (left) + Mermaid (right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: Events feed */}
        <div className="w-3/5 border-r border-gray-200 dark:border-[#3a3a4e] flex flex-col overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 dark:bg-[#2a2a3c] border-b border-gray-200 dark:border-[#3a3a4e] text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Events ({visibleEvents.length})
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {error && (
              <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
            {visibleEvents.length === 0 && !error && (
              <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                {connected ? 'Waiting for events...' : 'No events yet'}
              </div>
            )}
            {visibleEvents.map((event, idx) => (
              <EventCard
                key={
                  event.type === 'human_input_required' && event.request_id
                    ? `hitl-${event.request_id}`
                    : `${idx}-${event.type}`
                }
                event={event}
                onSubmit={submitInput}
                isSubmitted={
                  typeof event.request_id === 'string' && submittedAnswers.has(event.request_id)
                }
                submittedAnswer={
                  typeof event.request_id === 'string'
                    ? submittedAnswers.get(event.request_id)
                    : undefined
                }
              />
            ))}
            <div ref={eventsEndRef} />
          </div>
        </div>

        {/* Right pane: Mermaid diagram */}
        <div className="w-2/5 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0">
            {mermaid ? (
              <MermaidDiagram code={mermaid} className="h-full" />
            ) : (
              <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                Loading diagram...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventCard({ event, onSubmit, isSubmitted, submittedAnswer }: {
  event: RunEvent;
  onSubmit: (requestId: string, data: unknown) => void | Promise<void>;
  isSubmitted: boolean;
  submittedAnswer?: unknown;
}) {
  const type = event.type || 'unknown';

  // Human input required — polymorphic row keyed by request_type
  if (type === 'human_input_required' && event.request_id) {
    return (
      <HumanInputRow
        event={event}
        onSubmit={onSubmit}
        isSubmitted={isSubmitted}
        submittedAnswer={submittedAnswer}
      />
    );
  }

  // Completion events
  if (type === 'workflow_completed' || type === 'run_complete') {
    const status = event.status || 'completed';
    const isSuccess = status === 'completed';
    return (
      <div className={`px-3 py-2 rounded-lg border text-sm ${
        isSuccess
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
          : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
      }`}>
        {isSuccess ? '✅ Workflow completed' : `❌ Workflow ${status}`}
      </div>
    );
  }

  // Error events
  if (type === 'workflow_failed') {
    return (
      <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
        ❌ {event.error || 'Workflow failed'}
      </div>
    );
  }

  // Start event
  if (type === 'workflow_started') {
    return (
      <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-400">
        🚀 Workflow started: {(event.workflow_name as string) || ''}
      </div>
    );
  }

  // Human input received — small confirmation that the response was sent
  if (type === 'human_input_received') {
    return (
      <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800 rounded text-xs text-emerald-700 dark:text-emerald-400">
        ↩︎ Response sent
      </div>
    );
  }

  // Phase 5 — focused cosmetic styling for the AF event types that actually
  // fire on declarative workflows. Confirmed via probe of agent_framework
  // and agent_framework_declarative source: TryCatch and Foreach/RepeatUntil
  // do NOT emit dedicated control events; loop progress surfaces only as
  // repeated superstep_started/completed pairs, and try-block failures
  // surface as executor_failed followed by a recovery executor_invoked.
  if (type === 'executor_failed') {
    const nodeId = event.executor_id || event.error_executor_id;
    return (
      <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
        <div className="flex items-center gap-2 font-medium">
          <span>❌</span>
          <span>Executor failed</span>
          {nodeId && (
            <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs rounded font-mono">
              {nodeId}
            </span>
          )}
        </div>
        {(event.error_message || event.error) && (
          <div className="mt-1 text-xs">
            {event.error_type && <span className="font-medium">{event.error_type}: </span>}
            {event.error_message || event.error}
          </div>
        )}
      </div>
    );
  }

  if (type === 'warning') {
    const text = (event.message as string) || (typeof event.data === 'string' ? event.data : null);
    return (
      <div className="px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-400">
        <span className="font-medium">⚠ Warning</span>
        {text && <span className="ml-2">{text}</span>}
      </div>
    );
  }

  if (type === 'superstep_started' || type === 'superstep_completed') {
    const isStart = type === 'superstep_started';
    const iter = event.iteration;
    return (
      <div className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <span>{isStart ? '▸' : '◂'}</span>
        <span>Superstep {iter != null ? `#${iter}` : ''} {isStart ? 'started' : 'completed'}</span>
      </div>
    );
  }

  // Generic event — show all available details
  const icon = type.includes('invoke') || type.includes('start') ? '⚙️' :
    type.includes('complete') ? '✅' :
    type.includes('fail') || type.includes('error') ? '❌' :
    type.includes('input') ? '💬' : '📋';

  // Build a human-readable label
  const label = type.replace(/_/g, ' ');
  const nodeId = event.executor_id || event.source_executor_id;
  const sessionId = event.session_id;

  return (
    <div className="px-3 py-2 bg-white/50 dark:bg-[#2a2a3c]/50 border border-white/40 dark:border-[#3a3a4e] rounded-lg text-sm">
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300">{label}</span>
        {nodeId && (
          <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs rounded font-mono">
            {nodeId}
          </span>
        )}
        {event.iteration != null && (
          <span className="text-xs text-gray-400 dark:text-gray-500">step {event.iteration}</span>
        )}
        {sessionId && (
          <OpenWorkflowSessionButton sessionId={sessionId} label={nodeId || 'agent'} />
        )}
      </div>
      {event.state && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          State: <span className="font-medium">{event.state}</span>
        </div>
      )}
      {event.data != null && (
        <div className="mt-1 text-gray-600 dark:text-gray-400 text-xs whitespace-pre-wrap font-mono bg-gray-50 dark:bg-[#1e1e2e] rounded p-2 max-h-32 overflow-y-auto">
          {typeof event.data === 'string' ? event.data : JSON.stringify(event.data, null, 2)}
        </div>
      )}
      {event.output && (
        <div className="mt-1 text-gray-600 dark:text-gray-400 text-xs whitespace-pre-wrap">
          {typeof event.output === 'string' ? event.output : JSON.stringify(event.output, null, 2)}
        </div>
      )}
      {(event.error_message || event.error) && (
        <div className="mt-1 text-red-500 text-xs">
          {event.error_type && <span className="font-medium">{event.error_type}: </span>}
          {event.error_message || event.error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpenWorkflowSessionButton — opens the agent's Copilot session in a chat tab.
// Mirrors the TaskBoard "open automation session" flow but skips the
// setSessions push: workflow sessions are filtered out of the sidebar by
// trigger="workflow", and ChatPane fetches messages via getSession() directly.
// ---------------------------------------------------------------------------

function OpenWorkflowSessionButton({ sessionId, label }: { sessionId: string; label: string }) {
  const openTab = useTabStore(s => s.openTab);
  const [busy, setBusy] = useState(false);

  const handleOpen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const sessionData = await getSession(sessionId);
      useChatStore.getState().setMessages(sessionId, sessionData.messages);
      openTab({
        id: tabId.session(sessionId),
        type: 'session',
        label,
        sessionId,
      });
    } catch (err) {
      console.error('Failed to open workflow session:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={busy}
      title="Open this agent's Copilot session in a chat tab"
      className="ml-auto px-2 py-0.5 text-xs rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
    >
      ↗ Open session
    </button>
  );
}

// ---------------------------------------------------------------------------
// HumanInputRow — polymorphic by request_type
// ---------------------------------------------------------------------------

interface HumanInputRowProps {
  event: RunEvent;
  onSubmit: (requestId: string, data: unknown) => void | Promise<void>;
  isSubmitted: boolean;
  submittedAnswer?: unknown;
}

function formatSubmittedAnswer(value: unknown, requestType: string): string | null {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (typeof value === 'boolean') {
    if (requestType === 'confirmation') return value ? '✓ Approved' : '✕ Rejected';
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function HumanInputRow({ event, onSubmit, isSubmitted, submittedAnswer }: HumanInputRowProps) {
  const requestId = event.request_id as string;
  const requestType = (event.request_type || '').toLowerCase() as HumanInputKind | '';
  const message = (event.message as string) || '';
  const metadata = (event.metadata || {}) as Record<string, unknown>;
  const formattedAnswer = isSubmitted ? formatSubmittedAnswer(submittedAnswer, requestType) : null;

  // Fallback message: if backend didn't send a structured message, render
  // the raw data field as a JSON dump so the user still sees something.
  // Suppress the fallback when the data looks like an SDK object repr —
  // structured controls below render the actual UI, so an opaque dump
  // would only confuse the user.
  const looksLikeSdkRepr = (s: string) =>
    /^[A-Z][A-Za-z0-9_]*\(.*request_id=/.test(s);
  const rawData = event.data;
  const fallbackBody = !message && rawData != null
    ? (typeof rawData === 'string'
        ? (looksLikeSdkRepr(rawData) ? null : rawData)
        : JSON.stringify(rawData, null, 2))
    : null;

  return (
    <div
      data-testid={`hitl-row-${requestId}`}
      data-kind={requestType || 'unknown'}
      className={`px-3 py-3 rounded-lg border ${
        isSubmitted
          ? 'bg-gray-50 dark:bg-[#2a2a3c] border-gray-200 dark:border-[#3a3a4e] opacity-70'
          : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-2">
        ⏸ Human Input Required
        {requestType && (
          <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 text-xs rounded font-mono">
            {requestType}
          </span>
        )}
      </div>
      {message && (
        <div className="text-sm text-gray-700 dark:text-gray-200 mb-3 whitespace-pre-wrap">
          {message}
        </div>
      )}
      {!message && fallbackBody && (
        <div className="text-xs font-mono whitespace-pre-wrap text-gray-600 dark:text-gray-300 mb-3">
          {fallbackBody}
        </div>
      )}

      {!isSubmitted && requestType === 'confirmation' && (
        <ConfirmationInput
          metadata={metadata}
          disabled={false}
          onSubmit={(value) => onSubmit(requestId, value)}
        />
      )}
      {!isSubmitted && requestType === 'question' && (
        <QuestionInput
          metadata={metadata}
          disabled={false}
          onSubmit={(value) => onSubmit(requestId, value)}
        />
      )}
      {!isSubmitted && requestType === 'user_input' && (
        <UserInputInput
          metadata={metadata}
          disabled={false}
          onSubmit={(value) => onSubmit(requestId, value)}
        />
      )}
      {!isSubmitted && requestType === 'external' && (
        <ExternalInput
          metadata={metadata}
          disabled={false}
          onSubmit={(value) => onSubmit(requestId, value)}
        />
      )}
      {!isSubmitted && !['confirmation', 'question', 'user_input', 'external'].includes(requestType) && (
        // Unknown / unset request_type — fall back to bare confirm/reject so
        // the workflow can still progress.
        <ConfirmationInput
          metadata={metadata}
          disabled={false}
          onSubmit={(value) => onSubmit(requestId, value)}
        />
      )}

      {isSubmitted && (
        <div
          data-testid={`hitl-answer-${requestId}`}
          className="text-xs text-gray-600 dark:text-gray-300"
        >
          {formattedAnswer !== null ? (
            <>
              <span className="text-gray-500 dark:text-gray-400">↩ Response: </span>
              <span className="font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto inline-block align-top">
                {formattedAnswer}
              </span>
            </>
          ) : (
            <span className="text-gray-500 dark:text-gray-400">↩ Response submitted</span>
          )}
        </div>
      )}
    </div>
  );
}

function ConfirmationInput({
  metadata, disabled, onSubmit,
}: {
  metadata: Record<string, unknown>;
  disabled: boolean;
  onSubmit: (value: boolean) => void | Promise<void>;
}) {
  const yesLabel = (metadata.yes_label as string) || 'Approve';
  const noLabel = (metadata.no_label as string) || 'Reject';
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit(true)}
        className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        ✓ {yesLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSubmit(false)}
        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        ✕ {noLabel}
      </button>
    </div>
  );
}

function QuestionInput({
  metadata, disabled, onSubmit,
}: {
  metadata: Record<string, unknown>;
  disabled: boolean;
  onSubmit: (value: unknown) => void | Promise<void>;
}) {
  const choices = metadata.choices as HumanInputChoice[] | null | undefined;
  const allowFreeText = metadata.allow_free_text !== false; // default true
  const defaultValue = metadata.default_value;
  const [text, setText] = useState<string>(
    defaultValue != null ? String(defaultValue) : ''
  );

  if (choices && choices.length > 0) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c.value}
              type="button"
              disabled={disabled}
              onClick={() => onSubmit(c.value)}
              className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {c.label}
            </button>
          ))}
        </div>
        {allowFreeText && (
          <FreeTextSubmit disabled={disabled} value={text} setValue={setText} onSubmit={onSubmit} />
        )}
      </div>
    );
  }

  return <FreeTextSubmit disabled={disabled} value={text} setValue={setText} onSubmit={onSubmit} />;
}

function FreeTextSubmit({
  disabled, value, setValue, onSubmit,
}: {
  disabled: boolean;
  value: string;
  setValue: (v: string) => void;
  onSubmit: (value: unknown) => void | Promise<void>;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit(value);
      }}
      className="flex gap-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        className="flex-1 px-2 py-1 bg-white dark:bg-[#1e1e2e] border border-gray-300 dark:border-[#3a3a4e] rounded text-sm disabled:opacity-50"
        placeholder="Type your answer..."
      />
      <button
        type="submit"
        disabled={disabled}
        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Send
      </button>
    </form>
  );
}

function UserInputInput({
  metadata, disabled, onSubmit,
}: {
  metadata: Record<string, unknown>;
  disabled: boolean;
  onSubmit: (value: unknown) => void | Promise<void>;
}) {
  const [text, setText] = useState<string>('');
  const timeoutSeconds = metadata.timeout_seconds as number | null | undefined;
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        rows={3}
        className="w-full px-2 py-1 bg-white dark:bg-[#1e1e2e] border border-gray-300 dark:border-[#3a3a4e] rounded text-sm font-mono disabled:opacity-50"
        placeholder="Provide input..."
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(text)}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
        {timeoutSeconds != null && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Timeout: {timeoutSeconds}s
          </span>
        )}
      </div>
    </div>
  );
}

function ExternalInput({
  metadata, disabled, onSubmit,
}: {
  metadata: Record<string, unknown>;
  disabled: boolean;
  onSubmit: (value: unknown) => void | Promise<void>;
}) {
  const requiredFields = metadata.required_fields as string[] | null | undefined;

  // If we have a schema, render a per-field form; otherwise textarea fallback
  // for raw JSON input.
  if (requiredFields && requiredFields.length > 0) {
    return (
      <ExternalSchemaForm
        fields={requiredFields}
        disabled={disabled}
        onSubmit={onSubmit}
      />
    );
  }

  return <ExternalRawJson disabled={disabled} onSubmit={onSubmit} />;
}

function ExternalSchemaForm({
  fields, disabled, onSubmit,
}: {
  fields: string[];
  disabled: boolean;
  onSubmit: (value: unknown) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [f, '']))
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        // Wrap the schema values as the response payload's `value`.
        onSubmit({ value: values });
      }}
      className="space-y-2"
    >
      {fields.map((field) => (
        <label key={field} className="block">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-0.5">
            {field}
          </span>
          <input
            type="text"
            value={values[field] || ''}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field]: e.target.value }))
            }
            disabled={disabled}
            className="w-full px-2 py-1 bg-white dark:bg-[#1e1e2e] border border-gray-300 dark:border-[#3a3a4e] rounded text-sm disabled:opacity-50"
          />
        </label>
      ))}
      <button
        type="submit"
        disabled={disabled}
        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Submit
      </button>
    </form>
  );
}

function ExternalRawJson({
  disabled, onSubmit,
}: {
  disabled: boolean;
  onSubmit: (value: unknown) => void | Promise<void>;
}) {
  const [text, setText] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setParseError(null);
        }}
        disabled={disabled}
        rows={4}
        className="w-full px-2 py-1 bg-white dark:bg-[#1e1e2e] border border-gray-300 dark:border-[#3a3a4e] rounded text-sm font-mono disabled:opacity-50"
        placeholder='{"value": "..."} or any JSON'
      />
      {parseError && (
        <div className="text-xs text-red-500">{parseError}</div>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          // Try to parse JSON; if not JSON, send as raw string.
          let payload: unknown = text;
          if (text.trim()) {
            try {
              payload = JSON.parse(text);
            } catch {
              // Not JSON — submit as raw string.
            }
          }
          setParseError(null);
          onSubmit(payload);
        }}
        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Submit
      </button>
    </div>
  );
}
