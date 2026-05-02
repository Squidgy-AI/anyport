# PRD — Anyport Inbound Import (T1 + T2)

**Status:** Draft
**Owner:** Seth
**Date:** 2026-05-01
**Repo:** `Squidgy-AI/anyport` · sibling to Squidgy workspace
**Reference state:** `~/.claude/projects/-Users-sethward-GIT-Squidgy/memory/project_anyport.md`

---

## TL;DR

Anyport today is **outbound-only**: Squidgy YAML on disk → hosted chat URL with TokenRouter metering and N8N tool passthrough. We're adding **inbound** paths so technical founders/devs with existing AI apps can land on Squidgy without rebuilding on the agent builder.

Two inbound modes:

- **T1 — BYO Endpoint Adapter:** "I have an HTTP endpoint that takes chat input and returns a response. Wrap it." Lowest friction, broadest fit.
- **T2 — MCP / A2A Import:** "I have an MCP server (or Composio install URL, or A2A card) — pull its tools and let me run them as a Squidgy agent." Higher-value, hits the technical/protocol-savvy founder.

Same primitives as today: `anyport_agents` row, TokenRouter sub-key, hosted chat surface, App Store listability. **Do not fork metering or auth.**

---

## Goals

1. Onboard technical founders/devs with working AI apps in **<10 minutes** (T1) or **<5 minutes** (T2 paste-the-URL flow).
2. Imported agents are **first-class** in Anyport: hosted URL, token metering, dashboard, App Store eligibility.
3. The integration **adds optionality**, not complexity — existing Squidgy YAML import path is unchanged.
4. Build the **claim/verify** primitive so imports are publicly listable without trust assumptions.

## Non-goals

