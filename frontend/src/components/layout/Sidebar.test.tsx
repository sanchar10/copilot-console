import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: () => ({
    sessions: [],
    setSessions: vi.fn(),
    startNewSession: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
  }),
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: () => ({
    setAvailableModels: vi.fn(),
    setDefaultModel: vi.fn(),
    setDefaultCwd: vi.fn(),
    openSettingsModal: vi.fn(),
    defaultModel: 'gpt-4',
    defaultCwd: '',
  }),
}));


vi.mock('../../stores/tabStore', () => ({
  useTabStore: () => ({
    activeTabId: null,
    openTab: vi.fn(),
  }),
  tabId: {
    session: (id: string) => `session:${id}`,
    agentLibrary: () => 'agent-library',
    workflowLibrary: () => 'workflow-library',
    automationManager: () => 'automation-manager',
    taskBoard: () => 'task-board',
  },
}));

vi.mock('../../stores/agentMonitorStore', () => ({
  useAgentMonitorStore: () => ({
    setOpen: vi.fn(),
    activeCount: 0,
    setActiveCount: vi.fn(),
  }),
}));

vi.mock('../../stores/agentStore', () => ({
  useAgentStore: () => ({
    agents: [{ id: 'a1' }],
    fetchAgents: vi.fn(),
  }),
}));

vi.mock('../../stores/workflowStore', () => ({
  useWorkflowStore: () => ({
    workflows: [{ id: 'w1' }],
    fetchWorkflows: vi.fn(),
  }),
}));

vi.mock('../../stores/automationStore', () => ({
  useAutomationStore: () => ({
    automations: [{ id: 'sch1' }],
    fetchAutomations: vi.fn(),
  }),
}));

vi.mock('../../api/sessions', () => ({
  listSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/models', () => ({
  fetchModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({ default_model: 'gpt-4' }),
}));

vi.mock('../../api/activeAgents', () => ({
  getActiveAgents: vi.fn().mockResolvedValue({ count: 0 }),
  subscribeToActiveAgents: vi.fn().mockReturnValue({ abort: vi.fn() }),
}));


// Mock SessionList to keep Sidebar test isolated
vi.mock('../session/SessionList', () => ({
  SessionList: ({ sessions }: { sessions: unknown[] }) => (
    <div data-testid="session-list">sessions: {sessions.length}</div>
  ),
}));

import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders navigation sections', () => {
    render(<Sidebar />);
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
    expect(screen.getByText('Automations')).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
  });

  it('renders New Session button', () => {
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /New Session/ })).toBeInTheDocument();
  });

  it('renders settings card', () => {
    render(<Sidebar />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders app title', () => {
    render(<Sidebar />);
    expect(screen.getByText('Copilot Console')).toBeInTheDocument();
  });

  it('renders Active Agents button', () => {
    render(<Sidebar />);
    expect(screen.getByText('Active Agents')).toBeInTheDocument();
  });
});
