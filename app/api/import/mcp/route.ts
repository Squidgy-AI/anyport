// POST /api/import/mcp — T2 MCP / Composio Import.
// Introspects the server, captures tool schemas, persists, returns install URL.
//
// Body:
// {
//   url, authHeader?: {name, value}, exposedTools?: string[],
//   name?, systemPrompt?, model?, ownerEmail?
// }
import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';
import { mcp as mcpImporter } from '@/lib/importers';
import { storeSecret } from '@/lib/secrets';
import type { McpConfig, ComposioMcpConfig, ImportConfig, ImportSource } from '@/lib/types';

export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT =
  'You are an agent backed by MCP tools. When the user asks for something, decide if a tool call is needed; otherwise reply directly. Quote tool output verbatim when reporting results.';

interface ImportMcpBody {
  url: string;
  authHeader?: { name: string; value: string };
  exposedTools?: string[];
  name?: string;
  systemPrompt?: string;
  model?: string;
  ownerEmail?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ImportMcpBody | null;
  if (!body || !body.url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  // 1. Introspect — required, refuse import if MCP server doesn't respond.
  const probe = await mcpImporter.introspect({
    url: body.url,
    authHeader: body.authHeader,
  });
  if (!probe.ok || !probe.tools) {
    return NextResponse.json({ error: `introspect failed: ${probe.message}` }, { status: 400 });
  }

  const composio = mcpImporter.parseComposioUrl(body.url);
  const importSource: ImportSource = composio ? 'composio_mcp' : 'external_mcp';

  // 2. Decide which tools to expose. Default = all.
  const exposed = body.exposedTools && body.exposedTools.length > 0
    ? probe.tools.filter((t) => body.exposedTools!.includes(t.name))
    : probe.tools;
  if (!exposed.length) {
    return NextResponse.json({ error: 'no tools selected — at least one required' }, { status: 400 });
  }

  const agentId = nanoid(10);

  // 3. Store auth header value as secret (if present), keep header name in config.
  let authHeaderRef: { name: string; secretId: string } | undefined;
  if (body.authHeader?.value) {
    try {
      const secretId = await storeSecret(agentId, body.authHeader.value);
      authHeaderRef = { name: body.authHeader.name, secretId };
    } catch (err: any) {
      return NextResponse.json({ error: `secret store failed: ${err?.message || String(err)}` }, { status: 500 });
    }
  }

  const baseConfig = {
    url: body.url,
    exposedTools: exposed.map((t) => t.name),
    toolSchemas: exposed,
    auth: authHeaderRef
      ? ({ kind: 'bearer' as const, secretId: authHeaderRef.secretId })
      : ({ kind: 'none' as const }),
    authHeaderName: authHeaderRef?.name,
  };

  const config: ImportConfig = composio
    ? ({
        kind: 'composio_mcp',
        url: body.url,
        composioUserId: composio.composioUserId,
        composioServerId: composio.composioServerId,
        exposedTools: baseConfig.exposedTools,
        toolSchemas: baseConfig.toolSchemas,
      } as ComposioMcpConfig)
    : ({
        kind: 'mcp',
        url: body.url,
        auth: baseConfig.auth,
        exposedTools: baseConfig.exposedTools,
        toolSchemas: baseConfig.toolSchemas,
      } as McpConfig);

  const verificationToken = nanoid(32);
  const name = (body.name || probe.serverName || new URL(body.url).hostname).slice(0, 80);
  const systemPrompt = body.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const { error } = await supabase.from('anyport_agents').insert({
    id: agentId,
    name,
    system_prompt: systemPrompt,
    tools: [], // MCP tools live in import_config, not the legacy tools[] field
    model: body.model || 'openai/gpt-4o-mini',
    mcp_install_url: null,
    tokenrouter_key: process.env.TOKENROUTER_API_KEY!,
    import_source: importSource,
    import_config: config,
    verification_status: composio ? 'verified' : 'pending', // composio URLs are inherently scoped
    verification_token: composio ? null : verificationToken,
    owner_email: body.ownerEmail || null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3040';
  return NextResponse.json({
    agentId,
    installUrl: `${appUrl}/agent/${agentId}`,
    importSource,
    discoveredTools: probe.tools.map((t) => t.name),
    exposedTools: baseConfig.exposedTools,
    serverName: probe.serverName,
    serverVersion: probe.serverVersion,
    verification: composio
      ? null
      : {
          token: verificationToken,
          method: 'signed-callback',
          instruction: 'Public listing requires a verify tool round-trip. Phase-2; for now agent works on direct link.',
        },
  });
}
