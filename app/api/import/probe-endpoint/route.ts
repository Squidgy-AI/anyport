// POST /api/import/probe-endpoint — Probe-only. Does NOT persist anything.
// The import form calls this to validate user input before the actual import.
import { NextResponse } from 'next/server';
import { endpoint as endpointImporter } from '@/lib/importers';

export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await endpointImporter.probe(body);
  return NextResponse.json(result);
}
