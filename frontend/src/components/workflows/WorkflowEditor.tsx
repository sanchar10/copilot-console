/**
 * Workflow Editor — three-pane layout: Mermaid diagram (left), YAML editor (right),
 * run history panel (bottom, collapsible).
 *
 * Provides CRUD operations and visual feedback for workflow YAML.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { formatDateTime } from '../../utils/formatters';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useTabStore, tabId } from '../../stores/tabStore';
import { MermaidDiagram } from '../chat/MermaidDiagram';
import { FolderBrowserModal } from '../common/FolderBrowserModal';
import { ConfirmModal } from '../common/ConfirmModal';
import * as workflowsApi from '../../api/workflows';
import type { WorkflowDetail, WorkflowRunSummary } from '../../types/workflow';
import { useToastStore } from '../../stores/toastStore';

const DEFAULT_YAML = `kind: Workflow
name: my-workflow
description: A new workflow
trigger:
  kind: OnConversationStart
  id: start
  actions:
    - kind: InvokeAzureAgent
      id: step-1
      agent:
        name: agent-name
`;

interface WorkflowEditorProps {
  workflowId: string;
}

export function WorkflowEditor({ workflowId }: WorkflowEditorProps) {
  const { openTab, replaceTab } = useTabStore();
  const { fetchWorkflows } = useWorkflowStore();

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [yamlContent, setYamlContent] = useState(DEFAULT_YAML);
  const [name, setName] = useState('');
  const [description, setDescription] = useState(workflowId === 'new' ? 'A new workflow' : '');
  const [mermaid, setMermaid] = useState<string | null>(null);
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(workflowId !== 'new');
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [showRuns, setShowRuns] = useState(true);
  const [showRunInput, setShowRunInput] = useState(false);

  // Stable toast ids per workflow so retries replace the previous error toast
  // (sticky, dismissible) instead of stacking. Cleared on success.
  const saveToastId = `workflow-save-${workflowId}`;
  const runToastId = `workflow-run-${workflowId}`;
  const [runMessage, setRunMessage] = useState('');
  const [runCwd, setRunCwd] = useState('');
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNew = workflowId === 'new';

  // Load existing workflow
  useEffect(() => {
    if (isNew) return;
    // Skip re-fetch if data was already populated (e.g., after create/save)
    if (workflow && workflow.id === workflowId) return;
    setLoading(true);
    workflowsApi.getWorkflow(workflowId)
      .then((detail) => {
        setWorkflow(detail);
        setYamlContent(detail.yaml_content);
        setName(detail.name);
        setDescription(detail.description);
        setLoading(false);
        // Initial mermaid render
        workflowsApi.visualizeWorkflow(workflowId)
          .then((r) => { setMermaid(r.mermaid); setMermaidError(null); })
          .catch(() => setMermaidError('Failed to generate diagram'));
      })
      .catch(() => setLoading(false));

    // Load runs
    workflowsApi.listWorkflowRuns(workflowId, 50)
      .then((resp) => { setRuns(resp.items); setTotalRuns(resp.total); })
      .catch(() => {});
  }, [workflowId, isNew]);

  // Live-refresh the run list while any visible row is in an active state.
  // Mount-time fetch already handles "opened editor while runs in progress";
  // this covers "user is staring at the editor while a run advances".
  // Idle (all rows terminal) → no interval, no CPU. Cleans up on unmount.
  useEffect(() => {
    if (isNew) return;
    const hasActive = runs.some((r) => r.status === 'running' || r.status === 'paused');
    if (!hasActive) return;
    const id = setInterval(() => {
      workflowsApi.listWorkflowRuns(workflowId, 50)
        .then((resp) => { setRuns(resp.items); setTotalRuns(resp.total); })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [runs, workflowId, isNew]);

  // Debounced mermaid preview on YAML changes
  const updateMermaidPreview = useCallback((_yaml: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        // For unsaved workflows, use validate endpoint via create-then-visualize isn't available
        // We send the YAML to be validated; if valid, the backend returns mermaid
        if (isNew || !workflow) {
          // We can't visualize unsaved workflows — just clear error
          setMermaidError(null);
          setMermaid(null);
          return;
        }
        // For saved workflows, save first then visualize
        const result = await workflowsApi.visualizeWorkflow(workflowId);
        setMermaid(result.mermaid);
        setMermaidError(null);
      } catch (e) {
        setMermaidError((e as Error).message);
      }
    }, 800);
  }, [workflowId, isNew, workflow]);

  const handleYamlChange = (value: string) => {
    setYamlContent(value);
    setDirty(true);
    updateMermaidPreview(value);
  };

  const handleSave = async () => {
    setSaving(true);
    useToastStore.getState().removeToast(saveToastId);
    try {
      let saved;
      if (isNew) {
        const created = await workflowsApi.createWorkflow({
          name: 'new-workflow',
          yaml_content: yamlContent,
        });
        saved = created;
        // Pre-populate local state so useEffect doesn't re-fetch
        setWorkflow(created as unknown as WorkflowDetail);
        setName(created.name);
        setDescription(created.description);
        setDirty(false);
        // Fetch mermaid for the newly created workflow
        workflowsApi.visualizeWorkflow(created.id)
          .then((r) => { setMermaid(r.mermaid); setMermaidError(null); })
          .catch(() => setMermaidError('Failed to generate diagram'));
        // Load run history
        workflowsApi.listWorkflowRuns(created.id, 50)
          .then((resp) => { setRuns(resp.items); setTotalRuns(resp.total); })
          .catch(() => {});
        // Replace the "new" tab in-place with the saved workflow's tab
        replaceTab(tabId.workflowEditor('new'), {
          id: tabId.workflowEditor(created.id),
          type: 'workflow-editor',
          label: created.name,
          workflowId: created.id,
        });
        fetchWorkflows();
      } else {
        const updated = await workflowsApi.updateWorkflow(workflowId, {
          yaml_content: yamlContent,
        });
        saved = updated;
        setName(updated.name);
        setDescription(updated.description);
        // Refresh mermaid
        workflowsApi.visualizeWorkflow(workflowId)
          .then((r) => { setMermaid(r.mermaid); setMermaidError(null); })
          .catch(() => {});
        fetchWorkflows();
      }
      setDirty(false);
      // Warn if the saved workflow uses Power Fx but this server can't run it.
      if (saved && saved.uses_powerfx && saved.powerfx_available === false) {
        useToastStore.getState().addToast(
          "Saved. This workflow uses Power Fx (=expressions), but this server can't evaluate them — install .NET 6+ and the powerfx package, or run elsewhere.",
          'warning',
          { duration: 8000, id: `workflow-powerfx-${saved.id}` },
        );
      }
    } catch (e) {
      useToastStore.getState().addToast(
        `Save failed: ${(e as Error).message}`,
        'error',
        { duration: 0, id: saveToastId },
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async (message?: string) => {
    if (isNew) {
      useToastStore.getState().addToast(
        'Save the workflow before running.',
        'warning',
        { duration: 4000, id: runToastId },
      );
      return;
    }
    useToastStore.getState().removeToast(runToastId);
    setShowRunInput(false);
    try {
      const request: Record<string, unknown> = {};
      if (message?.trim()) request.message = message.trim();
      if (runCwd.trim()) request.cwd = runCwd.trim();
      const result = await workflowsApi.runWorkflow(workflowId, Object.keys(request).length ? request : undefined);
      // Refetch the run list so the new row appears immediately and the
      // polling effect can pick it up while it's active.
      workflowsApi.listWorkflowRuns(workflowId, 50)
        .then((resp) => { setRuns(resp.items); setTotalRuns(resp.total); })
        .catch(() => {});
      openTab({
        id: tabId.workflowRun(result.run_id),
        type: 'workflow-run',
        label: `Run: ${name || 'Workflow'}`,
        workflowId,
        runId: result.run_id,
      });
    } catch (e) {
      useToastStore.getState().addToast(
        `Run failed: ${(e as Error).message}`,
        'error',
        { duration: 0, id: runToastId },
      );
    }
  };

  const handleDelete = async () => {
    if (isNew) return;
    try {
      await workflowsApi.deleteWorkflow(workflowId);
      fetchWorkflows();
      useTabStore.getState().closeTab(tabId.workflowEditor(workflowId));
    } catch (e) {
      useToastStore.getState().addToast(
        `Delete failed: ${(e as Error).message}`,
        'error',
        { duration: 0, id: `workflow-delete-${workflowId}` },
      );
    }
  };

  const handleRunClick = (runId: string) => {
    openTab({
      id: tabId.workflowRun(runId),
      type: 'workflow-run',
      label: `Run: ${name || 'Workflow'}`,
      workflowId,
      runId,
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
        Loading workflow...
      </div>
    );
  }

  return (
    <>
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#252536]">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">
          {name || (isNew ? 'New Workflow' : 'Untitled')}
        </h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          {dirty && (
            <span className="text-xs text-amber-500 dark:text-amber-400">Unsaved</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {!isNew && (
            <>
              <div className="relative">
                <button
                  onClick={() => setShowRunInput(!showRunInput)}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  ▶ Run
                </button>
                {showRunInput && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-[#2a2a3c] border border-gray-200 dark:border-[#3a3a4e] rounded-lg shadow-lg p-3 w-80">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Input message (optional)
                    </label>
                    <textarea
                      value={runMessage}
                      onChange={(e) => setRunMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRun(runMessage); } }}
                      placeholder="e.g. Research AI agents"
                      rows={3}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 dark:border-[#3a3a4e] rounded bg-white dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100 mb-2 resize-y overflow-auto"
                      autoFocus
                    />
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Working directory (optional)
                    </label>
                    <div className="flex gap-1 mb-2">
                      <input
                        type="text"
                        value={runCwd}
                        onChange={(e) => setRunCwd(e.target.value)}
                        placeholder="Default: workflow-runs/{run_id}/"
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-[#3a3a4e] rounded bg-white dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100"
                      />
                      <button
                        onClick={() => setShowFolderBrowser(true)}
                        className="px-2 py-1.5 text-sm border border-gray-200 dark:border-[#3a3a4e] rounded hover:bg-gray-100 dark:hover:bg-[#3a3a4e] transition-colors"
                        title="Browse folders"
                      >
                        📁
                      </button>
                    </div>
                    <button
                      onClick={() => handleRun(runMessage)}
                      className="w-full px-2 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition-colors"
                    >
                      Run
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm transition-colors"
                title="Delete workflow"
              >
                🗑
              </button>
            </>
          )}
        </div>
      </div>

      {/* Description */}
      {description && (
        <div className="px-4 py-1 border-b border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#252536]">
          <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
            {description}
          </p>
        </div>
      )}

      {/* Main content: YAML Editor (left) + Mermaid (right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: YAML editor */}
        <div className="w-3/5 border-r border-gray-200 dark:border-[#3a3a4e] flex flex-col overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 dark:bg-[#2a2a3c] border-b border-gray-200 dark:border-[#3a3a4e] text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            YAML Definition
          </div>
          <div className="flex-1 overflow-hidden">
            <textarea
              value={yamlContent}
              onChange={(e) => handleYamlChange(e.target.value)}
              spellCheck={false}
              className="w-full h-full p-4 font-mono text-sm bg-gray-900 text-gray-100 resize-none outline-none border-none"
              style={{ tabSize: 2 }}
            />
          </div>
        </div>

        {/* Right pane: Mermaid diagram */}
        <div className="w-2/5 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0">
            {mermaid ? (
              <MermaidDiagram code={mermaid} className="h-full" />
            ) : mermaidError ? (
              <div className="text-sm text-red-500 dark:text-red-400 p-4">
                {mermaidError}
              </div>
            ) : (
              <div className="text-sm text-gray-400 dark:text-gray-500 p-4 text-center">
                {isNew ? 'Save the workflow to see a preview' : 'Loading preview...'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom panel: Run History (collapsible) */}
      {!isNew && (
        <div className={`border-t border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#252536] ${showRuns ? 'h-48' : 'h-8'} transition-all`}>
          <button
            onClick={() => setShowRuns(!showRuns)}
            className="w-full flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a2a3c] transition-colors"
          >
            <svg className={`w-3 h-3 transition-transform ${showRuns ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
            Run History (showing {runs.length} of {totalRuns})
          </button>
          {showRuns && (
            <div className="overflow-y-auto px-4 pb-2" style={{ height: 'calc(100% - 28px)' }}>
              {runs.length === 0 ? (
                <div className="text-xs text-gray-400 dark:text-gray-500 py-2">No runs yet</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-[#3a3a4e]">
                      <th className="text-left py-1 font-medium">Run ID</th>
                      <th className="text-left py-1 font-medium">Status</th>
                      <th className="text-left py-1 font-medium">Started</th>
                      <th className="text-left py-1 font-medium">Duration</th>
                      <th className="text-left py-1 font-medium">Error</th>
                      <th className="text-right py-1 font-medium w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <RunRow
                        key={run.id}
                        run={run}
                        onClick={() => handleRunClick(run.id)}
                        onDeleted={() => {
                          setRuns((prev) => prev.filter((r) => r.id !== run.id));
                          setTotalRuns((prev) => Math.max(0, prev - 1));
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>

    <FolderBrowserModal
      isOpen={showFolderBrowser}
      onClose={() => setShowFolderBrowser(false)}
      onSelect={(path) => {
        setRunCwd(path);
        setShowFolderBrowser(false);
      }}
      initialPath={runCwd || undefined}
    />
    <ConfirmModal
      isOpen={showDeleteConfirm}
      title="Delete Workflow"
      message={`Are you sure you want to delete "${name}"? This cannot be undone.`}
      confirmLabel="Delete"
      onConfirm={() => {
        setShowDeleteConfirm(false);
        handleDelete();
      }}
      onCancel={() => setShowDeleteConfirm(false)}
    />
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
    running: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    paused: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    completed: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    aborted: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}

function RunRow({ run, onClick, onDeleted }: {
  run: WorkflowRunSummary;
  onClick: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      const result = await workflowsApi.deleteWorkflowRun(run.id);
      const removed = (result as { sessions_removed?: number }).sessions_removed;
      if (typeof removed === 'number' && removed > 0) {
        useToastStore.getState().addToast(
          `Run deleted (${removed} session${removed === 1 ? '' : 's'} removed)`,
          'success',
          3000,
        );
      }
      onDeleted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete workflow run';
      useToastStore.getState().addToast(msg, 'error', 6000);
      setConfirming(false);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  };

  return (
    <tr
      onClick={onClick}
      className="hover:bg-gray-50 dark:hover:bg-[#2a2a3c] cursor-pointer border-b border-gray-50 dark:border-[#3a3a4e]"
    >
      <td className="py-1.5 text-gray-400 dark:text-gray-500 font-mono">
        {run.id.slice(0, 8)}
      </td>
      <td className="py-1.5">
        <StatusBadge status={run.status} />
      </td>
      <td className="py-1.5 text-gray-500 dark:text-gray-400">
        {run.started_at ? formatDateTime(run.started_at) : '—'}
      </td>
      <td className="py-1.5 text-gray-500 dark:text-gray-400">
        {run.duration_seconds != null ? `${run.duration_seconds.toFixed(1)}s` : '—'}
      </td>
      <td className="py-1.5 text-red-500 truncate max-w-[200px]" title={run.error || ''}>
        {run.error || ''}
      </td>
      <td className="py-1.5 text-right">
        {confirming ? (
          <span className="inline-flex gap-1">
            <button
              onClick={handleDelete}
              className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px] font-medium hover:bg-red-700 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={handleCancel}
              className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-[10px] font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={handleDelete}
            className="px-1 py-0.5 text-gray-400 hover:text-red-500 transition-colors text-xs"
            title="Delete run"
          >
            🗑
          </button>
        )}
      </td>
    </tr>
  );
}
