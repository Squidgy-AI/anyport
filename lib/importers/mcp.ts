// T2 — MCP / Composio Import.
//
// We CONSUME MCP servers (Composio, anyone's MCP HTTP server). For each
// imported server we capture its tool list at import time, then at chat time
// the LLM (via TokenRouter) sees those tools as OpenAI-compatible function
// descriptors, and tool calls are dispatched back through the MCP client.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpConfig, ComposioMcpConfig } from '../types';

export interface IntrospectInput {
  url: string;
  authHeader?: { name: string; value: string };
  // Composio URLs already have user_id as a query param; nothing extra needed.
}

export interface IntrospectedTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface IntrospectResult {
  ok: boolean;
  message: string;
  tools?: IntrospectedTool[];
  serverName?: string;
  serverVersion?: string;
}

const INTROSPECT_TIMEOUT_MS = 20_000;

function makeTransport(input: IntrospectInput) {
  const opts: any = {};
  if (input.authHeader) {
    opts.requestInit = {
      headers: { [input.authHeader.name]: input.authHeader.value },
    };
  }
  return new StreamableHTTPClientTransport(new URL(input.url), opts);
}

async function withClient<T>(input: IntrospectInput, fn: (c: Client) => Promise<T>): Promise<T> {
  const transport = makeTransport(input);
  const client = new Client(
    { name: 'anyport', version: '0.1.0' },
    { capabilities: {} },
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INTROSPECT_TIMEOUT_MS);
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    clearTimeout(timer);
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

export async function introspect(input: IntrospectInput): Promise<IntrospectResult> {
  if (!input.url) return { ok: false, message: 'url is required' };
  if (!/^https?:\/\//i.test(input.url)) {
    return { ok: false, message: 'url must start with http:// or https://' };
  }

  try {
    return await withClient(input, async (client) => {
      const info = client.getServerVersion();
      const list = await client.listTools();
      const tools: IntrospectedTool[] = (list.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return {
        ok: true,
        message: `connected · ${tools.length} tool(s) discovered`,
        tools,
        serverName: info?.name,
        serverVersion: info?.version,
      };
    });
  } catch (err: any) {
    return { ok: false, message: `mcp introspect failed: ${err?.message || String(err)}` };
  }
}

export interface CallToolInput {
  url: string;
  authHeader?: { name: string; value: string };
  toolName: string;
  args: Record<string, unknown>;
}

export async function callTool(input: CallToolInput): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    return await withClient(input, async (client) => {
      const result = await client.callTool({ name: input.toolName, arguments: input.args });
      // MCP returns content as an array of typed parts. Flatten text parts to a single string.
      const parts = (result.content as any[]) || [];
      const text = parts
        .map((p: any) => {
          if (typeof p === 'string') return p;
          if (p && p.type === 'text' && typeof p.text === 'string') return p.text;
          if (p && p.type === 'image') return `[image:${p.mimeType || 'unknown'}]`;
          if (p && p.type === 'resource' && p.resource?.text) return p.resource.text;
          return '';
        })
        .join('')
        .trim();
      if (result.isError) {
        return { ok: false as const, error: text || 'tool call returned error' };
      }
      return { ok: true as const, content: text || '(empty result)' };
    });
  } catch (err: any) {
    return { ok: false, error: `mcp call failed: ${err?.message || String(err)}` };
  }
}

// Convert MCP tool schemas to OpenAI-compatible function descriptors.
// TokenRouter accepts the OpenAI tools schema; this is the bridge.
export function toOpenAITools(
  tools: IntrospectedTool[],
  // the LLM sees a name; we prefix with mcp__ so the chat dispatcher can route correctly
  prefix = 'mcp__',
): Array<{
  type: 'function';
  function: { name: string; description?: string; parameters: any };
}> {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: `${prefix}${t.name}`,
      description: t.description || `Call MCP tool ${t.name}`,
      parameters: (t.inputSchema as any) || { type: 'object', properties: {} },
    },
  }));
}

// Composio MCP URL pattern: https://mcp.composio.dev/v3/mcp/<server_id>/mcp?user_id=<uid>
// Returns null for non-Composio URLs.
export function parseComposioUrl(url: string): { composioServerId: string; composioUserId: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('composio.dev')) return null;
    const m = u.pathname.match(/\/mcp\/([^/]+)\/mcp/);
    if (!m) return null;
    const userId = u.searchParams.get('user_id') || '';
    return { composioServerId: m[1], composioUserId: userId };
  } catch {
    return null;
  }
}

export type AnyMcpConfig = McpConfig | ComposioMcpConfig;
