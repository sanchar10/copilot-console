/**
 * Slash command registry.
 *
 * Adding a new command:
 *  1. Add an entry to SLASH_COMMANDS below.
 *  2. Add the corresponding backend endpoint in sessions.py.
 *  3. Add the API function in api/sessions.ts.
 *  Done — the palette, chip, and dispatch logic are fully data-driven.
 */

export interface SlashCommand {
  /** The command keyword (without leading /) */
  name: string;
  /** Short description shown in the palette */
  description: string;
  /** Emoji icon */
  icon: string;
  /** If true, the send button requires the user to type a prompt after the chip */
  requiresPrompt: boolean;
  /** If true, the command runs immediately on selection (no chip/send flow) */
  executeImmediately: boolean;
  /** Placeholder text shown in the input when this command is active */
  placeholder?: string;
  /** The API action type: 'api' calls a backend endpoint, 'client' runs locally */
  actionType: 'api' | 'client';
  /** Backend endpoint path (relative, e.g. 'fleet'). POST /sessions/{id}/{endpoint} */
  endpoint?: string;
  /** Usage syntax shown in palette (e.g. '/fleet [prompt]') */
  usage?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'fleet',
    description: 'Run with parallel sub-agents',
    icon: '🚀',
    requiresPrompt: true,
    executeImmediately: false,
    placeholder: 'Describe the task to parallelize...',
    actionType: 'api',
    endpoint: 'fleet',
    usage: '[prompt]',
  },
  {
    name: 'compact',
    description: 'Compact session context',
    icon: '📦',
    requiresPrompt: false,
    executeImmediately: true,
    actionType: 'api',
    endpoint: 'compact',
    usage: '',
  },
  {
    name: 'help',
    description: 'Show available commands',
    icon: '❓',
    requiresPrompt: false,
    executeImmediately: true,
    actionType: 'client',
    usage: '',
  },
  {
    name: 'agent',
    description: 'Select a custom agent',
    icon: '🤖',
    requiresPrompt: true,
    executeImmediately: false,
    placeholder: 'Enter agent name...',
    actionType: 'api',
    endpoint: 'agent',
    usage: '[agent-name]',
  },
];

/** Filter commands by partial name match (case-insensitive). */
export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
}
