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
  /**
   * Interaction mode:
   * - 'immediate': runs on selection, no further input (e.g. /compact, /help)
   * - 'prompt': shows chip, user types a prompt, then sends (e.g. /fleet)
   * - 'submenu': opens a second-level picker in the palette (e.g. /agent)
   */
  interaction: 'immediate' | 'prompt' | 'submenu';
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
    interaction: 'prompt',
    placeholder: 'Describe the task to parallelize...',
    actionType: 'api',
    endpoint: 'fleet',
    usage: '[prompt]',
  },
  {
    name: 'compact',
    description: 'Compact session context',
    icon: '📦',
    interaction: 'immediate',
    actionType: 'api',
    endpoint: 'compact',
    usage: '',
  },
  {
    name: 'help',
    description: 'Show available commands',
    icon: '❓',
    interaction: 'immediate',
    actionType: 'client',
    usage: '',
  },
  {
    name: 'agent',
    description: 'Select a custom agent',
    icon: '🤖',
    interaction: 'submenu',
    actionType: 'api',
    endpoint: 'agent',
    usage: '',
  },
];

/** Filter commands by partial name match (case-insensitive). */
export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
}
