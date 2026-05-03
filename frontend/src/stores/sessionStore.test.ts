import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './sessionStore';
import type { Session } from '../types/session';

const initialState = useSessionStore.getState();

function resetStore() {
  useSessionStore.setState(initialState, true);
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

describe('sessionStore', () => {
  beforeEach(resetStore);

  // --- setSessions ---
  describe('setSessions', () => {
    it('replaces the sessions list', () => {
      const sessions = [makeSession('a'), makeSession('b')];
      useSessionStore.getState().setSessions(sessions);
      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });

    it('overwrites previous sessions', () => {
      useSessionStore.getState().setSessions([makeSession('a')]);
      useSessionStore.getState().setSessions([makeSession('b')]);
      const ids = useSessionStore.getState().sessions.map((s) => s.session_id);
      expect(ids).toEqual(['b']);
    });
  });

  // --- updateNewSessionSettings ---
  describe('updateNewSessionSettings', () => {
    it('merges partial settings into existing settings', () => {
      useSessionStore.setState({
        newSessionSettings: { name: 'old', model: 'gpt-4.1', reasoningEffort: null, cwd: '/', mcpServers: [], tools: { custom: [], builtin: [], excluded_builtin: [] }, agentMode: 'interactive' },
      });
      useSessionStore.getState().updateNewSessionSettings({ name: 'updated' });
      expect(useSessionStore.getState().newSessionSettings!.name).toBe('updated');
      expect(useSessionStore.getState().newSessionSettings!.model).toBe('gpt-4.1');
    });

    it('returns null if newSessionSettings is null', () => {
      useSessionStore.setState({ newSessionSettings: null });
      useSessionStore.getState().updateNewSessionSettings({ name: 'x' });
      expect(useSessionStore.getState().newSessionSettings).toBeNull();
    });
  });

  // --- addSession ---
  describe('addSession', () => {
    it('prepends session and clears new-session mode', () => {
      useSessionStore.setState({ isNewSession: true });
      useSessionStore.getState().addSession(makeSession('s1'));
      const state = useSessionStore.getState();
      expect(state.sessions[0].session_id).toBe('s1');
      expect(state.isNewSession).toBe(false);
    });
  });

  // --- removeSession ---
  describe('removeSession', () => {
    it('removes session from list', () => {
      useSessionStore.setState({
        sessions: [makeSession('s1')],
      });
      useSessionStore.getState().removeSession('s1');
      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(0);
    });
  });

  // --- moveSessionToTop ---
  describe('moveSessionToTop', () => {
    it('moves the specified session to the front', () => {
      useSessionStore.setState({ sessions: [makeSession('a'), makeSession('b'), makeSession('c')] });
      useSessionStore.getState().moveSessionToTop('c');
      const ids = useSessionStore.getState().sessions.map((s) => s.session_id);
      expect(ids).toEqual(['c', 'a', 'b']);
    });
  });

  // --- clearNewSession ---
  describe('clearNewSession', () => {
    it('clears new session mode and settings', () => {
      useSessionStore.setState({
        isNewSession: true,
        newSessionSettings: { name: 'x', model: 'm', reasoningEffort: null, cwd: '/', mcpServers: [], tools: { custom: [], builtin: [], excluded_builtin: [] }, agentMode: 'interactive' },
      });
      useSessionStore.getState().clearNewSession();
      expect(useSessionStore.getState().isNewSession).toBe(false);
      expect(useSessionStore.getState().newSessionSettings).toBeNull();
    });
  });

  // --- availableMcpServers CRUD merges (Phase 3 Slice 6) ---
  describe('upsertAvailableMcpServer', () => {
    const baseServer = (name: string, command = 'echo') => ({
      name,
      command,
      tools: ['*'],
      source: 'global',
    });

    it('appends a server when no existing entry matches the name', () => {
      useSessionStore.setState({ availableMcpServers: [baseServer('a')] });
      useSessionStore.getState().upsertAvailableMcpServer(baseServer('b'));
      const names = useSessionStore.getState().availableMcpServers.map((s) => s.name);
      expect(names).toEqual(['a', 'b']);
    });

    it('replaces an existing server in place when names match', () => {
      useSessionStore.setState({
        availableMcpServers: [baseServer('a'), baseServer('b'), baseServer('c')],
      });
      useSessionStore.getState().upsertAvailableMcpServer(baseServer('b', 'newcmd'));
      const list = useSessionStore.getState().availableMcpServers;
      expect(list.map((s) => s.name)).toEqual(['a', 'b', 'c']); // order preserved
      expect(list[1].command).toBe('newcmd');
    });

    it('produces a new array reference (immutability — Zustand selectors rely on this)', () => {
      const original = [baseServer('a')];
      useSessionStore.setState({ availableMcpServers: original });
      useSessionStore.getState().upsertAvailableMcpServer(baseServer('b'));
      expect(useSessionStore.getState().availableMcpServers).not.toBe(original);
    });
  });

  describe('removeAvailableMcpServer', () => {
    it('drops the matching server from the list', () => {
      useSessionStore.setState({
        availableMcpServers: [
          { name: 'a', tools: [], source: 'global' },
          { name: 'b', tools: [], source: 'global' },
        ],
      });
      useSessionStore.getState().removeAvailableMcpServer('a');
      const names = useSessionStore.getState().availableMcpServers.map((s) => s.name);
      expect(names).toEqual(['b']);
    });

    it('is a no-op when no server matches the name', () => {
      const original = [{ name: 'a', tools: [], source: 'global' }];
      useSessionStore.setState({ availableMcpServers: original });
      useSessionStore.getState().removeAvailableMcpServer('ghost');
      expect(useSessionStore.getState().availableMcpServers).toHaveLength(1);
    });
  });
});
