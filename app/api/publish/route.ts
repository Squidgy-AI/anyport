import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';

export const maxDuration = 30;

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
  const publicUrl = process.env.ANYPORT_PUBLIC_URL || appUrl;
  const installUrl = `${publicUrl}/api/mcp/${agentId}`;

  const { error } = await supabase.from('anyport_agents').insert({
    id: agentId,
    name,
    system_prompt: systemPrompt,
    tools: cleanTools,
    model: useModel,
    mcp_install_url: installUrl,
    tokenrouter_key: tokenRouterKey,
    reboot_app_id: `native-${agentId}`,
    avatar_url: avatarUrl || null,
    squidgy_id: squidgyAgentId || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agentId, installUrl });
}
