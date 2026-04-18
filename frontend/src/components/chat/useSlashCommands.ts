import { useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import type { SlashCommand } from './slashCommands';
import { SLASH_COMMANDS } from './slashCommands';
import { compactSession } from '../../api/sessions';
import { isSessionReady } from './InputBox';

/**
 * Encapsulates slash command detection, palette state, and execution.
 *
 * RPC commands (compact, agent) follow the unified session settings pattern:
 * - Active session (isSessionReady): fire API immediately
 * - New/Resumed session: store pending, defer to first sendMessage
 */
export function useSlashCommands(sessionId?: string) {
  const [showSlashPalette, setShowSlashPalette] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [activeCommand, setActiveCommand] = useState<SlashCommand | null>(null);
  const { addMessage } = useChatStore();

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setShowSlashPalette(false);
    setSlashQuery('');
    if (cmd.executeImmediately) {
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
          // Active session — fire immediately
          compactSession(sessionId).then(result => {
            const detail = result.success
              ? `tokens freed: ${result.tokens_removed ?? '?'}`
              : 'compaction failed';
            addMessage(sessionId, {
              id: `system-compact-${Date.now()}`,
              role: 'system',
              content: `📦 Compact: ${detail}`,
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
        } else if (sessionId) {
          // New/Resumed session — nothing to compact yet
          addMessage(sessionId, {
            id: `system-compact-${Date.now()}`,
            role: 'system',
            content: '📦 Compact: session not active yet — nothing to compact',
            timestamp: new Date().toISOString(),
          });
        }
      }
      return;
    }
    setActiveCommand(cmd);
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
        const detail = result.success
          ? `tokens freed: ${result.tokens_removed ?? '?'}`
          : 'compaction failed';
        addMessage(sessionId, {
          id: `system-compact-${Date.now()}`,
          role: 'system',
          content: `📦 Compact: ${detail}`,
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
        if (matched.executeImmediately) {
          handleSlashSelect(matched);
          return { newInput: '', consumed: true };
        } else {
          setActiveCommand(matched);
          return { newInput: value.slice(value.indexOf(' ') + 1), consumed: true };
        }
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
    handleSlashDismiss,
    clearActiveCommand,
    executeSlashCommand,
    processInputForSlash,
  };
}
