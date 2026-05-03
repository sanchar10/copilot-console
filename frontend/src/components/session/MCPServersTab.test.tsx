import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MCPServersTab } from './MCPServersTab';
import { useSessionStore } from '../../stores/sessionStore';
import type { MCPServer } from '../../types/mcp';

vi.mock('../../api/mcp', async () => {
  const actual = await vi.importActual<typeof import('../../api/mcp')>('../../api/mcp');
  return {
    ...actual,
    listMCPServers: vi.fn(),
    getMCPSettings: vi.fn(),
    patchMCPSettings: vi.fn(),
    deleteMCPServer: vi.fn(),
    resetMCPOAuth: vi.fn(),
  };
});

import {
  listMCPServers,
  getMCPSettings,
  patchMCPSettings,
  deleteMCPServer,
  resetMCPOAuth,
  MCPApiError,
} from '../../api/mcp';

const addToastMock = vi.fn();
vi.mock('../../stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: addToastMock }) },
}));

const mockListMCPServers = listMCPServers as unknown as ReturnType<typeof vi.fn>;
const mockGetMCPSettings = getMCPSettings as unknown as ReturnType<typeof vi.fn>;
const mockPatchMCPSettings = patchMCPSettings as unknown as ReturnType<typeof vi.fn>;
const mockDeleteMCPServer = deleteMCPServer as unknown as ReturnType<typeof vi.fn>;
const mockResetMCPOAuth = resetMCPOAuth as unknown as ReturnType<typeof vi.fn>;

const SERVERS: MCPServer[] = [
  { name: 'fs', command: 'echo', args: ['hi'], tools: ['*'], source: 'global' },
  { name: 'github', url: 'https://api.example.com', tools: ['*'], source: 'agent-only' },
  { name: 'plug-srv', command: 'pl', tools: ['*'], source: 'myplugin' },
];

