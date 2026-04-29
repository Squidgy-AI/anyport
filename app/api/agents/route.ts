import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getUsage } from '@/lib/tokenrouter';

export async function GET() {
  const { data, error } = await supabase
    .from('anyport_agents')
    .select('id, name, mcp_install_url, tokenrouter_key, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const enriched = await Promise.all(
    (data || []).map(async (a) => {
      const usage = await getUsage(a.tokenrouter_key);
      return {
        id: a.id,
        name: a.name,
        installUrl: a.mcp_install_url,
        createdAt: a.created_at,
        tokens: usage.tokens,
        cost: usage.cost,
      };
    })
  );

  return NextResponse.json({ agents: enriched });
}
