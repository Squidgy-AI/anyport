// T2 — MCP / Composio Import.
//
// We CONSUME MCP servers (Composio, anyone's MCP HTTP server). For each
// imported server we capture its tool list at import time, then at chat time
// the LLM (via TokenRouter) sees those tools as OpenAI-compatible function
// descriptors, and tool calls are dispatched back through this client.
//
// Implementation note (2026-05-03): the @modelcontextprotocol/sdk TS client
// proved unreliable under Node 18+ undici-fetch in our Next.js route handlers
// (intermittent ETIMEDOUT to Cloudflare). We hand-roll the JSON-RPC over
// Streamable-HTTP transport directly. Same protocol, fewer surprises.
//
// Streamable HTTP per MCP spec:
//   POST <url>  body: {jsonrpc: '2.0', id, method, params}
//   Headers: Content-Type: application/json, Accept: application/json, text/event-stream
//   Server may return text/event-stream (data: <json>\n) or application/json.
//   May return Mcp-Session-Id; if so, send it back on subsequent requests.
//
// Verified against Composio's MCP server end-to-end on 2026-05-03.

import type { McpConfig, ComposioMcpConfig } from '../types';

export interface IntrospectInput {
  url: string;
  authHeader?: { name: string; value: string };
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

const REQUEST_TIMEOUT_MS = 30_000;

function buildHeaders(input: IntrospectInput, sessionId?: string | null): HeadersInit {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  // Auto-inject Composio API key when talking to a Composio MCP URL.
  // Composio tightened auth in mid-2026 — user_id query alone is insufficient.
  if (parseComposioUrl(input.url) && process.env.COMPOSIO_API_KEY && !input.authHeader) {
    h['X-API-Key'] = process.env.COMPOSIO_API_KEY;
  }
  if (input.authHeader) h[input.authHeader.name] = input.authHeader.value;
  if (sessionId) h['Mcp-Session-Id'] = sessionId;

  return h;
}

async function rpc(
  input: IntrospectInput,
  rpcId: number,
  method: string,
  params: unknown,
  sessionId?: string | null,
): Promise<{ result: unknown; sessionId: string | null }> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params });
  const ctrl = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  const res = await fetch(input.url, {
    method: 'POST',
    headers: buildHeaders(input, sessionId),
    body,
    signal: ctrl,
  });

  const newSessionId = res.headers.get('mcp-session-id') || sessionId || null;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`mcp ${method} returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const ct = res.headers.get('content-type') || '';
  let frame: any;
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    let dataLine: string | null = null;
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) { dataLine = line.slice(5).trim(); break; }
    }
    if (!dataLine) throw new Error(`mcp ${method}: no data: line in SSE response`);
    frame = JSON.parse(dataLine);
  } else {
    frame = await res.json();
  }

  if (frame.error) {
    throw new Error(`mcp ${method} rpc error: ${JSON.stringify(frame.error).slice(0, 300)}`);
  }
  return { result: frame.result, sessionId: newSessionId };
}

export async function introspect(input: IntrospectInput): Promise<IntrospectResult> {
  if (!input.url) return { ok: false, message: 'url is required' };
  if (!/^https?:\/\//i.test(input.url)) {
    return { ok: false, message: 'url must start with http:// or https://' };
  }

  try {
    let sessionId: string | null = null;
    const init = await rpc(input, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'anyport', version: '0.1.0' },
    });
    sessionId = init.sessionId;
    const initResult = init.result as any;

    const list = await rpc(input, 2, 'tools/list', {}, sessionId);
    const tools: IntrospectedTool[] = ((list.result as any)?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    return {
      ok: true,
      message: `connected · ${tools.length} tool(s) discovered`,
      tools,
      serverName: initResult?.serverInfo?.name,
      serverVersion: initResult?.serverInfo?.version,
    };
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

export async function callTool(
  input: CallToolInput,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    // initialize → tools/call. Re-initialize per call: stateless, simpler than
    // managing session lifetimes across long-lived chat sessions.
    let sessionId: string | null = null;
    const init = await rpc(input, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'anyport', version: '0.1.0' },
    });
    sessionId = init.sessionId;

    const call = await rpc(
      input,
      2,
      'tools/call',
      { name: input.toolName, arguments: input.args },
      sessionId,
    );
    const r = call.result as any;
    const parts = (r?.content as any[]) || [];
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
    if (r?.isError) return { ok: false, error: text || 'tool call returned error' };
    return { ok: true, content: text || '(empty result)' };
  } catch (err: any) {
    return { ok: false, error: `mcp call failed: ${err?.message || String(err)}` };
  }
}

// Convert MCP tool schemas to OpenAI-compatible function descriptors.
// TokenRouter accepts the OpenAI tools schema; this is the bridge.
// Strip $schema (OpenAI rejects extra top-level keys in JSON Schema).
export function toOpenAITools(
  tools: IntrospectedTool[],
  prefix = 'mcp__',
): Array<{
  type: 'function';
  function: { name: string; description?: string; parameters: any };
}> {
  return tools.map((t) => {
    const schema = (t.inputSchema as any) || { type: 'object', properties: {} };
    // Drop draft-07 marker — OpenAI's validator ignores or rejects unknown top-level keys.
    const { $schema, ...rest } = schema;
    return {
      type: 'function',
      function: {
        name: `${prefix}${t.name}`,
        description: t.description || `Call MCP tool ${t.name}`,
        parameters: rest,
      },
    };
  });
}

// Composio MCP URL pattern: https://backend.composio.dev/v3/mcp/<server_id>/mcp?...&user_id=<uid>
// (Also matches mcp.composio.dev for legacy/alt domains.)
// Returns null for non-Composio URLs.
export function parseComposioUrl(
  url: string,
): { composioServerId: string; composioUserId: string } | null {
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
