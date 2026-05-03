import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MCPServerEditor } from './MCPServerEditor';
import type { MCPServer } from '../../types/mcp';

vi.mock('../../api/mcp', async () => {
  const actual = await vi.importActual<typeof import('../../api/mcp')>('../../api/mcp');
  return {
    ...actual,
    createMCPServer: vi.fn(),
    updateMCPServer: vi.fn(),
  };
});

import { createMCPServer, updateMCPServer, MCPApiError } from '../../api/mcp';

const mockCreate = createMCPServer as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = updateMCPServer as unknown as ReturnType<typeof vi.fn>;

const EXISTING: MCPServer = {
  name: 'gh',
  url: 'https://api.example.com',
  headers: { Authorization: 'Bearer x' },
  tools: ['*'],
  source: 'agent-only',
};

describe('MCPServerEditor', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <MCPServerEditor isOpen={false} mode="add" onClose={() => {}} onSaved={() => {}} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('add mode: rejects invalid name and disables Save until name + JSON are valid', async () => {
    render(
      <MCPServerEditor isOpen={true} mode="add" onClose={() => {}} onSaved={() => {}} />,
    );
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    const saveBtn = screen.getByRole('button', { name: /^Save$/i });

    // Default config placeholder is valid JSON; missing name disables save.
    expect(saveBtn).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: 'bad name!' } });
    expect(await screen.findByText(/Name must be 1–64 chars/i)).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    fireEvent.change(nameInput, { target: { value: 'good-name' } });
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
  });

  it('add mode: invalid JSON disables Save and shows inline error', async () => {
    render(
      <MCPServerEditor isOpen={true} mode="add" onClose={() => {}} onSaved={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'srv1' } });
    const textarea = screen.getByLabelText('Config (JSON)') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{ broken' } });

    expect(await screen.findByText(/Invalid JSON/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled();
  });

  it('add mode: posts scope, name, config, autoEnable on save and calls onSaved+onClose', async () => {
    const created: MCPServer = { name: 'srv1', command: 'x', tools: ['*'], source: 'global' };
    mockCreate.mockResolvedValue(created);
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <MCPServerEditor isOpen={true} mode="add" onClose={onClose} onSaved={onSaved} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'srv1' } });
    fireEvent.change(screen.getByLabelText('Config (JSON)'), {
      target: { value: '{"command":"x"}' },
    });
    fireEvent.click(screen.getByLabelText('Auto-enable on new sessions'));

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        scope: 'global',
        name: 'srv1',
        config: { command: 'x' },
        autoEnable: true,
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created, true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('add mode: shows server-side error and stays open on failure', async () => {
    mockCreate.mockRejectedValue(new MCPApiError(409, 'name conflict'));

    render(
      <MCPServerEditor isOpen={true} mode="add" onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'srv1' } });
    fireEvent.change(screen.getByLabelText('Config (JSON)'), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('name conflict');
  });

  it('edit mode: locks name + scope, prefills config and autoEnable', () => {
    render(
      <MCPServerEditor
        isOpen={true}
        mode="edit"
        server={EXISTING}
        initialAutoEnable={true}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('gh');
    expect(nameInput.disabled).toBe(true);
    // Scope shown as text not radios
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText(/Agent-only/)).toBeInTheDocument();

    const ta = screen.getByLabelText('Config (JSON)') as HTMLTextAreaElement;
    const parsed = JSON.parse(ta.value);
    expect(parsed.url).toBe('https://api.example.com');
    expect(parsed.headers).toEqual({ Authorization: 'Bearer x' });
    expect(parsed.name).toBeUndefined();
    expect(parsed.source).toBeUndefined();
    expect(parsed.tools).toEqual(['*']);

    const autoToggle = screen.getByLabelText('Auto-enable on new sessions') as HTMLInputElement;
    expect(autoToggle.checked).toBe(true);
  });

  it('edit mode: PUTs the new config and autoEnable', async () => {
    const updated: MCPServer = { ...EXISTING, url: 'https://new.example.com' };
    mockUpdate.mockResolvedValue(updated);
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <MCPServerEditor
        isOpen={true}
        mode="edit"
        server={EXISTING}
        initialAutoEnable={false}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    const ta = screen.getByLabelText('Config (JSON)') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '{"url":"https://new.example.com"}' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('gh', {
        config: { url: 'https://new.example.com' },
        autoEnable: false,
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated, false));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
