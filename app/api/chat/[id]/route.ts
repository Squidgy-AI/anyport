import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';
import { endpoint as endpointImporter, mcp as mcpImporter } from '@/lib/importers';
import { readSecret } from '@/lib/secrets';
import type { EndpointConfig, McpConfig, ComposioMcpConfig } from '@/lib/types';

const BASE = process.env.TOKENROUTER_BASE_URL || 'https://api.tokenrouter.com/v1';
const ROOT_KEY = process.env.TOKENROUTER_API_KEY!;
// REQUIRED — UUID of the user whose tokens the n8n webhook should use.
const DEMO_USER_ID = process.env.DEMO_USER_ID || '';

const PRICING: Record<string, { in: number; out: number }> = {
  'openai/gpt-4o-mini': { in: 0.15 / 1_000_000, out: 0.6 / 1_000_000 },
  'openai/gpt-5-mini': { in: 0.25 / 1_000_000, out: 1.0 / 1_000_000 },
  'anthropic/claude-haiku-4.5': { in: 1.0 / 1_000_000, out: 5.0 / 1_000_000 },
  'anthropic/claude-sonnet-4.6': { in: 3.0 / 1_000_000, out: 15.0 / 1_000_000 },
};

const MAX_TOOL_HOPS = 4;

interface AgentTool {
  name: string;
  url: string;
}

function isSquidgyWebhook(url: string): boolean {
  // Any https://*/webhook/<slug> URL is treated as an n8n-style webhook tool.
  return /^https:\/\/[^/]+\/webhook\//.test(url);
}

function buildToolDefs(tools: AgentTool[], agentName: string) {
  return tools
    .filter((t) => t.url && isSquidgyWebhook(t.url))
    .map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: `Run an action on ${agentName}'s live Squidgy backend (lists connected accounts, drafts/schedules posts, generates content). Pass the user's natural-language instruction in user_mssg.`,
        parameters: {
          type: 'object',
          properties: {
            user_mssg: {
              type: 'string',
              description: "The user's instruction in natural language",
            },
          },
          required: ['user_mssg'],
        },
      },
    }));
}

function webhookSlug(url: string): string {
  // /webhook/social_media_agent → social_media_agent
  try {
    return new URL(url).pathname.replace(/\/+$/, '').split('/').pop() || '';
  } catch {
    return '';
  }
}

