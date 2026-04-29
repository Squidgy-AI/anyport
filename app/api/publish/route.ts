import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';
import { createSubKey } from '@/lib/tokenrouter';
import { deployMcpApp } from '@/lib/reboot';

export async function POST(req: Request) {
  const { name, systemPrompt, tools, model } = await req.json();

  if (!name || !systemPrompt) {
    return NextResponse.json({ error: 'name and systemPrompt required' }, { status: 400 });
  }

  const agentId = nanoid(10);
  const cleanTools = (tools || []).filter((t: any) => t.name && t.url);
  const useModel = model || 'claude-sonnet-4-6';

  const tokenRouterKey = await createSubKey(`anyport:${agentId}`, 5);

  const deployed = await deployMcpApp({
    agentId,
    name,
    systemPrompt,
    tools: cleanTools,
    tokenRouterKey,
    model: useModel,
  });

  const { error } = await supabase.from('anyport_agents').insert({
    id: agentId,
    name,
    system_prompt: systemPrompt,
    tools: cleanTools,
    model: useModel,
    mcp_install_url: deployed.installUrl,
    tokenrouter_key: tokenRouterKey,
    reboot_app_id: deployed.appId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    agentId,
    installUrl: deployed.installUrl,
  });
}
