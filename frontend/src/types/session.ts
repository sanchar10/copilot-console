import type { AgentTools, SystemMessage } from './agent';
import type { ChatStep, Message } from './message';

export interface Session {
  session_id: string;
  session_name: string;
  model: string;
  reasoning_effort?: string | null;
  cwd?: string;
  mcp_servers?: string[];
  tools?: AgentTools;
  system_message?: SystemMessage | null;
  sub_agents?: string[];
  created_at: string;
  updated_at: string;
  // Runtime settings (persisted, survive reactivation)
  selected_agent?: string | null;
  agent_mode?: string | null;
  // Reference fields (informational only)
  agent_id?: string | null;
  trigger?: string | null;
}

export interface SessionWithMessages extends Session {
  messages: Message[];
  load_error?: string | null;
}

export type { ChatStep, Message };
export type { SendMessageOptions } from '../api/sessions';

export interface CreateSessionRequest {
  model: string;
  reasoning_effort?: string | null;
  name?: string;
  cwd?: string;
  mcp_servers?: string[];
  tools?: AgentTools;
  system_message?: SystemMessage | null;
  agent_id?: string;
  sub_agents?: string[];
  selected_agent?: string | null;
  agent_mode?: string | null;
}

export interface UpdateSessionRequest {
  name?: string;
  cwd?: string;
  mcp_servers?: string[];
  tools?: AgentTools;
  system_message?: SystemMessage | null;
  sub_agents?: string[];
  model?: string;
  reasoning_effort?: string;
  selected_agent?: string | null;
  agent_mode?: string | null;
}
