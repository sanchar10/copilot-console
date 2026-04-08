import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockCloseSettingsModal = vi.fn();

vi.mock('../../stores/uiStore', () => ({
  useUIStore: () => ({
    isSettingsModalOpen: true,
    closeSettingsModal: mockCloseSettingsModal,
    availableModels: [
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'claude-3', name: 'Claude 3' },
    ],
    defaultModel: 'gpt-4',
    defaultReasoningEffort: null,
    setDefaultModel: vi.fn(),
    setDefaultReasoningEffort: vi.fn(),
    defaultCwd: '/home/user',
    setDefaultCwd: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('../../api/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({ default_model: 'gpt-4', default_reasoning_effort: null, default_cwd: '/home/user', cli_notifications: false }),
  updateSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ api_token: 'test-token', tunnel_url: '', expose: false }),
    post: vi.fn().mockResolvedValue({ api_token: 'new-token' }),
  },
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr-code" />,
}));

vi.mock('../common/FolderBrowserModal', () => ({
  FolderBrowserModal: () => null,
}));

import { SettingsModal } from './SettingsModal';

describe('SettingsModal', () => {
  it('renders theme toggle buttons', () => {
    render(<SettingsModal />);
    expect(screen.getByText(/Light/)).toBeInTheDocument();
    expect(screen.getByText(/Dark/)).toBeInTheDocument();
  });

  it('renders model selector with options', () => {
    render(<SettingsModal />);
    expect(screen.getByText('Default Model')).toBeInTheDocument();
    // ModelSelector renders a button showing the selected model name
    expect(screen.getByText('GPT-4')).toBeInTheDocument();
  });

  it('renders working directory input', () => {
    render(<SettingsModal />);
    expect(screen.getByText('Default Working Directory')).toBeInTheDocument();
    const input = screen.getByDisplayValue('/home/user');
    expect(input).toBeInTheDocument();
  });

  it('calls closeSettingsModal when Cancel is clicked', () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockCloseSettingsModal).toHaveBeenCalledOnce();
  });

  it('renders Save button', () => {
    render(<SettingsModal />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
