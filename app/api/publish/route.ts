import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';
import { spawnAgent } from '@/lib/spawner';

export const maxDuration = 120;

/**
 * Publish flow:
 *   1. Spawn a fresh Reboot DurableMCP via `rbt dev run`, parameterised with
 *      the agent's system prompt, model, and (for Squidgy agents) webhook URL.
 *   2. Spawn a cloudflared quick tunnel pointing at the rbt server's port.
 *   3. The tunnel URL is the MCP install URL — Claude clients talk to Reboot's
 *      Envoy directly. No Next.js proxy in the request path.
 */
export async function POST(req: Request) {
  const { name, systemPrompt, tools, model, squidgyAgentId, avatarUrl } = await req.json();

  if (!name || !systemPrompt) {
    return NextResponse.json({ error: 'name and systemPrompt required' }, { status: 400 });
  }

  const agentId = nanoid(10);
  const cleanTools = (tools || []).filter((t: any) => t.name && t.url);
  const useModel = model || 'openai/gpt-4o-mini';
  const tokenRouterKey = process.env.TOKENROUTER_API_KEY!;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3040';
  const usageCallbackUrl = `${appUrl}/api/usage`;
  const webhookUrl = cleanTools[0]?.url && /^https:\/\/[^/]+\/webhook\//.test(cleanTools[0].url)
    ? cleanTools[0].url
    : null;

  let spawned: Awaited<ReturnType<typeof spawnAgent>>;
  try {
    spawned = await spawnAgent({
      agentId,
      agentName: squidgyAgentId || name,
      systemPrompt,
      model: useModel,
      tokenRouterApiKey: tokenRouterKey,
      anyportUsageUrl: usageCallbackUrl,
      webhookUrl,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `mcp spawn failed: ${err?.message || String(err)}` },
      { status: 500 },
    );
  }

  const installUrl = `${spawned.tunnelUrl}/mcp`;

  const { error } = await supabase.from('anyport_agents').insert({
    id: agentId,
    name,
    system_prompt: systemPrompt,
    tools: cleanTools,
    model: useModel,
    mcp_install_url: installUrl,
    tokenrouter_key: tokenRouterKey,
    reboot_app_id: `local-${agentId}`,
    port: spawned.port,
    rbt_pid: spawned.rbtPid,
    tunnel_pid: spawned.tunnelPid,
    avatar_url: avatarUrl || null,
    squidgy_id: squidgyAgentId || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agentId, installUrl });
}
