/**
 * Workflow Library — grid view of all defined workflows.
 * Follows the same pattern as AgentLibrary.
 */

import { useEffect, useState } from 'react';
import { formatRelativeTime } from '../../utils/formatters';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useTabStore, tabId } from '../../stores/tabStore';
import { Dropdown } from '../common/Dropdown';
import type { WorkflowMetadata } from '../../types/workflow';

function WorkflowCard({ workflow }: { workflow: WorkflowMetadata }) {
  const { openTab } = useTabStore();

  const handleClick = () => {
    openTab({
      id: tabId.workflowEditor(workflow.id),
      type: 'workflow-editor',
      label: workflow.name,
      workflowId: workflow.id,
    });
  };

  const handleRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Open editor with immediate run (editor will handle)
    openTab({
      id: tabId.workflowEditor(workflow.id),
      type: 'workflow-editor',
      label: workflow.name,
      workflowId: workflow.id,
    });
  };

  const timeAgo = formatRelativeTime(workflow.updated_at);

  return (
    <button
      onClick={handleClick}
      className="bg-white/50 dark:bg-[#2a2a3c]/50 backdrop-blur border border-white/40 dark:border-[#3a3a4e] rounded-xl p-5 text-left hover:border-blue-300/60 dark:hover:border-blue-500/40 hover:shadow-md transition-all group relative"
    >
      <div className="flex items-start justify-between">
        <div className="text-3xl mb-3">🔀</div>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span
            onClick={handleRun}
            title="Run this workflow"
            className="px-2.5 py-1 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 cursor-pointer"
          >
            ▶ Run
          </span>
        </div>
      </div>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
        {workflow.name}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
        {workflow.description || 'No description'}
      </p>
      <div className="flex items-center gap-2 mt-3 text-xs text-gray-400 dark:text-gray-500">
        <span>{timeAgo}</span>
      </div>
    </button>
  );
}

type SortKey = 'name' | 'updated';

export function WorkflowLibrary() {
  const { workflows, loading, fetchWorkflows } = useWorkflowStore();
  const { openTab } = useTabStore();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('updated');

  useEffect(() => {
    if (workflows.length === 0 && !loading) {
      fetchWorkflows();
    }
  }, [fetchWorkflows]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewWorkflow = () => {
    openTab({
      id: tabId.workflowEditor('new'),
      type: 'workflow-editor',
      label: 'New Workflow',
      workflowId: 'new',
    });
  };

  const filtered = workflows
    .filter((w) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🔀 Workflow Library</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Create and manage workflows
            </p>
          </div>
          <button
            onClick={handleNewWorkflow}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Workflow
          </button>
        </div>

        {/* Search + Sort */}
        {workflows.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search workflows..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#2a2a3c] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            <Dropdown
              options={[
                { value: 'updated', label: 'Last edited' },
                { value: 'name', label: 'Name' },
              ]}
              value={sortBy}
              onChange={v => setSortBy(v as SortKey)}
              variant="compact"
            />
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">Loading workflows...</div>
        ) : filtered.length === 0 && !search ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🔀</div>
            <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">No workflows yet</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Create your first workflow to get started
            </p>
            <button
              onClick={handleNewWorkflow}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              Create Workflow
            </button>
          </div>
        ) : filtered.length === 0 && search ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            No workflows matching "{search}"
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((workflow) => (
              <WorkflowCard key={workflow.id} workflow={workflow} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
