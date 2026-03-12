import type { AgentTools, SystemMessage } from './agent';

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
  // Reference fields (informational only)
  agent_id?: string | null;
  trigger?: string | null;
}

export interface SessionWithMessages extends Session {
  messages: Message[];
}

export interface ChatStep {
  title: string;
  detail?: string;
}

export interface Message {
  id: string;
  sdk_message_id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  steps?: ChatStep[];
}

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
}

export interface UpdateSessionRequest {
  name?: string;
  cwd?: string;
  mcp_servers?: string[];
  tools?: AgentTools;
  system_message?: SystemMessage | null;
  sub_agents?: string[];
}
