/**
 * Native Anyport MCP server.
 *
 * Implements MCP Streamable HTTP directly in Next.js — no Reboot, no Docker,
 * no separate rbt process. Tools call the agent's Squidgy n8n webhook with
 * the verified flat-shape payload, then return text + EmbeddedResource(html)
 * with clickable suggestion cards and inline image upgrades.
 */
import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// REQUIRED — UUID of the Squidgy user whose connected accounts/tokens the
// agent should act on behalf of. No default; set in .env.local.
const DEMO_USER_ID = process.env.DEMO_USER_ID || '';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};

const CARD_RE = /\$\*\*(.+?)\*\*\$/g;
const MD_LINK_RE = /(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_IMG_URL_RE =
  /(?<![("'])(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg)(?:\?\S*)?)/gi;
const IMAGE_HOST_RE =
  /\.(amazonaws\.com|cloudfront\.net|googleusercontent\.com|imgur\.com|unsplash\.com|cloudinary\.com|pollinations\.ai|templated\.io)/i;
const EQ_CLEAR_RE = /=clear=/gi;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MD_BOLD_RE = /\*\*(.+?)\*\*/g;

function looksLikeImageUrl(url: string): boolean {
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) return true;
  return IMAGE_HOST_RE.test(url);
}

function upgradeImageLinks(text: string): string {
  text = text.replace(MD_LINK_RE, (m, label, url) =>
    looksLikeImageUrl(url) ? `![${label}](${url})` : m,
  );
  text = text.replace(BARE_IMG_URL_RE, (_m, url) => `![image](${url})`);
  return text;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToSafeHtml(text: string): string {
  let safe = escapeHtml(text);
  safe = safe.replace(MD_IMAGE_RE, (_m, alt, url) => {
    const cleanUrl = url.replace(/&amp;/g, '&');
    return `<img src="${cleanUrl}" alt="${alt}" loading="lazy" />`;
  });
  safe = safe.replace(MD_BOLD_RE, '<strong>$1</strong>');
  safe = safe.replace(/\n/g, '<br>');
  return safe;
}

function renderHtml(body: string, cards: string[], agentName: string): string {
  const bodyHtml = markdownToSafeHtml(body);
  const cardsHtml = cards.length
    ? `<div class="cards">${cards
        .map(
          (c) =>
            `<button class="card" data-msg="${escapeHtml(c)}">${escapeHtml(c)}</button>`,
        )
        .join('')}</div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0d0a1a;background:#f5f3fb}
.head{font-size:11px;color:#5a2eff;font-family:'JetBrains Mono',monospace;font-weight:600;letter-spacing:0.5px;margin-bottom:8px;text-transform:uppercase}
.body{padding:14px 16px;background:#fff;border:1px solid #e5e0f0;border-radius:16px;white-space:pre-wrap;box-shadow:0 8px 32px rgba(90,46,255,0.08)}
.body img{max-width:100%;border-radius:12px;margin:8px 0;display:block}
.cards{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.card{padding:8px 14px;background:#ede8ff;border:1px solid #d4ccef;color:#5a2eff;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.card:hover{background:#dcd2ff}
strong{color:#0d0a1a}
</style></head><body>
<div class="head">${escapeHtml(agentName)}</div>
<div class="body">${bodyHtml}</div>
${cardsHtml}
<script>
document.querySelectorAll('.card').forEach(b=>b.addEventListener('click',()=>{
  var msg=b.dataset.msg;
  try{window.parent.postMessage({type:'mcp-ui:invoke-tool',payload:{tool:'chat',args:{message:msg}}},'*');}catch(e){}
  try{window.parent.postMessage({type:'tool',tool:'chat',args:{message:msg}},'*');}catch(e){}
  b.disabled=true;b.style.opacity=0.5;
}));
</script></body></html>`;
}

function webhookSlug(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').split('/').pop() || '';
  } catch {
    return '';
  }
}

interface AgentRow {
  id: string;
  name: string;
  system_prompt: string;
  tools: Array<{ name: string; url: string }> | null;
  squidgy_id: string | null;
}

async function getAgent(id: string): Promise<AgentRow | null> {
  const { data } = await supabase
    .from('anyport_agents')
    .select('id, name, system_prompt, tools, squidgy_id')
    .eq('id', id)
    .single();
  return data as AgentRow | null;
}

function getWebhook(agent: AgentRow): { url: string; slug: string } | null {
  // Any https URL with a /webhook/ path is treated as an n8n-style webhook tool.
  const t = (agent.tools || []).find((x) => x?.url && /^https:\/\/[^/]+\/webhook\//.test(x.url));
  if (!t) return null;
  return { url: t.url, slug: webhookSlug(t.url) };
}

async function callWebhook(
  url: string,
  slug: string,
  sessionId: string,
  message: string,
  agentId: string,
): Promise<string> {
  const payload = {
    user_id: DEMO_USER_ID,
    user_mssg: message,
    session_id: sessionId,
    agent_name: slug,
    timestamp_of_call_made: new Date().toISOString(),
    request_id: nanoid(),
    sending_from: 'User',
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) return `(webhook ${resp.status})`;
  const text = await resp.text();
  const parts: string[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'item' && typeof obj.content === 'string') parts.push(obj.content);
    } catch {
      /* ignore */
    }
  }
  let out = parts.join('').trim();
  if (EQ_CLEAR_RE.test(out)) out = out.split(/=clear=/i).pop()!.trim();
  // Tick the dashboard.
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3040';
    await fetch(`${appUrl}/api/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        prompt_tokens: 0,
        completion_tokens: 0,
        model: 'squidgy/n8n',
      }),
    });
  } catch {
    /* ignore */
  }
  return out || '(no response)';
}

interface JsonRpcReq {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: any;
}

async function handle(rpc: JsonRpcReq, agent: AgentRow, sessionId: string): Promise<any | null> {
  const id = rpc.id;
  const wh = getWebhook(agent);

  if (rpc.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'anyport', version: '0.1' },
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
      },
    };
  }

  if (rpc.method === 'notifications/initialized' || rpc.method === 'notifications/cancelled') {
    return null;
  }

  if (rpc.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'chat',
            description: `Talk to ${agent.name}. Returns the agent's response with optional clickable suggestion cards and inline images.`,
            inputSchema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'Your message to the agent',
                },
              },
              required: ['message'],
            },
          },
        ],
      },
    };
  }

  if (rpc.method === 'tools/call') {
    const toolName = rpc.params?.name;
    const args = rpc.params?.arguments || {};
    if (toolName !== 'chat') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `unknown tool: ${toolName}` },
      };
    }
    const message = String(args.message || '');
    let raw: string;
    if (wh) {
      raw = await callWebhook(wh.url, wh.slug, sessionId, message, agent.id);
    } else {
      raw = `(no webhook configured for ${agent.name})`;
    }
    raw = upgradeImageLinks(raw);
    const cards: string[] = [];
    let m: RegExpExecArray | null;
    CARD_RE.lastIndex = 0;
    while ((m = CARD_RE.exec(raw)) !== null) cards.push(m[1].trim());
    const body = raw.replace(CARD_RE, '').replace(/\n{3,}/g, '\n\n').trim();
    const plain = body + (cards.length ? `\n\nOptions:\n${cards.map((c) => `• ${c}`).join('\n')}` : '');
    const html = renderHtml(body, cards, agent.name);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          { type: 'text', text: plain },
          {
            type: 'resource',
            resource: {
              uri: `ui://anyport/${agent.id}/${nanoid(8)}`,
              mimeType: 'text/html',
              text: html,
            },
          },
        ],
      },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `method not found: ${rpc.method}` },
  };
}

function sse(payload: any, idStr: string): string {
  return `id: ${idStr}\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  // GET is the SSE-listen endpoint; we don't push server-initiated events,
  // so just keep the connection open with a comment ping that closes quickly.
  return new Response(': ping\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS },
  });
}

export async function DELETE() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) {
    return new Response(JSON.stringify({ error: 'agent not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  let sessionId = req.headers.get('mcp-session-id') || '';
  if (!sessionId) sessionId = `anyport_${id}_${nanoid(8)}`;

  let rpc: JsonRpcReq;
  try {
    rpc = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'parse error' } }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      },
    );
  }

  const result = await handle(rpc, agent, sessionId);
  if (result === null) {
    // Notification — no response body, 202 Accepted.
    return new Response(null, {
      status: 202,
      headers: { 'mcp-session-id': sessionId, ...CORS_HEADERS },
    });
  }

  const idStr = `${rpc.id ?? 0}/1`;
  return new Response(sse(result, idStr), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'mcp-session-id': sessionId,
      ...CORS_HEADERS,
    },
  });
}
