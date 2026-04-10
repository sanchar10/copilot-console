/**
 * Agent Library — grid + list view of all defined agents with filtering and sorting.
 */

import { useEffect, useState, useMemo } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useTabStore, tabId } from '../../stores/tabStore';
import { Dropdown } from '../common/Dropdown';
import type { Agent } from '../../types/agent';

type FilterType = 'all' | 'teams' | 'sub-agents' | 'standalone' | 'composable';
type SortType = 'name-asc' | 'name-desc' | 'model' | 'updated';
type ViewType = 'grid' | 'list';

/** Reverse lookup: agent ID → list of team names that include it as a sub-agent */
type TeamMembershipMap = Record<string, string[]>;

function buildTeamMembership(agents: Agent[]): TeamMembershipMap {
  const map: TeamMembershipMap = {};
  for (const agent of agents) {
    if (agent.sub_agents?.length) {
      for (const subId of agent.sub_agents) {
        if (!map[subId]) map[subId] = [];
        map[subId].push(agent.name);
      }
    }
  }
  return map;
}

function isComposable(agent: Agent): boolean {
  return !agent.tools.custom?.length
    && !agent.tools.excluded_builtin?.length
    && !agent.sub_agents?.length
    && !!agent.system_message?.content
    && !!agent.description;
}

function isTeam(agent: Agent): boolean {
  return (agent.sub_agents?.length ?? 0) > 0;
}

function isSubAgent(agent: Agent, membership: TeamMembershipMap): boolean {
  return (membership[agent.id]?.length ?? 0) > 0;
}

// Shared action handlers
function useAgentActions() {
  const { openTab } = useTabStore();
  const { defaultCwd, defaultModel } = useUIStore();

  const handleClick = (agent: Agent) => {
    openTab({
      id: tabId.agentDetail(agent.id),
      type: 'agent-detail',
      label: agent.name,
      agentId: agent.id,
    });
  };

  const handleStart = (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    useTabStore.setState({ activeTabId: null });
    useSessionStore.setState({
      isNewSession: true,
      newSessionSettings: {
        name: `${agent.name} Session`,
        model: agent.model || defaultModel,
        reasoningEffort: agent.reasoning_effort || null,
        cwd: defaultCwd,
        mcpServers: agent.mcp_servers || [],
        tools: agent.tools || { custom: [], builtin: [], excluded_builtin: [] },
        systemMessage: agent.system_message?.content ? agent.system_message : null,
        agentId: agent.id,
        subAgents: agent.sub_agents || [],
        agentMode: 'interactive',
      },
    });
  };

  const handleAutomations = (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    openTab({
      id: tabId.automationManager(),
      type: 'automation-manager',
      label: `⏰ ${agent.name}`,
      agentId: agent.id,
    });
  };

  return { handleClick, handleStart, handleAutomations };
}

function AgentCard({ agent, membership }: { agent: Agent; membership: TeamMembershipMap }) {
  const { handleClick, handleStart, handleAutomations } = useAgentActions();
  const composable = isComposable(agent);
  const teams = membership[agent.id];

  return (
    <button
      onClick={() => handleClick(agent)}
      className="bg-white/50 dark:bg-[#2a2a3c]/50 backdrop-blur border border-white/40 dark:border-[#3a3a4e] rounded-xl p-5 text-left hover:border-blue-300/60 dark:hover:border-blue-500/40 hover:shadow-md transition-all group relative"
    >
      <div className="flex items-start justify-between">
        <div className="text-3xl mb-3">{agent.icon}</div>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span
            onClick={(e) => handleAutomations(agent, e)}
            title="View automations for this agent"
            className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 cursor-pointer"
          >
            ⏰ Automations
          </span>
          <span
            onClick={(e) => handleStart(agent, e)}
            title="Start a new session with this agent's config"
            className="px-2.5 py-1 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 cursor-pointer"
          >
            + New Session
          </span>
        </div>
      </div>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
        {agent.name}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
        {agent.description || 'No description'}
      </p>
      <div className="flex items-center gap-2 mt-3 text-xs text-gray-400 dark:text-gray-500 flex-wrap">
        <span>{agent.model || 'default'}</span>
        {isTeam(agent) && (
          <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded font-medium" title="Has sub-agents">
            👥 {agent.sub_agents.length}
          </span>
        )}
        {teams && teams.length > 0 && (
          <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium" title={`Member of: ${teams.join(', ')}`}>
            🔗 in {teams.length} {teams.length === 1 ? 'team' : 'teams'}
          </span>
        )}
        {composable && (
          <span className="text-gray-300 dark:text-gray-600" title="Composable — can be used as a sub-agent">🧩</span>
        )}
      </div>
    </button>
  );
}

