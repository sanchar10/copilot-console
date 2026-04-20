import { useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';
import type { SlashCommand } from './slashCommands';
import { SLASH_COMMANDS } from './slashCommands';
import { compactSession, selectAgent, deselectAgent, updateSession } from '../../api/sessions';
import { isSessionReady } from './InputBox';

/**
 * Encapsulates slash command detection, palette state, and execution.
 *
 * RPC commands (compact, agent) follow the unified session settings pattern:
 * - Active session (isSessionReady): fire server endpoint (RPC + persist)
 * - New session: store in newSessionSettings, flows to createSession body
 * - Resumed session: PATCH session.json, defer RPC to first sendMessage
 */
export function useSlashCommands(sessionId?: string) {
  const [showSlashPalette, setShowSlashPalette] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [activeCommand, setActiveCommand] = useState<SlashCommand | null>(null);
  const { addMessage } = useChatStore();

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setShowSlashPalette(false);
    setSlashQuery('');
    if (cmd.interaction === 'immediate') {
      if (cmd.name === 'help') {
        const helpLines = SLASH_COMMANDS.map(c => `${c.icon} **/${c.name}** — ${c.description}`).join('\n');
        const helpContent = `Available commands:\n${helpLines}`;
        if (sessionId) {
          addMessage(sessionId, {
            id: `system-help-${Date.now()}`,
            role: 'system',
            content: helpContent,
            timestamp: new Date().toISOString(),
          });
        }
      } else if (cmd.name === 'compact') {
        if (sessionId && isSessionReady(sessionId)) {
          // Active session — show progress, fire immediately
          addMessage(sessionId, {
            id: `system-compact-progress-${Date.now()}`,
            role: 'system',
            content: '⟳ Compacting context...',
            timestamp: new Date().toISOString(),
          });
          compactSession(sessionId).then(result => {
            const tokens = result.tokens_removed ?? 0;
            const msgs = result.messages_removed ?? 0;
            const detail = result.success && (tokens || msgs)
              ? `Freed ${tokens} tokens. Messages summarized: ${msgs}.`
              : 'nothing to compact';
            addMessage(sessionId, {
              id: `system-compact-${Date.now()}`,
              role: 'system',
              content: `✓ Context compacted — ${detail}`,
              timestamp: new Date().toISOString(),
            });
          }).catch(err => {
            addMessage(sessionId, {
              id: `system-error-${Date.now()}`,
              role: 'system',
              content: `❌ Failed to compact: ${err instanceof Error ? err.message : 'Unknown error'}`,
              timestamp: new Date().toISOString(),
            });
          });
        } else {
          // New session (no sessionId) or resumed session (not active) — store pending
          const { isNewSession } = useSessionStore.getState();
          if (isNewSession) {
            useSessionStore.getState().updateNewSessionSettings({ pendingCompact: true });
          } else if (sessionId) {
            useChatStore.getState().setPendingCompact(sessionId, true);
          }
          // Show queued message (only when we have a sessionId to attach it to)
          if (sessionId) {
            addMessage(sessionId, {
              id: `system-compact-${Date.now()}`,
              role: 'system',
              content: '📦 Compact: queued — will run when session activates',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
      return;
    }
    // 'submenu' commands are handled by the palette itself (second-level picker)
    // 'prompt' commands show a chip
    if (cmd.interaction === 'prompt') {
      setActiveCommand(cmd);
    }
  }, [sessionId, addMessage]);

  /**
   * Handle agent selection from the two-level palette picker.
   * agentName = null means "deselect / revert to Copilot default"
   */
  const handleAgentSelect = useCallback(async (agentName: string | null) => {
    const { isNewSession, sessions } = useSessionStore.getState();

    if (sessionId && isSessionReady(sessionId)) {
      // Active session — fire RPC (server persists after success)
      // Skip if value unchanged (case-insensitive compare — selector sends
      // lowercase name but server may persist display_name with different casing)
      const currentAgent = sessions.find(s => s.session_id === sessionId)?.selected_agent;
      const isSameAgent = agentName && currentAgent
        ? agentName.toLowerCase() === currentAgent.toLowerCase()
        : false;
      const isBothDefault = agentName === null &&
        (currentAgent === null || currentAgent === undefined || currentAgent === 'default');
      if (isSameAgent || isBothDefault) {
        return; // No change — skip redundant RPC
      }
      try {
        if (agentName) {
          const result = await selectAgent(sessionId, agentName);
          const confirmed = result.agent?.display_name || result.agent?.name;
          if (!confirmed) {
            throw new Error('Server returned no agent name after selection');
          }
          addMessage(sessionId, {
            id: `system-agent-${Date.now()}`,
            role: 'system',
            content: `🤖 Agent: switched to "${confirmed}"`,
            timestamp: new Date().toISOString(),
          });
          // Update local state to match server (server already persisted)
          useSessionStore.getState().updateSessionField(sessionId, 'selected_agent', confirmed);
        } else {
          await deselectAgent(sessionId);
          addMessage(sessionId, {
            id: `system-agent-${Date.now()}`,
            role: 'system',
            content: '✨ Agent: switched to Copilot (default)',
            timestamp: new Date().toISOString(),
          });
          // Store 'default' sentinel — explicit deselection (server already persists 'default')
          useSessionStore.getState().updateSessionField(sessionId, 'selected_agent', 'default');
        }
      } catch (err) {
        addMessage(sessionId, {
          id: `system-error-${Date.now()}`,
          role: 'system',
          content: `❌ Failed to select agent: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date().toISOString(),
        });
      }
    } else if (isNewSession) {
      // New session — store in newSessionSettings, flows to createSession body
      // null = Copilot (default), no sentinel needed for new sessions
      useSessionStore.getState().updateNewSessionSettings({ selectedAgent: agentName || undefined });
    } else if (sessionId) {
      // Resumed (not active) — PATCH session.json so backend reads it on resume
      // Use 'default' sentinel for explicit Copilot selection (vs null = never touched)
      const patchValue = agentName === null ? 'default' : agentName;
      // Skip if value unchanged
      const currentAgent = sessions.find(s => s.session_id === sessionId)?.selected_agent;
      const isSameAgent = agentName && currentAgent
        ? agentName.toLowerCase() === currentAgent.toLowerCase()
        : false;
      const isBothDefault = agentName === null &&
        (currentAgent === 'default');
      if (isSameAgent || isBothDefault) {
        return;
      }
      try {
        await updateSession(sessionId, { selected_agent: patchValue });
        useSessionStore.getState().updateSessionField(sessionId, 'selected_agent', patchValue);
        // No system message here — the server emits a step event ("switched to X")
        // when the session activates on the next send_message. Adding one here
        // would cause a duplicate.
      } catch (err) {
        console.error('Failed to persist agent to session.json:', err);
      }
    }
  }, [sessionId, addMessage]);

  const handleSlashDismiss = useCallback(() => {
    setShowSlashPalette(false);
    setSlashQuery('');
  }, []);

  const clearActiveCommand = useCallback(() => {
    setActiveCommand(null);
  }, []);

  const executeSlashCommand = useCallback(async (cmd: SlashCommand, _prompt: string) => {
    if (!sessionId) return;
    try {
      if (cmd.name === 'compact') {
        const result = await compactSession(sessionId);
        const tokens = result.tokens_removed ?? 0;
        const msgs = result.messages_removed ?? 0;
        const detail = result.success && (tokens || msgs)
          ? `Freed ${tokens} tokens. Messages summarized: ${msgs}.`
          : 'nothing to compact';
        addMessage(sessionId, {
          id: `system-compact-${Date.now()}`,
          role: 'system',
          content: `✓ Context compacted — ${detail}`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error(`Failed to execute /${cmd.name}:`, err);
      addMessage(sessionId, {
        id: `system-error-${Date.now()}`,
        role: 'system',
        content: `❌ Failed to execute /${cmd.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [sessionId, addMessage]);

  /**
   * Process input changes to detect slash command typing.
   * Returns the processed input value (may be modified if a command is auto-completed).
   */
  const processInputForSlash = useCallback((value: string): { newInput: string; consumed: boolean } => {
    if (!activeCommand && value.startsWith('/') && !value.includes(' ')) {
      setShowSlashPalette(true);
      setSlashQuery(value.slice(1));
      return { newInput: value, consumed: false };
    } else if (!activeCommand && value.startsWith('/') && value.includes(' ')) {
      const cmdName = value.slice(1, value.indexOf(' '));
      const matched = SLASH_COMMANDS.find(c => c.name === cmdName);
      if (matched) {
        setShowSlashPalette(false);
        setSlashQuery('');
        if (matched.interaction === 'immediate') {
          handleSlashSelect(matched);
          return { newInput: '', consumed: true };
        } else if (matched.interaction === 'prompt') {
          setActiveCommand(matched);
          return { newInput: value.slice(value.indexOf(' ') + 1), consumed: true };
        }
        // 'submenu' typed with space — ignore the space, treat as command selection
        return { newInput: '', consumed: true };
      } else {
        setShowSlashPalette(false);
        setSlashQuery('');
        return { newInput: value, consumed: false };
      }
    } else if (showSlashPalette) {
      setShowSlashPalette(false);
      setSlashQuery('');
    }
    return { newInput: value, consumed: false };
  }, [activeCommand, showSlashPalette, handleSlashSelect]);

  return {
    showSlashPalette,
    slashQuery,
    activeCommand,
    handleSlashSelect,
    handleAgentSelect,
    handleSlashDismiss,
    clearActiveCommand,
    executeSlashCommand,
    processInputForSlash,
  };
}
