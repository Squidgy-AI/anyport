export type ImportSource =
  | 'squidgy_yaml'
  | 'external_endpoint'
  | 'external_mcp'
  | 'composio_mcp'
  | 'a2a'
  | 'openai_sdk';

export type VerificationStatus = 'pending' | 'verified' | 'unverified' | 'stale';

export interface AgentTool {
  name: string;
  url: string;
}

export interface AgentRow {
  id: string;
  name: string;
  system_prompt: string;
  tools: AgentTool[];
  model: string;
  mcp_install_url: string | null;
  tokenrouter_key: string | null;
  avatar_url: string | null;
  squidgy_id: string | null;
  import_source: ImportSource;
  import_config: ImportConfig;
  verification_status: VerificationStatus;
  verification_token: string | null;
  owner_email: string | null;
  owner_user_id: string | null;
  created_at: string;
}

// Discriminated import config per source. Anything that needs to be
// callable at chat time (URL, auth scheme, schemas) lives here.
export type ImportConfig =
  | EmptyConfig
  | EndpointConfig
  | McpConfig
  | ComposioMcpConfig;

export interface EmptyConfig {}

export interface EndpointConfig {
  kind: 'endpoint';
  url: string;
  method?: 'POST' | 'GET';
  // 'none' | 'bearer' | 'header'. Secret stored separately by id.
  auth: { kind: 'none' } | { kind: 'bearer'; secretId: string } | { kind: 'header'; name: string; secretId: string };
  request: {
    // JSON path/key under which to put the user's message in the request body
    messageField: string;
    // optional fields the endpoint expects
    userField?: string;
    sessionField?: string;
    // any extra fixed keys merged into every request
    extra?: Record<string, unknown>;
  };
  response: {
    // dot-path to the assistant text (e.g. 'response', 'message', 'choices.0.message.content')
    textPath: string;
  };
}

export interface McpConfig {
  kind: 'mcp';
  url: string;
  auth: { kind: 'none' } | { kind: 'bearer'; secretId: string };
  // tools the user chose to expose (names from the MCP server's tools/list)
  exposedTools: string[];
  // captured at import time so we don't have to re-introspect on every call
  toolSchemas: Array<{
    name: string;
    description?: string;
    inputSchema: unknown; // raw JSON schema from MCP
  }>;
}

export interface ComposioMcpConfig {
  kind: 'composio_mcp';
  url: string;
  composioUserId: string;
  composioServerId: string;
  exposedTools: string[];
  toolSchemas: Array<{
    name: string;
    description?: string;
    inputSchema: unknown;
  }>;
}

// ----- Importer common types -----

export interface ImporterContext {
  agentId: string;
  ownerEmail?: string;
  ownerUserId?: string;
}

export interface ProbeResult {
  ok: boolean;
  message: string; // human-readable summary for the form UI
  sample?: unknown; // captured first response from the probe (may be redacted)
}

export interface ImportResult {
  importSource: ImportSource;
  importConfig: ImportConfig;
  // a name + system prompt the publish flow can use, derived from the import
  derivedName: string;
  derivedSystemPrompt: string;
  // tools to surface in the existing chat loop (for endpoint imports this is empty;
  // for MCP imports we synthesize one virtual tool per exposed MCP tool)
  derivedTools: AgentTool[];
}
