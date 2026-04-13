/**
 * P3-2 Tests — Async Error Boundaries for sessionStore
 *
 * These tests pin the expected error-handling lifecycle for async store
 * actions. Fenster will add proper loading/error state management to
 * sessionStore's async actions (fetchSessions, etc.) following the
 * pattern already established in agentStore, automationStore, workflowStore.
 *
 * Expected pattern (matches agentStore):
 *   fetchSessions: async () => {
 *     set({ isLoading: true, error: null });
 *     try {
 *       const sessions = await listSessions();
 *       set({ sessions, isLoading: false });
 *     } catch (e) {
 *       set({ error: (e as Error).message, isLoading: false });
 *     }
 *   },
 *   clearError: () => set({ error: null }),
 *
 * Tests will FAIL until Fenster adds fetchSessions + clearError to the store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionStore } from './sessionStore';

// Mock the sessions API
vi.mock('../api/sessions', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  updateSession: vi.fn(),
  connectSession: vi.fn(),
  disconnectSession: vi.fn(),
  sendMessage: vi.fn(),
  setSessionMode: vi.fn(),
  updateRuntimeSettings: vi.fn(),
  compactSession: vi.fn(),
  uploadFile: vi.fn(),
  enqueueMessage: vi.fn(),
  abortSession: vi.fn(),
  getResponseStatus: vi.fn(),
  resumeResponseStream: vi.fn(),
  respondToElicitation: vi.fn(),
  respondToUserInput: vi.fn(),
}));

// Also mock deps that sessionStore imports
vi.mock('../api/mcp', () => ({
  listMCPServers: vi.fn().mockResolvedValue({ servers: [] }),
}));
vi.mock('../api/tools', () => ({
  getTools: vi.fn().mockResolvedValue({ tools: [] }),
}));

import * as sessionsApi from '../api/sessions';
import type { Session } from '../types/session';

const initialState = useSessionStore.getState();

function resetStore() {
  useSessionStore.setState(initialState, true);
  vi.clearAllMocks();
}

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    session_id: id,
    session_name: `Session ${id}`,
    model: 'gpt-4.1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('P3-2: sessionStore async error boundaries', () => {
  beforeEach(resetStore);

  // --- 1. error starts as null ---
  it('error state starts as null', () => {
    expect(useSessionStore.getState().error).toBeNull();
  });

  // --- 2. isLoading starts as false ---
  it('isLoading starts as false', () => {
    expect(useSessionStore.getState().isLoading).toBe(false);
  });

  // --- 3. fetchSessions sets loading/error lifecycle ---
  describe('fetchSessions', () => {
    it('sets isLoading true while fetching', async () => {
      let resolveFn: (value: Session[]) => void;
      vi.mocked(sessionsApi.listSessions).mockImplementation(
        () => new Promise((resolve) => { resolveFn = resolve; }),
      );

      // fetchSessions is the action Fenster will add
      const store = useSessionStore.getState();
      const promise = (store as any).fetchSessions();
      expect(useSessionStore.getState().isLoading).toBe(true);

      resolveFn!([]);
      await promise;
      expect(useSessionStore.getState().isLoading).toBe(false);
    });

    it('loads sessions and clears loading on success', async () => {
      const sessions = [makeSession('s1'), makeSession('s2')];
      vi.mocked(sessionsApi.listSessions).mockResolvedValue(sessions);

      await (useSessionStore.getState() as any).fetchSessions();

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(2);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets error message on API failure', async () => {
      vi.mocked(sessionsApi.listSessions).mockRejectedValue(new Error('Network timeout'));

      await (useSessionStore.getState() as any).fetchSessions();

      const state = useSessionStore.getState();
      expect(state.error).toBe('Network timeout');
      expect(state.isLoading).toBe(false);
    });

    it('sets isLoading false on both success and failure', async () => {
      // Success path
      vi.mocked(sessionsApi.listSessions).mockResolvedValueOnce([]);
      await (useSessionStore.getState() as any).fetchSessions();
      expect(useSessionStore.getState().isLoading).toBe(false);

      // Failure path
      vi.mocked(sessionsApi.listSessions).mockRejectedValueOnce(new Error('fail'));
      await (useSessionStore.getState() as any).fetchSessions();
      expect(useSessionStore.getState().isLoading).toBe(false);
    });

    it('clears previous error on new successful fetch', async () => {
      // First: fail
      vi.mocked(sessionsApi.listSessions).mockRejectedValueOnce(new Error('first failure'));
      await (useSessionStore.getState() as any).fetchSessions();
      expect(useSessionStore.getState().error).toBe('first failure');

      // Second: succeed — error should be cleared
      vi.mocked(sessionsApi.listSessions).mockResolvedValueOnce([makeSession('s1')]);
      await (useSessionStore.getState() as any).fetchSessions();
      expect(useSessionStore.getState().error).toBeNull();
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
  });

  // --- 4. clearError resets error to null ---
  describe('clearError', () => {
    it('resets error to null', () => {
      // Manually set an error
      useSessionStore.setState({ error: 'something broke' });
      expect(useSessionStore.getState().error).toBe('something broke');

      // clearError is the action Fenster will add
      (useSessionStore.getState() as any).clearError();
      expect(useSessionStore.getState().error).toBeNull();
    });

    it('is a no-op when error is already null', () => {
      expect(useSessionStore.getState().error).toBeNull();
      (useSessionStore.getState() as any).clearError();
      expect(useSessionStore.getState().error).toBeNull();
    });
  });

  // --- 5. setError still works for direct error setting ---
  describe('setError (existing)', () => {
    it('sets error to a string', () => {
      useSessionStore.getState().setError('manual error');
      expect(useSessionStore.getState().error).toBe('manual error');
    });

    it('clears error when set to null', () => {
      useSessionStore.getState().setError('err');
      useSessionStore.getState().setError(null);
      expect(useSessionStore.getState().error).toBeNull();
    });
  });
});
