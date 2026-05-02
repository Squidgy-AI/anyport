// POST /api/import/endpoint — T1 BYO Endpoint Adapter.
// Probes the user's endpoint, persists the import, returns install URL + verification token.
//
// Body shape (see lib/types.ts EndpointConfig):
// {
//   url, method?, auth: {kind, name?}, authSecret?, request: {messageField, ...},
//   response: {textPath?}, name, systemPrompt?, ownerEmail?
// }
import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';
import { endpoint as endpointImporter } from '@/lib/importers';
import { storeSecret } from '@/lib/secrets';
import type { EndpointConfig, ImportConfig } from '@/lib/types';

export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT =
  'You are a thin wrapper around an external chat endpoint. Forward the user message to the endpoint verbatim and return the endpoint\'s response.';

interface ImportEndpointBody {
  name?: string;
  systemPrompt?: string;
  url: string;
  method?: 'POST' | 'GET';
  auth?: EndpointConfig['auth'];
  authSecret?: string; // plaintext only on import; stored encrypted
  request?: Partial<EndpointConfig['request']>;
  response?: Partial<EndpointConfig['response']>;
  model?: string;
  ownerEmail?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ImportEndpointBody | null;
  if (!body || !body.url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  // 1. Probe before persisting. We refuse to import an endpoint that doesn't respond cleanly.
  const probe = await endpointImporter.probe({
    url: body.url,
    method: body.method,
    auth: body.auth,
    authSecret: body.authSecret,
    request: body.request,
    response: body.response,
  });

  if (!probe.ok) {
    return NextResponse.json({ error: `probe failed: ${probe.message}`, sample: probe.sample }, { status: 400 });
  }

  const agentId = nanoid(10);

  // 2. Store secret (if any) and rebuild auth descriptor with secretId reference.
  let auth: EndpointConfig['auth'] = body.auth || { kind: 'none' };
  if (body.authSecret && (auth.kind === 'bearer' || auth.kind === 'header')) {
    try {
      const secretId = await storeSecret(agentId, body.authSecret);
      auth = auth.kind === 'bearer' ? { kind: 'bearer', secretId } : { kind: 'header', name: auth.name, secretId };
    } catch (err: any) {
      return NextResponse.json({ error: `secret store failed: ${err?.message || String(err)}` }, { status: 500 });
    }
  }

  const config: EndpointConfig = {
    kind: 'endpoint',
    url: body.url,
    method: body.method || 'POST',
    auth,
    request: {
      messageField: body.request?.messageField || 'message',
      userField: body.request?.userField,
      sessionField: body.request?.sessionField,
      extra: body.request?.extra,
    },
    response: {
      textPath: probe.resolvedTextPath ?? body.response?.textPath ?? '',
    },
  };

  const verificationToken = nanoid(32);
  const name = (body.name || new URL(body.url).hostname).slice(0, 80);
  const systemPrompt = body.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const { error } = await supabase.from('anyport_agents').insert({
    id: agentId,
    name,
    system_prompt: systemPrompt,
    tools: [],
    model: body.model || 'openai/gpt-4o-mini',
    mcp_install_url: null,
    tokenrouter_key: process.env.TOKENROUTER_API_KEY!,
    import_source: 'external_endpoint',
    import_config: config as ImportConfig,
    verification_status: 'pending',
    verification_token: verificationToken,
    owner_email: body.ownerEmail || null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3040';
  return NextResponse.json({
    agentId,
    installUrl: `${appUrl}/agent/${agentId}`,
    verification: {
      token: verificationToken,
      method: 'well-known-file',
      instruction: `Serve text "${verificationToken}" at https://<your-endpoint-host>/.well-known/anyport-verify, then visit /api/verify/${agentId} (or wait — the agent page checks on each render).`,
    },
  });
}