describe('MCPServersTab', () => {
  const initialState = useSessionStore.getState();

  beforeEach(() => {
    useSessionStore.setState(initialState, true);
    mockListMCPServers.mockReset();
    mockGetMCPSettings.mockReset();
    mockPatchMCPSettings.mockReset();
    mockDeleteMCPServer.mockReset();
    mockResetMCPOAuth.mockReset();
    addToastMock.mockReset();
  });

  afterEach(() => {
    useSessionStore.setState(initialState, true);
  });

  it('does not load when isOpen is false', () => {
    render(<MCPServersTab isOpen={false} />);
    expect(mockListMCPServers).not.toHaveBeenCalled();
    expect(mockGetMCPSettings).not.toHaveBeenCalled();
  });

  it('loads servers + settings on open and renders grouped sections', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: { fs: true } });

    render(<MCPServersTab isOpen={true} />);

    await waitFor(() => expect(mockListMCPServers).toHaveBeenCalledTimes(1));
    expect(mockGetMCPSettings).toHaveBeenCalledTimes(1);

    // Headers for the three groups present
    expect(await screen.findByText('Global')).toBeInTheDocument();
    expect(screen.getByText('App')).toBeInTheDocument();
    // Plugin section header is now just "Plugin"; the plugin name appears in the path.
    const pluginHeaders = screen.getAllByText('Plugin');
    expect(pluginHeaders.length).toBeGreaterThan(0);
    expect(
      screen.getByText(/installed-plugins\/copilot-plugins\//),
    ).toBeInTheDocument();

    // All three server names rendered
    expect(screen.getByText('fs')).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('plug-srv')).toBeInTheDocument();
  });

  it('reflects auto-enable state from settings on initial render', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: { fs: true, github: false } });

    render(<MCPServersTab isOpen={true} />);

    const fsToggle = (await screen.findByLabelText('Auto-enable fs')) as HTMLInputElement;
    const ghToggle = screen.getByLabelText('Auto-enable github') as HTMLInputElement;
    expect(fsToggle.checked).toBe(true);
    expect(ghToggle.checked).toBe(false);
  });

  it('plugin-scoped row auto-enable toggle is enabled (overlay applies to all servers)', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });
    mockPatchMCPSettings.mockResolvedValue({ mcp_auto_enable: { 'plug-srv': true } });

    render(<MCPServersTab isOpen={true} />);
    const pluginToggle = (await screen.findByLabelText('Auto-enable plug-srv')) as HTMLInputElement;
    expect(pluginToggle.disabled).toBe(false);

    fireEvent.click(pluginToggle);
    await waitFor(() => {
      expect(mockPatchMCPSettings).toHaveBeenCalledWith({ 'plug-srv': true });
    });
  });

  it('toggling a writable row PATCHes the single key and reflects the response', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });
    mockPatchMCPSettings.mockResolvedValue({ mcp_auto_enable: { fs: true } });

    render(<MCPServersTab isOpen={true} />);
    const fsToggle = (await screen.findByLabelText('Auto-enable fs')) as HTMLInputElement;
    expect(fsToggle.checked).toBe(false);

    fireEvent.click(fsToggle);

    await waitFor(() => expect(mockPatchMCPSettings).toHaveBeenCalledWith({ fs: true }));
    await waitFor(() => expect(fsToggle.checked).toBe(true));
  });

  it('reverts the optimistic update and shows error when PATCH fails', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: { fs: true } });
    mockPatchMCPSettings.mockRejectedValue(new MCPApiError(400, 'invalid server name'));

    render(<MCPServersTab isOpen={true} />);
    const fsToggle = (await screen.findByLabelText('Auto-enable fs')) as HTMLInputElement;
    expect(fsToggle.checked).toBe(true);

    fireEvent.click(fsToggle);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('invalid server name'));
    // Reverted to true
    expect(fsToggle.checked).toBe(true);
  });

  it('shows an error banner when initial load fails', async () => {
    mockListMCPServers.mockRejectedValue(new Error('network down'));
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });

    render(<MCPServersTab isOpen={true} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network down'));
  });

  it('renders empty-state message when no servers exist', async () => {
    mockListMCPServers.mockResolvedValue({ servers: [] });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });

    render(<MCPServersTab isOpen={true} />);
    expect(await screen.findByText(/No MCP servers configured/)).toBeInTheDocument();
  });

  it('shows + Add Server button', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });

    render(<MCPServersTab isOpen={true} />);
    expect(await screen.findByRole('button', { name: /Add Server/i })).toBeInTheDocument();
  });

  it('shows Edit + Delete on writable rows but not on plugin rows', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });

    render(<MCPServersTab isOpen={true} />);
    await waitFor(() => expect(screen.getByText('fs')).toBeInTheDocument());
    expect(screen.getByLabelText('Edit fs')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete fs')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit plug-srv')).toBeNull();
    expect(screen.queryByLabelText('Delete plug-srv')).toBeNull();
  });

  it('shows Reset OAuth only when server has a url', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });

    render(<MCPServersTab isOpen={true} />);
    await waitFor(() => expect(screen.getByText('github')).toBeInTheDocument());
    expect(screen.getByLabelText('Reset OAuth for github')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reset OAuth for fs')).toBeNull();
  });

  it('Delete: confirms via ConfirmModal, calls API, removes from store, shows toast', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: { fs: true } });
    mockDeleteMCPServer.mockResolvedValue(undefined);

    render(<MCPServersTab isOpen={true} />);
    fireEvent.click(await screen.findByLabelText('Delete fs'));

    const dialog = await screen.findByRole('dialog', { name: /Delete MCP Server/i });
    expect(within(dialog).getByText(/Open & active chats keep/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteMCPServer).toHaveBeenCalledWith('fs'));
    await waitFor(() =>
      expect(useSessionStore.getState().availableMcpServers.find(s => s.name === 'fs')).toBeUndefined(),
    );
    expect(addToastMock).toHaveBeenCalled();
    expect(addToastMock.mock.calls[0][0]).toMatch(/Deleted/);
    expect(addToastMock.mock.calls[0][1]).toBe('success');
  });

  it('Delete: cancelling the ConfirmModal does not call API', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });

    render(<MCPServersTab isOpen={true} />);
    fireEvent.click(await screen.findByLabelText('Delete fs'));
    const dialog = await screen.findByRole('dialog', { name: /Delete MCP Server/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Delete MCP Server/i })).toBeNull());
    expect(mockDeleteMCPServer).not.toHaveBeenCalled();
  });

  it('Delete: surfaces API error as toast', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });
    mockDeleteMCPServer.mockRejectedValue(new MCPApiError(403, 'read-only'));

    render(<MCPServersTab isOpen={true} />);
    fireEvent.click(await screen.findByLabelText('Delete fs'));
    const dialog = await screen.findByRole('dialog', { name: /Delete MCP Server/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.stringMatching(/read-only/), 'error', expect.any(Number)),
    );
  });

  it('Reset OAuth: confirms via ConfirmModal and calls resetMCPOAuth, success toast on removed > 0', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });
    mockResetMCPOAuth.mockResolvedValue({ removed: ['abc.json', 'abc.tokens.json'], scanned: 5 });

    render(<MCPServersTab isOpen={true} />);
    fireEvent.click(await screen.findByLabelText('Reset OAuth for github'));
    const dialog = await screen.findByRole('dialog', { name: /Reset OAuth/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(mockResetMCPOAuth).toHaveBeenCalledWith('github'));
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.stringMatching(/Sign in again/i), 'success', expect.any(Number)),
    );
  });

  it('Reset OAuth: info toast when nothing removed', async () => {
    mockListMCPServers.mockResolvedValue({ servers: SERVERS });
    mockGetMCPSettings.mockResolvedValue({ mcp_auto_enable: {} });
    mockResetMCPOAuth.mockResolvedValue({ removed: [], scanned: 5 });

    render(<MCPServersTab isOpen={true} />);
    fireEvent.click(await screen.findByLabelText('Reset OAuth for github'));
    const dialog = await screen.findByRole('dialog', { name: /Reset OAuth/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.stringMatching(/No OAuth state/i), 'info', expect.any(Number)),
    );
  });
});