- Replicating the Squidgy agent builder for imported agents (no system-prompt tuning, no N8N workflow generation — they keep their backend, we bridge).
- Building an MCP runtime — we **consume** MCP, not host it. (Reboot's runtime is for outbound MCP-app delivery, not inbound MCP-tool consumption.)
- A2A and OpenAI Agent SDK *full* support — design for it, ship later.
- Multi-tenant sub-key vending (Phase 1: imported agents share platform's TR root key with per-agent metering tag; Phase 2: per-builder Stripe Connect → per-builder TR sub-keys).

---

## Concepts

### Import source

A new field on `anyport_agents` distinguishing how the agent got here:

| `import_source` | Description | Status |
|---|---|---|
| `squidgy_yaml` | Imported from `squidgy_updated_ui/agents/*` (existing path) | shipped |
| `external_endpoint` | T1 — wrapped HTTP endpoint | new |
| `external_mcp` | T2 — wrapped MCP server | new |
| `composio_mcp` | T2 — Composio install URL (special-case of MCP) | new |
| `a2a` | A2A protocol agent card | designed, not built |
| `openai_sdk` | OpenAI Agent SDK config | designed, not built |

### Import config

A `jsonb` blob storing whatever we need to call the imported thing back: original URL, auth header name + secret reference, schema, model preferences, tool list. **Secrets stored by reference**, never inline (see Secrets section).

### Verification status

`pending` | `verified` | `unverified`. Public listing in App Store requires `verified`.

---

## Schema migration

Add to `anyport_agents`:

```sql
alter table anyport_agents
  add column if not exists import_source text default 'squidgy_yaml',
  add column if not exists import_config jsonb default '{}'::jsonb,
  add column if not exists verification_status text default 'pending',
  add column if not exists verification_token text,
  add column if not exists owner_email text,
  add column if not exists owner_user_id uuid;

create index if not exists anyport_agents_import_source_idx on anyport_agents(import_source);
create index if not exists anyport_agents_owner_idx on anyport_agents(owner_user_id);
```

`import_source` defaults to `squidgy_yaml` so existing rows are correctly classified.

`verification_token` is a server-generated nonce we expose via the verify flow (see below). `owner_email` and `owner_user_id` track the human who imported it (for revenue attribution + claim flow).

Apply via `nova_exec_sql` (see workspace `reference_supabase_credentials.md`).

---

## T1 — BYO Endpoint Adapter

### User flow

1. User visits `/import/endpoint`
2. Pastes:
   - **Endpoint URL** (required, https only)
   - **Auth method**: `none` | `bearer` | `header` (custom name)
   - **Auth secret**: stored in our secrets store, referenced by ID in `import_config`
   - **Request shape**: `{message_field, optional_user_field, optional_session_field}` — defaults to `{message: <text>}`
   - **Response shape**: `{text_path}` — JSON path to the assistant text in the response body. Defaults to `response` or `message` or `output` (probed).
   - **Display info**: name, emoji, optional avatar URL, one-line description
3. **Probe**: server fires a test call with a synthetic chat input ("ping"). Validates 2xx + parses response. Shows the parsed text back to the user. **Don't proceed unless probe passes.**
4. **Verify**: claim flow (see below) — required before public listing.
5. **Publish**: mint TokenRouter sub-key, insert `anyport_agents` row, return install/share URL.

### Runtime

The hosted chat at `/agent/[id]` checks `import_source`:

- For `external_endpoint`: instead of TokenRouter → assistant LLM, the chat page (server-side) makes one request per turn:
  ```
  POST <import_config.url>
  Headers: <auth>
  Body: { [message_field]: userMessage, ...(optional fields) }
  ```
- Parse response per `response.text_path`, render as assistant message in the chat UI.
- TokenRouter is **still in the loop for metering** (tracking) but we don't call it for inference. We log usage to `anyport_usage` directly with `cost_usd = 0` for now (Phase 2: charge per-call markup, e.g. $0.001/req).

### Why this works

- The user's existing endpoint stays the brain. We're a thin proxy with billing, hosting, and (eventually) Squidgy distribution.
- No re-auth: their endpoint already has whatever auth they need to their own backend.
- TokenRouter still gives us the per-agent quota knob (e.g., free trial: 5 turns then paywall) by counting turns, not tokens.

### Open questions

- **Streaming?** First version: non-streaming only. The endpoint either returns full text or we fail. Streaming is Phase 2.
- **Tool calls inside their endpoint?** Their problem. We forward chat input, render chat output. If their endpoint internally calls tools, fine.
- **Rate limits / failures?** Surface to user with a "this endpoint returned 502" UI message. Don't retry blindly.

---

## T2 — MCP / A2A Import

### User flow (MVP — MCP only)

1. User visits `/import/mcp`
2. Pastes:
   - **MCP server URL** (e.g. `https://mcp.composio.dev/v3/mcp/<id>/mcp?user_id=<uid>` or any MCP HTTP server URL)
   - **Auth method** (Composio MCP servers use the URL's `user_id` query param; non-Composio MCP often uses bearer)
   - **Display info**
3. **Introspect**: server connects to the MCP URL via the `mcp` Python lib (we already have it in `mcp/`), lists tools, reads manifest, captures schemas.
4. **Pick exposed tools**: user selects which of the imported tools to expose to the chat agent. Default: all.
5. **Choose model**: TokenRouter routing — pick which LLM drives the chat (default: `openai/gpt-4o-mini`).
6. **Probe**: spin up a temporary chat with one of the imported tools, call it with a known-safe input.
7. **Verify**: claim flow.
8. **Publish**: mint TR sub-key, insert row, return install URL.

### Runtime

Hosted chat at `/agent/[id]` for `external_mcp`:

- TokenRouter call with `tools` set to the imported MCP tool schemas
- LLM returns `tool_calls`
- Anyport server **proxies the tool call to the original MCP server** using the stored `import_config.url + auth`
- Append result to messages, loop
- Same shape as the existing N8N tool-call loop, just pointed at a different backend

This is **the same code path** as T1's tool-calling but with MCP as the tool backend instead of N8N webhook. We can refactor the existing chat-loop to be backend-agnostic.

### Composio special case

Composio MCP URLs are user-scoped: `/v3/mcp/<server_id>/mcp?user_id=<uid>`. Per workspace memory, this is already known shape. For Composio imports:

- Extract `user_id` from the URL → store in `import_config.composio_user_id`
- We **don't store the Composio API key** — the URL itself is the credential. (Phase 2: support OAuth handoff to Composio for the importing user.)

### Why this works

- Reuses the existing tool-calling loop architecture
- MCP introspection is a solved problem (`mcp` Python lib has a client)
- Composio is the **highest-leverage early target** because Composio servers come pre-loaded with auth'd integrations (Slack, GitHub, Notion, etc.). Day-1 demo: import a Composio MCP for Slack, ship a Slack-bot agent in 5 minutes.

### A2A and OpenAI Agent SDK (designed, not built)

- **A2A protocol**: an "agent card" JSON manifest. Same import flow as T2 but with A2A's specific schema. Add `import_source = 'a2a'`. Wrapper code in `lib/importers/a2a.ts` (stub for now).
- **OpenAI Agent SDK config**: a JSON config that defines an agent + its tools. Convert to our internal shape on import.

Reserve fields in `import_config`. Don't write parsers yet.

---

## Claim / verify flow

Public marketplace listing requires proof the importer owns or controls the resource. Two methods, user picks:

### Method A — well-known file (preferred for endpoints)

1. We generate `verification_token = nanoid(32)`, store on row
2. User must serve `<endpoint-domain>/.well-known/anyport-verify` returning that token
3. We GET the URL; if response body matches the token, mark `verification_status = 'verified'`
4. 7-day token TTL; auto-recheck on each render of the agent page (cached 1h)

### Method B — signed callback (for MCP servers)

1. We generate a verification challenge nonce
2. User configures their MCP server to expose a `verify` tool (or we add a tool injection if they're using Composio)
3. We invoke the `verify` tool via MCP, expect the nonce back
4. Match → verified

### Method C — email confirmation (fallback)

For private-only listings: confirm via email link. Faster but `unverified` status — they can use the URL but it's not listable in App Store.

### Why this matters

- App Store can't list random URLs — needs proof of ownership for trust
- Verify flow is the prerequisite for revenue payouts (we need to know who owns the agent for Stripe)
- Even private listings benefit (no impersonation: if user X imports Sophia's GHL endpoint, we want them to prove ownership before billing flows in their direction)

---

## Dashboard

Imported agents show alongside published ones, with the existing usage/cost columns from `anyport_usage`. Add:

- **Source pill**: `Squidgy YAML` | `Endpoint` | `MCP` | `Composio` (color-coded)
- **Verification badge**: ✓ verified / ⏱ pending / ⚠ unverified
- **"Re-probe" button** for endpoint imports — refire the probe call to confirm the endpoint is still alive
- **"View import config" detail panel** — read-only, show the URL/auth scheme without exposing secrets

---

## App Store handoff

Imported agents land in `squidgy_app_store` the same way published ones will:

- Listing card pulls: name, emoji, description, source pill, verification badge, total usage, owner profile
- "Try free" button → opens hosted chat with TokenRouter quota (e.g., 5 free turns)
- "Subscribe" button → Stripe Connect (Phase 2 — gated)
- Builder profile pages aggregate all their imports + published

App Store doesn't care about source — to it, every listing is just an `anyport_agents` row with a known URL.

---

## Secrets storage

Whatever auth secrets the user provides (bearer tokens, API keys, MCP URLs with embedded credentials) get stored:

- **Phase 1**: encrypted at rest in Supabase using a service-side encryption key (not Postgres TDE — explicit envelope encryption with a key from `process.env.ANYPORT_SECRET_KEY`). New table:
  ```sql
  create table anyport_secrets (
    id text primary key,
    agent_id text references anyport_agents(id) on delete cascade,
    encrypted_value bytea not null,
    created_at timestamptz default now()
  );
  ```
  Reference from `import_config` as `{ "auth_secret_id": "<id>" }`. Decrypt server-side only.
- **Phase 2**: move to Supabase Vault or external KMS.

Never log decrypted secrets. Never include them in error messages or audit trails.

---

## Constraints (re-stated from brief)

1. **Don't fork metering** — TokenRouter sub-keys stay the single billing primitive. Imported agents may use a shared root key + per-agent tag for now (Phase 2: per-builder sub-keys via Stripe Connect).
2. **Don't rebuild auth** — N8N user_id passthrough stays the tool-portability mechanism for `squidgy_yaml` agents. T1/T2 introduce *new* auth paths (the user's own endpoint or MCP server's auth), but they're **additive**, not replacements.
3. **Anyport stays at `/Users/sethward/GIT/Hackathons/anyport/`** — sibling repo, not inside the workspace.
4. **Existing publish flow stays untouched** — `/api/publish` and the Squidgy YAML import path keep working. New routes are siblings.

---

## Reboot.dev applicability

**Question:** does any of the Reboot.dev MCP runtime work apply to *consuming* MCP rather than exposing it?

**Answer: minimal, and worth being honest about.**

Reboot.dev's value proposition is the **outbound** path:
1. Stateful agent runtime (we have N8N + Supabase, redundant)
2. Multi-surface deploy (we'd use this to ship to Claude as MCP app)
3. Reactive UI primitives → MCP UI (this is the unique value — rich UI inside Claude)

For **inbound MCP consumption** (T2), we don't need Reboot:
- The `mcp` Python client lib (already in `mcp/`) handles introspection and tool invocation
- The tool-calling loop in our chat page is plain TypeScript

What might apply:
- **Reboot's MCP server schema** has a clean way to describe tools — we should mirror their tool descriptor shape in our `import_config.tools` so future bidirectional flows (consume → expose) are clean
- If we ever want to **re-expose** an imported MCP as a *new* MCP for end users in Claude, that's where Reboot's runtime earns its keep — they handle the stateful re-publish

**Recommendation:** keep T2 implementation independent of Reboot. Reboot remains the path for our own outbound MCP packaging (the existing `mcp/` server + `lib/spawner.ts` flow).

---

## Risks

| Risk | Mitigation |
|---|---|
| Imported endpoints go down → bad listings in App Store | Periodic health-check job; auto-flag `verification_status = 'stale'` after 3 consecutive fails |
| MCP servers vary wildly in tool schema quality | Mandatory probe step; surface schema warnings to importer; reject manifestly broken servers |
| Composio user_id leakage in URLs | Don't echo the URL in any UI surface visible to non-owners; store it only in encrypted `import_config` |
| Spam/abuse — random URLs imported as agents | Rate-limit imports per IP/account; require email verification before any import |
| Cost runaway — imported endpoints could be expensive per call | Per-agent TR quota still applies (turns or budget cap); paywalls supported via `anyport_usage` aggregation |

---

## Out of scope (now)

- Streaming responses for T1 endpoints
- Auto-generating system prompts for imported MCPs (LLM-powered "describe this server" → system prompt)
- Real-time collaboration on imported agent configs
- Versioning of import configs (Phase 2)
- Multi-region deployment of imported agents

---

## Phased rollout

### Phase 0 — schema + scaffolding (this week)
- Migration above applied to DEV
- `lib/importers/index.ts` with stubs for each source
- Type definitions in `lib/types.ts`

### Phase 1 — T1 BYO Endpoint (~3 days)
- `/import/endpoint` form
- `/api/import/endpoint` POST handler with probe
- Runtime path in `/agent/[id]/page.tsx` for `external_endpoint`
- Claim/verify Method A (well-known file)

### Phase 2 — T2 MCP Import (~3 days, follows the spike)
- `/import/mcp` form
- `/api/import/mcp` POST handler with introspection
- Composio URL-shape special case
- Runtime: refactor existing N8N tool-call loop to support MCP tool backend
- Claim/verify Method B (signed callback)

### Phase 3 — Polish (~2 days)
- Dashboard source pills + verification badges
- Re-probe button + health checks
- Read-only import config view
- App Store handoff schema

### Phase 4 — A2A + OpenAI SDK (design only)
- Stub importers + types
- No UI yet

---

## Open product calls

1. **Pricing for imported agents:** mark up the underlying TR cost? Charge per-turn flat fee? Phase 1 punt: free for importer, subscription via Squidgy at App Store level.
2. **Composio first-party deal:** worth pursuing? Their server catalog is gold. Outreach decision after spike.
3. **Free tier for importers:** how much usage before paywall? Default 100 free turns / month. Configurable per agent by builder.

---

## Spike plan — see `SPIKE_T2_MCP.md`

A 1-day end-to-end spike to validate T2's technical premise: pick one popular Composio MCP server, end-to-end through `/import/mcp` → hosted chat URL → real tool call. If that works, T2 is plumbing from there.
