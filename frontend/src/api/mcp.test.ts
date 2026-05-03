import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMCPServer,
  updateMCPServer,
  deleteMCPServer,
  resetMCPOAuth,
  getMCPSettings,
  patchMCPSettings,
  MCPApiError,
} from './mcp';
import type { MCPServer } from '../types/mcp';

const mockServer: MCPServer = {
  name: 'fs',
  command: 'echo',
  args: ['hi'],
  tools: ['*'],
  source: 'global',
};

describe('MCP CRUD api client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('createMCPServer', () => {
    it('POSTs to /api/mcp/servers with JSON body and returns the parsed server', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockServer,
      });

      const result = await createMCPServer({
        scope: 'global',
        name: 'fs',
        config: { command: 'echo' },
      });

      expect(result).toEqual(mockServer);
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('/api/mcp/servers');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      const body = JSON.parse(init.body);
      expect(body).toEqual({ scope: 'global', name: 'fs', config: { command: 'echo' } });
    });

    it('forwards autoEnable when provided', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockServer,
      });
      await createMCPServer({ scope: 'global', name: 'fs', config: {}, autoEnable: true });
      const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body.autoEnable).toBe(true);
    });

    it('throws MCPApiError carrying status + detail on conflict', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ detail: "Server 'fs' already exists" }),
      });

      await expect(
        createMCPServer({ scope: 'global', name: 'fs', config: { command: 'x' } }),
      ).rejects.toMatchObject({
        name: 'MCPApiError',
        status: 409,
        detail: "Server 'fs' already exists",
      });
    });

    it('falls back to statusText when error body is not JSON', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('not json');
        },
      });

      await expect(
        createMCPServer({ scope: 'global', name: 'fs', config: {} }),
      ).rejects.toMatchObject({ status: 500, detail: 'Internal Server Error' });
    });

    it('parses 422 array-shaped detail into a joined string', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({
          detail: [{ msg: 'value is not valid' }, { msg: 'scope must be one of …' }],
        }),
      });

      await expect(
        createMCPServer({ scope: 'global' as never, name: 'x', config: {} }),
      ).rejects.toMatchObject({
        status: 422,
        detail: 'value is not valid; scope must be one of …',
      });
    });
  });

  describe('updateMCPServer', () => {
    it('PUTs to /api/mcp/servers/{name} with URL-encoded name', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockServer,
      });

      await updateMCPServer('weird name', { config: { command: 'x' } });
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('/api/mcp/servers/weird%20name');
      expect(init.method).toBe('PUT');
    });

    it('throws MCPApiError on 404 not-found', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ detail: 'no such server' }),
      });
      await expect(updateMCPServer('ghost', { config: {} })).rejects.toBeInstanceOf(MCPApiError);
    });
  });

  describe('deleteMCPServer', () => {
    it('DELETEs to /api/mcp/servers/{name} and resolves with no content on 204', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 204,
      });
      await expect(deleteMCPServer('fs')).resolves.toBeUndefined();
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('/api/mcp/servers/fs');
      expect(init.method).toBe('DELETE');
    });

    it('rejects with MCPApiError on 403', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ detail: 'plugin scope is read-only' }),
      });
      await expect(deleteMCPServer('plug-srv')).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('resetMCPOAuth', () => {
    it('POSTs to /api/mcp/servers/{name}/reset-oauth and returns the result', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ removed: ['abc.json'], scanned: 3 }),
      });
      const result = await resetMCPOAuth('bluebird');
      expect(result).toEqual({ removed: ['abc.json'], scanned: 3 });
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('/api/mcp/servers/bluebird/reset-oauth');
      expect(init.method).toBe('POST');
    });

    it('rejects with MCPApiError on 400 (local server)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ detail: 'local server has no OAuth state' }),
      });
      await expect(resetMCPOAuth('fs')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('getMCPSettings', () => {
    it('GETs /api/mcp/settings and returns the auto-enable map', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ mcp_auto_enable: { fs: true, github: false } }),
      });
      const result = await getMCPSettings();
      expect(result).toEqual({ mcp_auto_enable: { fs: true, github: false } });
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('/api/mcp/settings');
      expect(init).toBeUndefined();
    });

    it('rejects with MCPApiError when the server fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ detail: 'boom' }),
      });
      await expect(getMCPSettings()).rejects.toBeInstanceOf(MCPApiError);
    });
  });

  describe('patchMCPSettings', () => {
    it('PATCHes /api/mcp/settings wrapping the patch in mcp_auto_enable', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ mcp_auto_enable: { fs: true } }),
      });
      const result = await patchMCPSettings({ fs: true, old: null });
      expect(result).toEqual({ mcp_auto_enable: { fs: true } });
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('/api/mcp/settings');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body)).toEqual({
        mcp_auto_enable: { fs: true, old: null },
      });
    });

    it('rejects with MCPApiError on 400 (invalid name)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ detail: 'invalid server name' }),
      });
      await expect(patchMCPSettings({ '!bad!': true })).rejects.toMatchObject({
        status: 400,
        detail: 'invalid server name',
      });
    });
  });
});
