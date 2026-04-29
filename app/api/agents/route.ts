import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data: agents, error } = await supabase
    .from('anyport_agents')
    .select('id, name, model, mcp_install_url, created_at, avatar_url, squidgy_id')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: usage } = await supabase
    .from('anyport_usage')
    .select('agent_id, prompt_tokens, completion_tokens, cost_usd, created_at');

  const totals = new Map<string, { tokens: number; cost: number; requests: number; lastUsedAt: string | null }>();
  for (const row of usage || []) {
    const t = totals.get(row.agent_id) || { tokens: 0, cost: 0, requests: 0, lastUsedAt: null };
    t.tokens += (row.prompt_tokens || 0) + (row.completion_tokens || 0);
    t.cost += Number(row.cost_usd || 0);
    t.requests += 1;
    if (!t.lastUsedAt || row.created_at > t.lastUsedAt) t.lastUsedAt = row.created_at;
    totals.set(row.agent_id, t);
  }

  const enriched = (agents || []).map((a) => {
    const t = totals.get(a.id) || { tokens: 0, cost: 0, requests: 0, lastUsedAt: null };
    return {
      id: a.id,
      name: a.name,
      model: a.model,
      installUrl: a.mcp_install_url,
      createdAt: a.created_at,
      avatarUrl: a.avatar_url,
      squidgyId: a.squidgy_id,
      tokens: t.tokens,
      cost: t.cost,
      requests: t.requests,
      lastUsedAt: t.lastUsedAt,
    };
  });

  return NextResponse.json({ agents: enriched });
}