async function callSquidgyWebhook(
  url: string,
  _agentName: string,
  sessionId: string,
  userMssg: string,
): Promise<string> {
  const payload = {
    user_id: DEMO_USER_ID,
    user_mssg: userMssg,
    session_id: sessionId,
    agent_name: webhookSlug(url),
    timestamp_of_call_made: new Date().toISOString(),
    request_id: nanoid(),
    sending_from: 'User',
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) return `(webhook ${resp.status})`;
  const text = await resp.text();
  const parts: string[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'item' && typeof obj.content === 'string') parts.push(obj.content);
    } catch {
      /* ignore */
    }
  }
  return parts.join('').trim() || '(no response)';
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { messages } = await req.json();

  const { data: agent, error: agentErr } = await supabase
    .from('anyport_agents')
    .select('id, name, system_prompt, model, tokenrouter_key, tools, import_source, import_config')
    .eq('id', id)
    .single();

  if (agentErr || !agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }

  // ---------- T1 — external endpoint passthrough ----------
  // For external_endpoint agents, the endpoint IS the brain. We forward the
  // last user message and return its response verbatim as the assistant turn.
  // No TokenRouter inference; metering counts turns at $0 for now.
  if (agent.import_source === 'external_endpoint') {
    const config = agent.import_config as EndpointConfig | null;
    if (!config || config.kind !== 'endpoint') {
      return NextResponse.json({ error: 'invalid endpoint config' }, { status: 500 });
    }
    const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
    if (!lastUser) return NextResponse.json({ content: '', toolEvents: [], usage: { promptTokens: 0, completionTokens: 0, cost: 0 } });

    let secret: string | undefined;
    if (config.auth.kind === 'bearer' || config.auth.kind === 'header') {
      try {
        secret = await readSecret(config.auth.secretId);
      } catch (err: any) {
        return NextResponse.json({ error: `secret unreadable: ${err?.message || String(err)}` }, { status: 500 });
      }
    }

    const sessionId = `anyport_${id}_${nanoid(6)}`;
    const result = await endpointImporter.invoke(config, String(lastUser.content || ''), secret, { sessionId });
    if (result.ok === false) {
      return NextResponse.json({ error: `endpoint: ${result.error}` }, { status: 502 });
    }
    // Per-turn metering at $0 (Phase 2: per-call markup).
    await supabase.from('anyport_usage').insert({
      agent_id: id,
      prompt_tokens: 0,
      completion_tokens: 0,
      cost_usd: 0,
    });
    return NextResponse.json({
      content: result.text,
      toolEvents: [],
      usage: { promptTokens: 0, completionTokens: 0, cost: 0 },
    });
  }
  // --------------------------------------------------------

  const apiKey = agent.tokenrouter_key || ROOT_KEY;
  const model = agent.model || 'openai/gpt-4o-mini';
  const tools: AgentTool[] = Array.isArray(agent.tools) ? agent.tools : [];
  const sessionId = `anyport_${id}_${nanoid(6)}`;

  // ---------- T2 — MCP-backed agent ----------
  // For external_mcp / composio_mcp agents we expose the captured MCP tool
  // schemas to the LLM, then dispatch tool_calls back through the MCP client.
  const isMcpAgent = agent.import_source === 'external_mcp' || agent.import_source === 'composio_mcp';
  let mcpAuthHeader: { name: string; value: string } | undefined;
  if (isMcpAgent) {
    const mcpCfg = agent.import_config as McpConfig | ComposioMcpConfig | null;
    if (!mcpCfg) {
      return NextResponse.json({ error: 'invalid mcp config' }, { status: 500 });
    }
    if (mcpCfg.kind === 'mcp' && mcpCfg.auth.kind === 'bearer') {
      try {
        mcpAuthHeader = { name: 'Authorization', value: `Bearer ${await readSecret(mcpCfg.auth.secretId)}` };
      } catch (err: any) {
        return NextResponse.json({ error: `mcp secret unreadable: ${err?.message || String(err)}` }, { status: 500 });
      }
    }
  }

  const toolDefs = isMcpAgent
    ? mcpImporter.toOpenAITools(((agent.import_config as any)?.toolSchemas) || [])
    : buildToolDefs(tools, agent.name);

  const systemAddon = toolDefs.length
    ? '\n\n---\nIMPORTANT TOOL-USE RULES:\n' +
      "- When the user asks anything that needs the agent's live data, accounts, drafts, scheduling, or actions on connected services, CALL THE TOOL. Do not make things up.\n" +
      '- The tool returns the agent\'s authoritative response, often including formatted suggestion markers like `$**Option text**$` and markdown image previews like `![alt](url)`.\n' +
      '- When you receive a tool result, RETURN IT VERBATIM as your reply. Do NOT paraphrase, rewrite, or strip formatting. Preserve every `$**...**$` marker and every `![...](...)` image link exactly as the tool emitted them — the UI parses these for clickable cards and inline visuals.\n' +
      '- Only add your own text on top of the tool output if the user asked something the tool cannot answer.'
    : '';

  const convo: any[] = [
    { role: 'system', content: agent.system_prompt + systemAddon },
    ...messages,
  ];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const toolEvents: Array<{ name: string; input: string; output: string }> = [];

  for (let hop = 0; hop <= MAX_TOOL_HOPS; hop++) {
    const upstream = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: convo,
        ...(toolDefs.length ? { tools: toolDefs, tool_choice: 'auto' } : {}),
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json({ error: `tokenrouter ${upstream.status}: ${text}` }, { status: 502 });
    }

    const data = await upstream.json();
    const usage = data.usage || {};
    totalPromptTokens += usage.prompt_tokens || 0;
    totalCompletionTokens += usage.completion_tokens || 0;

    const msg = data.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls || [];

    if (!toolCalls.length || hop === MAX_TOOL_HOPS) {
      const price = PRICING[model] || { in: 0, out: 0 };
      const cost = totalPromptTokens * price.in + totalCompletionTokens * price.out;
      await supabase.from('anyport_usage').insert({
        agent_id: id,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        cost_usd: cost,
      });

      return NextResponse.json({
        content: msg?.content || '',
        toolEvents,
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          cost,
        },
      });
    }

    convo.push(msg);

    for (const call of toolCalls) {
      const toolName = call.function?.name;
      const argsRaw = call.function?.arguments || '{}';
      let args: any = {};
      try {
        args = JSON.parse(argsRaw);
      } catch {
        /* keep empty */
      }
      let result: string;

      if (isMcpAgent && toolName?.startsWith('mcp__')) {
        // T2 — dispatch back to the imported MCP server.
        const mcpCfg = agent.import_config as McpConfig | ComposioMcpConfig;
        const realName = toolName.slice('mcp__'.length);
        const mcpResult = await mcpImporter.callTool({
          url: mcpCfg.url,
          authHeader: mcpAuthHeader,
          toolName: realName,
          args,
        });
        result = mcpResult.ok === true ? mcpResult.content : `(mcp error: ${mcpResult.error})`;
        toolEvents.push({ name: toolName, input: JSON.stringify(args).slice(0, 200), output: result });
      } else {
        // Existing Squidgy-webhook path.
        const tool = tools.find((t) => t.name === toolName);
        if (tool && isSquidgyWebhook(tool.url)) {
          result = await callSquidgyWebhook(
            tool.url,
            agent.name,
            sessionId,
            String(args.user_mssg || ''),
          );
        } else {
          result = `(unknown tool: ${toolName})`;
        }
        toolEvents.push({ name: toolName, input: String(args.user_mssg || ''), output: result });
      }

      convo.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return NextResponse.json({ error: 'max tool hops exceeded' }, { status: 500 });
}
