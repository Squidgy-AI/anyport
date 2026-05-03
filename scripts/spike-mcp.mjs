// Spike runner — validates risks 1-4 from docs/SPIKE_T2_MCP.md against a real
// Composio MCP URL. Run from inside /Users/sethward/GIT/Hackathons/anyport:
//
//   node scripts/spike-mcp.mjs
//
// or with a different URL/tool:
//
//   COMPOSIO_MCP_URL='...' node scripts/spike-mcp.mjs
//
// NOTE: must be run from a real terminal (not Claude Code's Bash sub-shell).
// That sub-shell has IPv6 routing problems on Seth's mac that cause
// ETIMEDOUT to Cloudflare-fronted hosts after the first request — see
// workspace memory reference_supabase_credentials.md.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'fs';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const KEY = fs.readFileSync('/Users/sethward/GIT/Squidgy/.composio-api-key', 'utf8').trim();
// Default = Slack-scoped Composio MCP from workspace memory project_composio.md
const URL_ = process.env.COMPOSIO_MCP_URL ||
  'https://backend.composio.dev/v3/mcp/9111c45f-fc25-4afb-9206-4ae7247e7beb/mcp?include_composio_helper_actions=true&user_id=seth-probe';

const t = new StreamableHTTPClientTransport(new URL(URL_), {
  requestInit: { headers: { 'X-API-Key': KEY } },
});
const c = new Client({ name: 'spike', version: '0' }, { capabilities: {} });

try {
  console.log('→ connecting to', new URL(URL_).origin + new URL(URL_).pathname);
  await c.connect(t);
  console.log('✓ initialize');

  const list = await c.listTools();
  console.log('✓ list — tools:', list.tools.length);
  console.log('  first 12:', list.tools.slice(0, 12).map(x => x.name));

  if (list.tools.length) {
    const t0 = list.tools.find(x => x.name?.includes('SEND_MESSAGE')) || list.tools[0];
    console.log('\n--- schema sample (', t0.name, ') ---');
    console.log(JSON.stringify({
      name: t0.name,
      description: t0.description?.slice(0, 160),
      inputSchema: t0.inputSchema,
    }, null, 2));
  }

  await c.close();
  console.log('\n✓ spike steps 2-3 passed (introspect + schema). Use /agent/<id> in browser for steps 4-5.');
} catch (err) {
  console.error('✗ FAIL:', err.message);
  console.error('  cause:', err.cause?.message || err.cause?.code || err.cause);
  console.error('  hint: if ETIMEDOUT/EHOSTUNREACH, you are likely in Claude Code\'s Bash sub-shell.');
  console.error('        Run from your normal Terminal app instead.');
  process.exit(1);
}
