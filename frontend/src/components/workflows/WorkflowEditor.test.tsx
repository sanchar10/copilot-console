import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockOpenTab = vi.fn();
const mockCloseTab = vi.fn();
const mockReplaceTab = vi.fn();
const mockFetchWorkflows = vi.fn();

vi.mock('../../utils/formatters', () => ({
  formatDateTime: (d: string) => `dt-${d}`,
}));

vi.mock('../../stores/workflowStore', () => ({
  useWorkflowStore: vi.fn(() => ({
    fetchWorkflows: mockFetchWorkflows,
  })),
}));

vi.mock('../../stores/tabStore', () => ({
  useTabStore: Object.assign(
    vi.fn(() => ({
      openTab: mockOpenTab,
      closeTab: mockCloseTab,
      replaceTab: mockReplaceTab,
    })),
    { getState: () => ({ closeTab: mockCloseTab }) },
  ),
  tabId: {
    workflowEditor: (id: string) => `workflow:${id}`,
    workflowRun: (id: string) => `workflow-run:${id}`,
  },
}));

vi.mock('../../api/workflows', () => ({
  getWorkflow: vi.fn().mockResolvedValue({
    id: 'wf-1',
    name: 'My Workflow',
    description: 'Test desc',
    yaml_content: 'kind: Workflow\nname: test',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
  }),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  visualizeWorkflow: vi.fn().mockResolvedValue({ mermaid: 'graph TD; A-->B;' }),
  runWorkflow: vi.fn(),
  listWorkflowRuns: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  deleteWorkflowRun: vi.fn(),
  createWorkflowRunStream: vi.fn(),
  sendHumanInput: vi.fn(),
}));

vi.mock('../chat/MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-diagram">{code}</div>,
}));

vi.mock('../common/FolderBrowserModal', () => ({
  FolderBrowserModal: () => <div data-testid="folder-browser-modal" />,
}));

vi.mock('../common/ConfirmModal', () => ({
  ConfirmModal: () => <div data-testid="confirm-modal" />,
}));

import { WorkflowEditor } from './WorkflowEditor';

describe('WorkflowEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders YAML editor for new workflow', () => {
    render(<WorkflowEditor workflowId="new" />);
    // The textarea should contain the default YAML template
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).toContain('kind: Workflow');
  });

  it('renders "New Workflow" title for new workflow', () => {
    render(<WorkflowEditor workflowId="new" />);
    expect(screen.getByText('New Workflow')).toBeInTheDocument();
  });

  it('renders save button', () => {
    render(<WorkflowEditor workflowId="new" />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('renders description block for new workflow', () => {
    render(<WorkflowEditor workflowId="new" />);
    expect(screen.getByText('A new workflow')).toBeInTheDocument();
  });

  it('shows "Unsaved" badge when content is modified', () => {
    render(<WorkflowEditor workflowId="new" />);
    const textarea = screen.getByRole('textbox');
    // Simulate editing
    const { fireEvent } = require('@testing-library/react');
    fireEvent.change(textarea, { target: { value: 'modified yaml' } });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('shows preview placeholder for new workflows', () => {
    render(<WorkflowEditor workflowId="new" />);
    expect(screen.getByText('Save the workflow to see a preview')).toBeInTheDocument();
  });

  it('renders YAML Definition label', () => {
    render(<WorkflowEditor workflowId="new" />);
    expect(screen.getByText('YAML Definition')).toBeInTheDocument();
  });
});
