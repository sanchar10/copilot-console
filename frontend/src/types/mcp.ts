export interface MCPServer {
  name: string;
  type?: string;
  // Local server fields
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // Remote server fields
  url?: string;
  headers?: Record<string, string>;
  // OAuth client metadata (SDK 0.3.0+)
  oauthClientId?: string;
  oauthPublicClient?: boolean;
  // Common fields
  tools: string[];
  timeout?: number;
  source: string; // 'global', 'agent-only', or plugin name
}

export interface MCPServerConfig {
  servers: MCPServer[];
}

export type MCPServerSelections = Record<string, boolean>;
