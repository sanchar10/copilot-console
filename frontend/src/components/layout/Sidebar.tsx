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
import { subscribeToActiveAgents } from '../../api/activeAgents';
import { apiClient } from '../../api/client';
import { useViewedStore } from '../../stores/viewedStore';
import { Dropdown } from '../common/Dropdown';
import { withRetry } from '../../utils/retry';
import { SessionList } from '../session/SessionList';
import { Button } from '../common/Button';
import { SearchModal } from '../search/SearchModal';
import { useAuthStore, type AuthStatus } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';

export function Sidebar() {
  const { sessions, setSessions, startNewSession, setLoading, setError } = useSessionStore();
  const { setAvailableModels, setDefaultModel, setDefaultReasoningEffort, setDefaultCwd, openSettingsModal, defaultModel, defaultReasoningEffort, defaultCwd } = useUIStore();
  const { activeTabId, openTab } = useTabStore();
  const { setOpen: setAgentMonitorOpen, activeCount, setActiveCount } = useAgentMonitorStore();
  const { agents, fetchAgents } = useAgentStore();
  const { workflows, fetchWorkflows } = useWorkflowStore();
  const { automations, fetchAutomations } = useAutomationStore();
  const { selectedProject, selectProject, loadProjects } = useProjectStore();
  // Subscribe to projects so component re-renders when mappings load
  const projects = useProjectStore(s => s.projects);
  const [searchOpen, setSearchOpen] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const authStatus = useAuthStore(s => s.status);
  const setAuthStatus = useAuthStore(s => s.setStatus);

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

  const setActiveAgentIds = useViewedStore(s => s.setActiveAgentIds);

  // Detect macOS for keyboard shortcut labels
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // Ctrl+K / Cmd+K global shortcut to open search
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, []);

  // Subscribe to active-agents SSE stream — replaces polling
  useEffect(() => {
    const controller = subscribeToActiveAgents(
      (data) => {
        setActiveCount(data.count);
        setActiveAgentIds(new Set(data.sessions.map(s => s.session_id)));
      },
      (sessionId, updatedAt) => {
        // Agent completed: update the session's updated_at so hasUnread() works
        if (updatedAt) {
          const iso = new Date(updatedAt * 1000).toISOString();
          useSessionStore.getState().setSessions(
            useSessionStore.getState().sessions.map(s =>
              s.session_id === sessionId ? { ...s, updated_at: iso } : s
            )
          );
        }
        // If user is currently viewing this session, mark as viewed
        const activeSessionId = useTabStore.getState().getActiveSessionId();
        if (activeSessionId === sessionId) {
          useViewedStore.getState().markViewed(sessionId);
        }
      },
      (_error) => {
        // SSE disconnected — will auto-reconnect on next mount
      }
    );
    return () => controller.abort();
  }, [setActiveCount, setActiveAgentIds]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [sessionsData, modelsData, settingsData, authData] = await withRetry(() =>
          Promise.all([listSessions(), fetchModels(), getSettings(), apiClient.get<AuthStatus>('/auth/status')])
        );
        setSessions(sessionsData);
        setAvailableModels(modelsData);
        setAuthStatus(authData);
        setDefaultModel(settingsData.default_model);
        setDefaultReasoningEffort(settingsData.default_reasoning_effort ?? null);
        if (settingsData.default_cwd) {
          setDefaultCwd(settingsData.default_cwd);
        }
        fetchAgents();
        fetchWorkflows();
        fetchAutomations();
        loadProjects();
        // Load desktop notification setting (non-blocking)
        if (settingsData.desktop_notifications) {
          import('../../utils/desktopNotifications').then(({ setDesktopNotificationSetting }) => {
            setDesktopNotificationSetting(settingsData.desktop_notifications as 'all' | 'input_only' | 'off');
          });
        }
        // Fetch app version (non-blocking, server is confirmed up)
        apiClient.get<{ current_version: string }>('/settings/update-check')
          .then(info => setAppVersion(info.current_version))
          .catch(() => {});
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [setSessions, setAvailableModels, setDefaultModel, setDefaultReasoningEffort, setDefaultCwd, setLoading, setError, fetchAgents, fetchWorkflows, fetchAutomations, loadProjects]);

  const handleNewSession = async () => {
    let cwd = defaultCwd;

    // When a project filter is active, use that project's folder as CWD
    if (selectedProject) {
      const match = sessions.find(
        s => s.trigger !== 'automation' && s.cwd && getProjectName(s.cwd) === selectedProject
      );
      if (match?.cwd) {
        // Verify the folder still exists via browse endpoint
        try {
          await apiClient.get(`/filesystem/browse?path=${encodeURIComponent(match.cwd)}`);
          cwd = match.cwd;
          useToastStore.getState().addToast(
            `Session started in project: ${selectedProject}`,
            'info',
          );
        } catch {
          useToastStore.getState().addToast(
            'Project folder not found, creating session in default folder',
            'warning',
          );
        }
      }
    }

    await startNewSession(defaultModel, cwd, defaultReasoningEffort);
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
          <button
            onClick={() => setSearchOpen(true)}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#32324a] transition-colors"
            title={`Search sessions (${isMac ? '⌘K' : 'Ctrl+K'})`}
            aria-label="Search sessions"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
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
      <div className="flex-1 overflow-hidden pl-4 pt-3 pb-3 flex flex-col">
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
              return { name, path: shortPath, fullPath: cwd };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          const totalNonAutoSessions = sessions.filter(s => s.trigger !== 'automation').length;
          const dropdownOptions = [
            { value: '', label: `All Projects (${folderEntries.length}) · ${totalNonAutoSessions} sessions` },
            ...folderEntries.map(({ name, fullPath }) => {
              const count = sessions.filter(s => s.trigger !== 'automation' && s.cwd && getProjectName(s.cwd) === name).length;
              const suffix = ` · ${count} sessions`;
              const maxNameLen = 40 - suffix.length;
              const displayName = name.length > maxNameLen ? '…' + name.slice(-maxNameLen + 1) : name;
              return { value: name, label: `${displayName}${suffix}`, title: fullPath };
            }),
          ];
          return folderEntries.length > 1 ? (
            <Dropdown
              options={dropdownOptions}
              value={selectedProject || ''}
              onChange={v => selectProject(v || null)}
              variant="full"
              className="mb-2 mr-4"
              dropdownClassName="left-0 -right-4 max-h-[40vh]"
            />
          ) : null;
        })()}
        {sessions.length > 0 && (() => {
          const filteredSessions = sessions.filter(s => {
            if (s.trigger === 'automation') return false;
            if (selectedProject) {
              if (!s.cwd) return false;
              if (getProjectName(s.cwd) !== selectedProject) return false;
            }
            return true;
          });
          return (
            <div className="flex-1 overflow-hidden">
              <SessionList sessions={filteredSessions} />
            </div>
          );
        })()}
      </div>

      {/* User Settings Footer - sticky at bottom */}
      <div className="sticky bottom-0 p-2 border-t border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#252536]">
        <button
          onClick={() => openSettingsModal()}
          title={`Settings${appVersion ? ` · v${appVersion}` : ''}${authStatus.authenticated === null ? ' · Checking auth...' : authStatus.authenticated ? ` · Authenticated via ${authStatus.provider || 'unknown'}` : ' · No auth configured'}`}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-[#32324a] transition-colors"
        >
          <span className="text-base">⚙️</span>
          <span className="flex-1 text-left text-sm font-medium text-gray-900 dark:text-gray-100">Settings</span>
          <span className="text-xs leading-none">{authStatus.authenticated === null ? '⏳' : authStatus.authenticated ? '🔒' : '🔓'}</span>
          {appVersion && <span className="text-[10px] leading-none text-gray-500 dark:text-gray-400">v{appVersion}</span>}
        </button>
      </div>

      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </aside>
  );
}
