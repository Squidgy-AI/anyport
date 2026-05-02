// GET /api/verify/[id] — claim/verify Method A (well-known file).
// Looks up the verification token for an imported agent, derives the host from
// the import_config.url, fetches https://<host>/.well-known/anyport-verify, and
// matches against the stored token. Updates verification_status if matched.

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: agent, error } = await supabase
    .from('anyport_agents')
    .select('id, import_source, import_config, verification_status, verification_token')
    .eq('id', id)
    .single();
  if (error || !agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 });

  if (agent.verification_status === 'verified') {
    return NextResponse.json({ ok: true, status: 'verified', alreadyVerified: true });
  }

  const config: any = agent.import_config || {};
  const targetUrl: string | undefined = config.url;
  if (!targetUrl || !agent.verification_token) {
    return NextResponse.json({ error: 'agent has no verifiable URL or token' }, { status: 400 });
  }

  let wellKnown: URL;
  try {
    const u = new URL(targetUrl);
    wellKnown = new URL('/.well-known/anyport-verify', u);
  } catch {
    return NextResponse.json({ error: 'invalid import url' }, { status: 400 });
  }

  let body = '';
  try {
    const resp = await fetch(wellKnown.toString(), { redirect: 'follow' });
    if (!resp.ok) {
      return NextResponse.json({
        ok: false,
        status: 'pending',
        message: `well-known fetch returned ${resp.status}`,
        wellKnownUrl: wellKnown.toString(),
      });
    }
    body = (await resp.text()).trim();
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      status: 'pending',
      message: `fetch error: ${err?.message || String(err)}`,
      wellKnownUrl: wellKnown.toString(),
    });
  }

  if (body !== agent.verification_token) {
    return NextResponse.json({
      ok: false,
      status: 'pending',
      message: 'token mismatch — file content does not equal expected token',
      wellKnownUrl: wellKnown.toString(),
    });
  }

  await supabase
    .from('anyport_agents')
    .update({ verification_status: 'verified' })
    .eq('id', id);

  return NextResponse.json({ ok: true, status: 'verified' });
}
