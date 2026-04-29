import { NextResponse } from 'next/server';
import { listSquidgyAgents } from '@/lib/squidgy';

export async function GET() {
  const agents = await listSquidgyAgents();
  return NextResponse.json({
    count: agents.length,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      emoji: a.emoji,
      description: a.description,
      tagline: a.tagline,
      category: a.category,
      initialMessage: a.initialMessage,
      systemPrompt: a.systemPrompt,
      webhookUrl: a.webhookUrl,
      avatarUrl: a.avatarUrl,
    })),
  });
}
