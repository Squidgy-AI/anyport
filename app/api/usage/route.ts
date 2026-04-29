import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const PRICING: Record<string, { in: number; out: number }> = {
  'openai/gpt-4o-mini': { in: 0.15 / 1_000_000, out: 0.6 / 1_000_000 },
  'openai/gpt-5-mini': { in: 0.25 / 1_000_000, out: 1.0 / 1_000_000 },
  'anthropic/claude-haiku-4.5': { in: 1.0 / 1_000_000, out: 5.0 / 1_000_000 },
  'anthropic/claude-sonnet-4.6': { in: 3.0 / 1_000_000, out: 15.0 / 1_000_000 },
};

export async function POST(req: Request) {
  const { agent_id, prompt_tokens, completion_tokens, model } = await req.json();

  if (!agent_id) {
    return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
  }

  const price = PRICING[model] || { in: 0, out: 0 };
  const cost = (prompt_tokens || 0) * price.in + (completion_tokens || 0) * price.out;

  const { error } = await supabase.from('anyport_usage').insert({
    agent_id,
    prompt_tokens: prompt_tokens || 0,
    completion_tokens: completion_tokens || 0,
    cost_usd: cost,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
