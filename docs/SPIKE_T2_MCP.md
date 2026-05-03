# Spike — T2 MCP Import (1 hour)

**Goal:** validate the *narrow risks* in our T2 code path. Slack-via-Composio is already proven (workspace memory, 2026-04-15). The unknown is whether *our specific implementation* (`@modelcontextprotocol/sdk` TS client → `lib/importers/mcp.ts` → TokenRouter tool-calling) works end-to-end.

If green, the T2 build (`PRD_INBOUND_IMPORT.md` Phase 2) is plumbing. Two days max.

---

## What's actually unknown

We already know:
- Composio MCP URL pattern (`/v3/mcp/<id>/mcp?user_id=<uid>`)
- Composio + Slack DM works end-to-end (proven 2026-04-15)

We don't know:

1. Does `@modelcontextprotocol/sdk` (TS) connect cleanly via `StreamableHTTPClientTransport` to a Composio URL?
2. Does `lib/importers/mcp.ts` `introspect()` return tool schemas in the shape we expect?
3. Do those schemas pass through `toOpenAITools()` in a form TokenRouter accepts?
4. Does `callTool()` parse Composio's response shape correctly (text content extraction)?
5. Does the `/api/chat/[id]` loop (LLM decides → MCP-prefixed tool name → dispatch via `callTool` → result back → LLM continues) integrate cleanly?

Each is a 5–30 min check. None require building anything new.

---

## 60-minute checklist

### 1 · Composio Slack URL ready (0 min, prereq)
Confirm you have the Composio MCP URL with Slack already wired (per memory, this exists). Form: `https://mcp.composio.dev/v3/mcp/<server_id>/mcp?user_id=<uid>`.

### 2 · Introspect (5 min) — risk 1 + 2
```bash
cd /Users/sethward/GIT/Hackathons/anyport
npm run dev   # starts on :3040
curl -sS -X POST http://localhost:3040/api/import/probe-mcp \
  -H 'Content-Type: application/json' \
  -d '{"url":"<composio_slack_mcp_url>"}' | jq
```
**Pass:** `ok:true` and a non-empty `tools[]` with at least one Slack tool (e.g. `SLACK_SEND_MESSAGE` or similar).
**Fail to investigate:** transport error → SDK not compatible with Composio's HTTP server. Empty tools → URL or user_id wrong.

### 3 · Inspect schema (5 min) — risk 2
From the probe response, eyeball the `inputSchema` of one tool. Look for:
- Is it `{type: "object", properties: {...}}`? ✅
- Any `$ref`, `oneOf`, or non-standard JSON Schema features? ⚠️ — those may not pass OpenAI's tool validator
- Required fields present and named clearly? ✅

If schema looks weird, jot it down — `toOpenAITools()` may need a normalisation pass.

### 4 · Import + browse (10 min) — risk 1, 2, 3
```bash
curl -sS -X POST http://localhost:3040/api/import/mcp \
  -H 'Content-Type: application/json' \
  -d '{"url":"<composio_slack_mcp_url>","name":"Slack via Composio"}' | jq
```
**Pass:** returns `agentId` + `installUrl` + `exposedTools[]`. Open `installUrl` in browser; the chat page should load showing the agent.

### 5 · Direct tool call without LLM (10 min) — risk 4
Test that our MCP `callTool` parses Composio's response correctly. Skip the LLM, hit MCP directly via a one-liner script:
```bash
cat > /tmp/spike-call.mjs <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const url = process.argv[2], tool = process.argv[3];
const args = JSON.parse(process.argv[4] || '{}');
const t = new StreamableHTTPClientTransport(new URL(url));
const c = new Client({ name: 'spike', version: '0' }, { capabilities: {} });
await c.connect(t);
console.log(JSON.stringify(await c.callTool({ name: tool, arguments: args }), null, 2));
await c.close();
EOF
cd /Users/sethward/GIT/Hackathons/anyport
node /tmp/spike-call.mjs "<url>" "SLACK_SEND_MESSAGE" '{"channel":"<your_dm>","text":"spike test"}'
```
**Pass:** message arrives in Slack, `content[0].text` (or similar) is a sensible string.
**Fail:** look at the raw response — adjust `lib/importers/mcp.ts` `callTool` extraction.

### 6 · End-to-end via the chat UI (30 min) — risk 5
Open `http://localhost:3040/agent/<agentId>` (the install URL from step 4).

Type: *"Send a Slack DM to <user>: 'hi from anyport spike'"*

**Pass:** message arrives in Slack; chat shows the LLM's reply confirming.
**Fail modes to watch:**
- LLM never picks the tool → tool description too vague; tweak in `toOpenAITools()`
- TR returns 4xx → schema rejected; sanitize `parameters`
- `(unknown tool: ...)` → tool name didn't get `mcp__` prefix or `isMcpAgent` check failed
- Tool dispatched but result is `(empty result)` → response extraction bug in step 5
- Loop hits `MAX_TOOL_HOPS` → tool call shape mismatch causing model to re-call

---

## Output

After 60 minutes you should know:

| Risk | Status |
|---|---|
| 1 — TS SDK + Composio transport | green / red |
| 2 — Tool schema shape | green / yellow (needs sanitiser) / red |
| 3 — TR accepts schemas | green / red |
| 4 — Response parsing | green / red |
| 5 — End-to-end loop | green / red |

If all green: **T2 build is plumbing.** Phase 2 of the PRD takes ~2 days, mostly polish (selectable tools, dashboard pills already done, claim/verify Method B).

If anything red: write 2 sentences about which line of code needs fixing in `lib/importers/mcp.ts` or `app/api/chat/[id]/route.ts`. Fix, retest, move on.

---

## What this spike does NOT do

- Test non-Composio MCP servers (a separate exercise)
- Test multiple tools in one server (one tool proves the loop)
- Test claim/verify flow (Phase 2)
- Test schema sanitisation for exotic JSON Schema features (only relevant if step 3 fails)
- Touch the Anyport homepage / dashboard / forms (those are already wired in via the Phase 1 work)
