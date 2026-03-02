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
});
