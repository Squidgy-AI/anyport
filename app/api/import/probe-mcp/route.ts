// POST /api/import/probe-mcp — Introspect-only. Does NOT persist anything.
import { NextResponse } from 'next/server';
import { mcp as mcpImporter } from '@/lib/importers';

export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await mcpImporter.introspect({
    url: body.url,
    authHeader: body.authHeader,
  });
  // Tag if we recognise a Composio URL — useful for the form UI hint.
  const composio = body.url ? mcpImporter.parseComposioUrl(body.url) : null;
  return NextResponse.json({ ...result, composio });
}