function AgentRow({ agent, membership }: { agent: Agent; membership: TeamMembershipMap }) {
  const { handleClick, handleStart, handleAutomations } = useAgentActions();
  const composable = isComposable(agent);
  const teams = membership[agent.id];

  return (
    <button
      onClick={() => handleClick(agent)}
      className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/50 dark:bg-[#2a2a3c]/50 backdrop-blur border border-white/40 dark:border-[#3a3a4e] rounded-lg text-left hover:border-blue-300/60 dark:hover:border-blue-500/40 hover:shadow-sm transition-all group"
    >
      <span className="text-xl flex-shrink-0 w-8 text-center">{agent.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
            {agent.name}
          </span>
          {isTeam(agent) && (
            <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0" title="Has sub-agents">
              👥 {agent.sub_agents.length}
            </span>
          )}
          {teams && teams.length > 0 && (
            <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0" title={`Member of: ${teams.join(', ')}`}>
              🔗 {teams.length} {teams.length === 1 ? 'team' : 'teams'}
            </span>
          )}
          {composable && (
            <span className="text-gray-300 dark:text-gray-600 flex-shrink-0" title="Composable — can be used as a sub-agent">🧩</span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{agent.description || 'No description'}</p>
      </div>
      <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0 hidden sm:block">{agent.model || 'default'}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <span
          onClick={(e) => handleAutomations(agent, e)}
          title="Automations"
          className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] font-medium hover:bg-indigo-700 cursor-pointer"
        >⏰</span>
        <span
          onClick={(e) => handleStart(agent, e)}
          title="New session"
          className="px-2 py-1 bg-green-600 text-white rounded text-[10px] font-medium hover:bg-green-700 cursor-pointer"
        >▶</span>
      </div>
    </button>
  );
}

const FILTERS: { key: FilterType; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: '' },
  { key: 'teams', label: 'Teams', icon: '👥' },
  { key: 'sub-agents', label: 'Sub-agents', icon: '🔗' },
  { key: 'standalone', label: 'Standalone', icon: '' },
  { key: 'composable', label: 'Composable', icon: '🧩' },
];

const SORTS: { key: SortType; label: string }[] = [
  { key: 'name-asc', label: 'Name A→Z' },
  { key: 'name-desc', label: 'Name Z→A' },
  { key: 'model', label: 'Model' },
  { key: 'updated', label: 'Recently updated' },
];

export function AgentLibrary() {
  const { agents, loading, fetchAgents } = useAgentStore();
  const { openTab } = useTabStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('name-asc');
  const [view, setView] = useState<ViewType>('grid');

  useEffect(() => {
    if (agents.length === 0 && !loading) {
      fetchAgents();
    }
  }, [fetchAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewAgent = () => {
    openTab({
      id: tabId.agentDetail('new'),
      type: 'agent-detail',
      label: 'New Agent',
      agentId: 'new',
    });
  };

  // Reverse lookup: which teams each agent belongs to
  const membership = useMemo(() => buildTeamMembership(agents), [agents]);

  // Filter counts for badges
  const counts = useMemo(() => ({
    all: agents.length,
    teams: agents.filter(isTeam).length,
    'sub-agents': agents.filter(a => isSubAgent(a, membership)).length,
    standalone: agents.filter(a => !isTeam(a) && !isSubAgent(a, membership)).length,
    composable: agents.filter(isComposable).length,
  }), [agents, membership]);

  const filtered = useMemo(() => {
    let result = agents;

    // Text search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)
      );
    }

    // Category filter
    if (filter === 'teams') result = result.filter(isTeam);
    else if (filter === 'sub-agents') result = result.filter(a => isSubAgent(a, membership));
    else if (filter === 'standalone') result = result.filter(a => !isTeam(a) && !isSubAgent(a, membership));
    else if (filter === 'composable') result = result.filter(isComposable);

    // Sort
    result = [...result].sort((a, b) => {
      switch (sort) {
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'model': return a.model.localeCompare(b.model) || a.name.localeCompare(b.name);
        case 'updated': return (b.updated_at || '').localeCompare(a.updated_at || '');
        default: return 0;
      }
    });

    return result;
  }, [agents, search, filter, sort]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🤖 Agent Library</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Create and manage agents
            </p>
          </div>
          <button
            onClick={handleNewAgent}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Agent
          </button>
        </div>

        {/* Toolbar: Search + Filter chips + Sort + View toggle */}
        {agents.length > 0 && (
          <div className="space-y-3 mb-4">
            {/* Search bar */}
            <div className="relative">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search agents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#2a2a3c] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {/* Filter chips + Sort + View toggle */}
            <div className="flex items-center justify-between gap-3">
              {/* Filter chips */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      filter === f.key
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-[#2a2a3c] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#3a3a4e]'
                    }`}
                  >
                    {f.icon ? `${f.icon} ` : ''}{f.label}
                    <span className={`ml-1 ${filter === f.key ? 'text-blue-200' : 'text-gray-400 dark:text-gray-500'}`}>
                      {counts[f.key]}
                    </span>
                  </button>
                ))}
              </div>

              {/* Sort + View toggle */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Dropdown
                  options={SORTS.map(s => ({ value: s.key, label: s.label }))}
                  value={sort}
                  onChange={v => setSort(v as SortType)}
                  variant="compact"
                />

                {/* View toggle */}
                <div className="flex items-center border border-gray-200 dark:border-[#3a3a4e] rounded overflow-hidden">
                  <button
                    onClick={() => setView('grid')}
                    title="Grid view"
                    className={`p-1.5 ${view === 'grid' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-[#2a2a3c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#3a3a4e]'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                      <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" />
                      <rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setView('list')}
                    title="List view"
                    className={`p-1.5 ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-[#2a2a3c] text-gray-500 hover:bg-gray-100 dark:hover:bg-[#3a3a4e]'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                      <rect x="1" y="1.5" width="14" height="3" rx="0.5" /><rect x="1" y="6.5" width="14" height="3" rx="0.5" />
                      <rect x="1" y="11.5" width="14" height="3" rx="0.5" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">Loading agents...</div>
        ) : filtered.length === 0 && !search && filter === 'all' ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🤖</div>
            <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">No agents yet</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Create your first agent to get started
            </p>
            <button
              onClick={handleNewAgent}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              Create Agent
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            No agents match the current filters
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((agent) => (
              <AgentCard key={agent.id} agent={agent} membership={membership} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {filtered.map((agent) => (
              <AgentRow key={agent.id} agent={agent} membership={membership} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
