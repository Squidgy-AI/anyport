// Bypass the MCP SDK entirely — hand-roll the JSON-RPC 2.0 over Streamable
// HTTP that Composio actually exposes. If the SDK's GET-listener is what's
// timing out, this will get past that.

import fs from 'fs';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const KEY = fs.readFileSync('/Users/sethward/GIT/Squidgy/.composio-api-key', 'utf8').trim();
const URL_ = process.env.COMPOSIO_MCP_URL ||
  'https://backend.composio.dev/v3/mcp/9111c45f-fc25-4afb-9206-4ae7247e7beb/mcp?include_composio_helper_actions=true&user_id=seth-probe';

let mcpSessionId = null;
let nextId = 1;

async function rpc(method, params = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'X-API-Key': KEY,
  };
  if (mcpSessionId) headers['Mcp-Session-Id'] = mcpSessionId;

  const body = JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params });
  const ctrl = AbortSignal.timeout(20_000);
  const res = await fetch(URL_, { method: 'POST', headers, body, signal: ctrl });

  // Capture session id from initialize response
  const sid = res.headers.get('mcp-session-id');
  if (sid && !mcpSessionId) mcpSessionId = sid;

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${txt.slice(0, 300)}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    // Pull the data: {...} line from the SSE frame
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) {
        const json = JSON.parse(line.slice(5).trim());
        if (json.error) throw new Error(`rpc error: ${JSON.stringify(json.error)}`);
        return json.result;
      }
    }
    throw new Error('no data: line in SSE response');
  }

  const json = await res.json();
  if (json.error) throw new Error(`rpc error: ${JSON.stringify(json.error)}`);
  return json.result;
}

try {
  console.log('→', new URL(URL_).origin + new URL(URL_).pathname);

  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'spike-raw', version: '0' },
  });
  console.log('✓ initialize');
  console.log('  server:', init.serverInfo?.name, init.serverInfo?.version);
  console.log('  session:', mcpSessionId || '(none)');

  // Per spec we send 'notifications/initialized' but it's a notification (no id);
  // Composio appears to tolerate skipping it.

  const tools = await rpc('tools/list', {});
  console.log('✓ tools/list — count:', tools.tools.length);
  console.log('  names:', tools.tools.slice(0, 12).map(t => t.name));

  if (tools.tools.length) {
    const target = tools.tools.find(t => t.name?.includes('SEND_MESSAGE')) || tools.tools[0];
    console.log('\n--- schema (', target.name, ') ---');
    console.log(JSON.stringify({
      description: target.description?.slice(0, 200),
      inputSchema: target.inputSchema,
    }, null, 2));
  }
  console.log('\n✓ raw spike passed.');
} catch (err) {
  console.error('✗', err.message);
  console.error('  cause:', err.cause?.message || err.cause?.code || err.cause || '(none)');
  process.exit(1);
}
