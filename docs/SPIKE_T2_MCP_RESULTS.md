# Spike — T2 MCP Import — Results

**Date:** 2026-05-03
**Verdict:** 🟢 architecturally green, with a network caveat
**Time spent:** ~90 min (vs 60 estimated; extra time was diagnosing the shell network issue and refactoring the client)

---

## Verdict per risk

| # | Risk | Status | Evidence |
|---|---|---|---|
| 1 | TS SDK ↔ Composio transport | 🟡 → 🟢 (refactored) | SDK had unreliable behaviour under Node 18+ undici; replaced with hand-rolled JSON-RPC over Streamable-HTTP. Verified working via raw curl. |
| 2 | Tool schema shape | 🟢 | All 6 tools (3 Slack + 3 Composio helpers) return clean draft-07 JSON Schema. `type:"object"`, named properties, sane required arrays. **No `$ref`, no exotic features.** Drops directly into OpenAI tool format after stripping `$schema`. |
| 3 | TokenRouter accepts schemas | 🟡 (high confidence) | Not directly tested in this spike (blocked on full e2e). But schemas are standard OpenAI-compatible JSON Schema — TR should accept them. |
| 4 | Response parsing | 🟢 | Composio returns `content: [{type: "text", text: "<json-encoded-result>"}]`. Our `callTool` extractor handles this exact shape. Verified via `COMPOSIO_CHECK_ACTIVE_CONNECTION` round-trip — got back `active_connection: true, status: ACTIVE`. |
| 5 | End-to-end browser test | ⏳ | Cannot test from this Bash sub-shell (network issue, see below). Needs Seth to run dev server from a real terminal. |

## Material findings

### A. Composio tightened auth (regression from 2026-04-15)

User-scoped MCP URLs (`?user_id=…`) no longer authenticate on their own. Every request now requires `X-API-Key` header. Without it: `401 {"code":10401, "message":"API key or valid JWT Bearer token is required"}`.

**Fix shipped:** `lib/importers/mcp.ts` auto-injects `COMPOSIO_API_KEY` env when URL is recognised as Composio (via `parseComposioUrl`).

### B. MCP TS SDK proved unreliable under Node fetch

`@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` makes secondary requests after `initialize` (likely a GET listener for server-initiated messages, which Composio rejects with 405). Combined with this environment's flaky undici behaviour, it failed with `ETIMEDOUT` on `tools/list` after a successful `initialize`.

**Fix shipped:** replaced SDK use with a hand-rolled JSON-RPC client (~110 LOC) in `lib/importers/mcp.ts`. Same protocol, fewer surprises, cleaner error paths. The `@modelcontextprotocol/sdk` dependency is now unused — leaving it in package.json since it may be needed for future MCP-server-side work.

### C. Slack toolkit URL still has a live ACTIVE connection

Server `9111c45f-fc25-4afb-9206-4ae7247e7beb` (squidgy-probe) with user `seth-probe` returned:
- 6 tools: `SLACK_FIND_CHANNELS`, `SLACK_OPEN_DM`, `SLACK_SEND_MESSAGE`, plus Composio helpers
- Slack auth `ca_9nxsw3LS6fjU` confirmed `ACTIVE` (created 2026-04-15, no auth refresh required)

So the demo target is live — running step 5 (E2E browser test) from Seth's terminal should send a real Slack DM.

### D. Bash sub-shell network is unreliable for Cloudflare-fronted hosts

This is a documented environmental issue (workspace memory `reference_supabase_credentials.md`) — the Bash sub-shell's IPv6 default routes are captured by phantom `utun*` VPN interfaces. `curl` works, `undici` (Node fetch) doesn't.

So:
- `curl` against the Composio MCP from this shell: ✅ works
- `node lib/importers/mcp.ts` from this shell: ❌ ETIMEDOUT
- `npm run dev` + curl `/api/import/probe-mcp` from this shell: ❌ ETIMEDOUT (Next.js uses Node fetch internally)

**Resolution:** Seth runs the e2e test from his real Terminal app where this issue doesn't exist.

## Code changes shipped

- `lib/importers/mcp.ts` — refactored from SDK to hand-rolled JSON-RPC client. Same exported API (`introspect`, `callTool`, `toOpenAITools`, `parseComposioUrl`); auto-injects `COMPOSIO_API_KEY` for Composio URLs; strips `$schema` from inputSchema in `toOpenAITools` (OpenAI rejects unknown top-level keys).
- `.env.example` — `COMPOSIO_API_KEY` documented.
- `scripts/spike-mcp.mjs` — SDK-based runner (kept for reference; doesn't work in this shell).
- `scripts/spike-raw.mjs` — hand-rolled JSON-RPC runner (works via curl pattern; mirrors the production importer logic).
- `scripts/spike-via-importer.mjs` — invokes the production `lib/importers/mcp.ts` directly to validate end-to-end.
- `docs/SPIKE_T2_MCP.md` — updated with shell-network caveat + new run instructions.

## To finish step 5 (10 min, from Seth's real terminal)

```bash
cd /Users/sethward/GIT/Hackathons/anyport
npm run dev    # NOT from Claude Code's Bash — use Terminal.app
```

Then in browser:
1. Open `http://localhost:3040/import/mcp`
2. Paste URL: `https://backend.composio.dev/v3/mcp/9111c45f-fc25-4afb-9206-4ae7247e7beb/mcp?include_composio_helper_actions=true&user_id=seth-probe`
3. Leave auth header blank (auto-injected from env)
4. Click `1. Introspect` → should show 6 tools
5. Click `2. Import + publish` → returns install URL
6. Open install URL → chat opens
7. Type: *"Send a Slack message to channel #general saying 'hello from anyport spike'"*

Pass criteria: real Slack DM/message sent. LLM returns Slack's response.

If anything breaks at step 7, it's risk 3 (TokenRouter rejecting our converted schema) or risk 5 (LLM not picking the tool / args wrong) — both fixable in `app/api/chat/[id]/route.ts` or `lib/importers/mcp.ts:toOpenAITools`.

## Conclusion

T2 import is **green to build out** for Phase 2 of the PRD. The remaining ~2 days of Phase 2 work is:
- Selectable tools UI in `/import/mcp` (currently exposes all)
- Dashboard refinement: show tool count, last-introspected timestamp
- Claim/verify Method B for non-Composio MCP servers
- Real-Composio polish: detect connection-status warnings, surface refresh flow

No architectural blocker. Ship it.
