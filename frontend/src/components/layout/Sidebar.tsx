import { useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useTabStore, tabId } from '../../stores/tabStore';
import { useAgentMonitorStore } from '../../stores/agentMonitorStore';
import { useAgentStore } from '../../stores/agentStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAutomationStore } from '../../stores/automationStore';
import { useProjectStore } from '../../stores/projectStore';
import { listSessions } from '../../api/sessions';
import { fetchModels } from '../../api/models';
import { getSettings } from '../../api/settings';
import { getActiveAgents } from '../../api/activeAgents';
import { SessionList } from '../session/SessionList';
import { Button } from '../common/Button';

export function Sidebar() {
  const { sessions, setSessions, startNewSession, setLoading, setError } = useSessionStore();
  const { setAvailableModels, setDefaultModel, setDefaultCwd, openSettingsModal, defaultModel, defaultCwd } = useUIStore();
  const { activeTabId, openTab } = useTabStore();
  const { setOpen: setAgentMonitorOpen, activeCount, setActiveCount } = useAgentMonitorStore();
  const { agents, fetchAgents } = useAgentStore();
  const { workflows, fetchWorkflows } = useWorkflowStore();
  const { automations, fetchAutomations } = useAutomationStore();
  const { selectedProject, selectProject, loadProjects } = useProjectStore();
  // Subscribe to projects so component re-renders when mappings load
  const projects = useProjectStore(s => s.projects);
  const [sessionSearch, setSessionSearch] = useState('');

  // Inline helper that uses current projects state for reactivity
  const getProjectName = (cwd: string): string => {
    if (!cwd) return '';
    const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    for (const [storedCwd, name] of Object.entries(projects)) {
      if (storedCwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === norm) {
        return name;
      }
    }
    const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized.split('/').pop() || cwd;
  };

  // Poll for active agents count every 5 seconds
  useEffect(() => {
    const fetchActiveCount = async () => {
      try {
        const data = await getActiveAgents();
        setActiveCount(data.count);
      } catch {
        // Ignore errors for polling
      }
    };
    
    fetchActiveCount();
    const interval = setInterval(fetchActiveCount, 5000);
    return () => clearInterval(interval);
  }, [setActiveCount]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [sessionsData, modelsData, settingsData] = await Promise.all([
          listSessions(),
          fetchModels(),
          getSettings(),
        ]);
        setSessions(sessionsData);
        setAvailableModels(modelsData);
        setDefaultModel(settingsData.default_model);
        if (settingsData.default_cwd) {
          setDefaultCwd(settingsData.default_cwd);
        }
        fetchAgents();
        fetchWorkflows();
        fetchAutomations();
        loadProjects();
      } catch (err) {
        // Backend may not be ready yet (dev mode race) — retry once after 2s
        console.warn('Initial load failed, retrying in 2s...', err);
        await new Promise(r => setTimeout(r, 2000));
        try {
          const [sessionsData, modelsData, settingsData] = await Promise.all([
            listSessions(),
            fetchModels(),
            getSettings(),
          ]);
          setSessions(sessionsData);
          setAvailableModels(modelsData);
          setDefaultModel(settingsData.default_model);
          if (settingsData.default_cwd) {
            setDefaultCwd(settingsData.default_cwd);
          }
          fetchAgents();
          fetchWorkflows();
          fetchAutomations();
        } catch (retryErr) {
          setError(retryErr instanceof Error ? retryErr.message : 'Failed to load data');
        }
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [setSessions, setAvailableModels, setDefaultModel, setDefaultCwd, setLoading, setError, fetchAgents, fetchWorkflows, fetchAutomations, loadProjects]);

  const handleNewSession = async () => {
    // startNewSession now refreshes MCP servers automatically and enables all by default
    await startNewSession(defaultModel, defaultCwd);
  };

  return (
    <aside className="w-72 bg-white dark:bg-[#252536] text-gray-900 dark:text-gray-100 flex flex-col overflow-y-auto border-r border-gray-200 dark:border-[#3a3a4e] shadow-sm dark:shadow-black/20">
      {/* Header - sticky at top */}
      <div className="sticky top-0 bg-white dark:bg-[#252536] px-4 pt-3 pb-3 border-b border-gray-200 dark:border-[#3a3a4e] z-10">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-6 h-6 text-emerald-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
          </svg>
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex-1">Copilot Console</h1>
        </div>
        <Button
          variant="primary"
          className="w-full"
          onClick={handleNewSession}
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </Button>

        {/* Agent Monitor Button */}
        <button
          onClick={() => setAgentMonitorOpen(true)}
          className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm bg-gray-50 dark:bg-[#2a2a3c] hover:bg-gray-100 dark:hover:bg-[#32324a] text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-[#3a3a4e]"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Active Agents
          {activeCount > 0 && (
            <span className="relative flex h-5 min-w-5 items-center justify-center">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex items-center justify-center rounded-full h-5 min-w-5 px-1 bg-emerald-500 text-white text-xs">
                {activeCount}
              </span>
            </span>
          )}
        </button>
      </div>

      {/* Navigation — flat entries */}
      <div className="px-3 pt-2 pb-1 border-b border-gray-200 dark:border-[#3a3a4e]">
        <button
          onClick={() => {
            fetchAgents();
            openTab({ id: tabId.agentLibrary(), type: 'agent-library', label: 'Agent Library' });
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
            activeTabId === tabId.agentLibrary()
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#32324a]'
          }`}
        >
          <span>🤖</span>
          Agents
          {agents.length > 0 && (
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{agents.length}</span>
          )}
        </button>
        <button
          onClick={() => {
            fetchWorkflows();
            openTab({ id: tabId.workflowLibrary(), type: 'workflow-library', label: 'Workflow Library' });
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
            activeTabId === tabId.workflowLibrary()
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#32324a]'
          }`}
        >
          <span>🔀</span>
          Workflows
          {workflows.length > 0 && (
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{workflows.length}</span>
          )}
        </button>
        <button
          onClick={() => {
            fetchAutomations();
            openTab({ id: tabId.automationManager(), type: 'automation-manager', label: 'Automations' });
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
            activeTabId?.startsWith('automation-manager')
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#32324a]'
          }`}
        >
          <span>⏰</span>
          Automations
          {automations.length > 0 && (
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{automations.length}</span>
          )}
        </button>
        <button
          onClick={() => {
            openTab({ id: tabId.taskBoard(), type: 'task-board', label: 'Runs' });
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
            activeTabId === tabId.taskBoard()
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#32324a]'
          }`}
        >
          <span>📋</span>
          Runs
        </button>
      </div>

      {/* Session List - grows to fill space, overflow hidden for virtual scroll */}
      <div className="flex-1 overflow-hidden p-3 flex flex-col">
        {/* Folder filter */}
        {sessions.length > 0 && (() => {
          // Build unique folder entries: { name, cwd (shortest path for that name) }
          const folderMap = new Map<string, string>(); // name → cwd
          sessions
            .filter(s => s.trigger !== 'automation' && s.cwd)
            .forEach(s => {
              const name = getProjectName(s.cwd!);
              if (!folderMap.has(name)) folderMap.set(name, s.cwd!);
            });
          const folderEntries = [...folderMap.entries()]
            .map(([name, cwd]) => {
              const segments = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
              const shortPath = segments.length <= 3 ? cwd : '…/' + segments.slice(-2).join('/');
              return { name, path: shortPath };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          return folderEntries.length > 1 ? (
            <select
              value={selectedProject || ''}
              onChange={e => selectProject(e.target.value || null)}
              className="mb-2 flex-shrink-0 w-full max-w-full px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#2a2a3c] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 overflow-hidden text-ellipsis"
            >
              <option value="">All Folders ({folderEntries.length})</option>
              {folderEntries.map(({ name, path }) => (
                <option key={name} value={name}>{name} ({path})</option>
              ))}
            </select>
          ) : null;
        })()}
        {sessions.length > 0 && (() => {
          const filteredSessions = sessions.filter(s => {
            if (s.trigger === 'automation') return false;
            if (selectedProject) {
              if (!s.cwd) return false;
              if (getProjectName(s.cwd) !== selectedProject) return false;
            }
            if (!sessionSearch) return true;
            const q = sessionSearch.toLowerCase();
            return (s.session_name || '').toLowerCase().includes(q);
          });
          const placeholder = selectedProject
            ? `Search ${filteredSessions.length} ${selectedProject} sessions...`
            : `Search ${filteredSessions.length} sessions...`;
          return (
            <>
              <div className="relative mb-2 flex-shrink-0">
                <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder={placeholder}
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#2a2a3c] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
                {sessionSearch && (
                  <button
                    onClick={() => setSessionSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="Clear search"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <SessionList sessions={filteredSessions} />
              </div>
            </>
          );
        })()}
      </div>

      {/* User Settings Footer - sticky at bottom */}
      <div className="sticky bottom-0 p-2 border-t border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#252536]">
        <button
          onClick={openSettingsModal}
          title="Settings · v0.4.0"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-[#32324a] transition-colors"
        >
          <span className="text-base">⚙️</span>
          <span className="flex-1 text-left text-sm font-medium text-gray-900 dark:text-gray-100">Settings</span>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">v0.4.0</span>
        </button>
      </div>
    </aside>
  );
}
