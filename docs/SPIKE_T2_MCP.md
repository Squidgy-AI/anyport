# Spike — T2 MCP Import (1 day)

**Goal:** prove that Anyport can import a Composio MCP server end-to-end and deliver a working hosted chat that calls real tools — *in one day*. If this works, T2 is mostly plumbing on top.

**Date:** allocate 8 hours, single dev.
**Reference:** `PRD_INBOUND_IMPORT.md` for the wider design.

---

## Why a spike before T2 build

The T2 PRD assumes:
1. We can introspect an arbitrary Composio MCP URL programmatically
2. The tool schemas it returns are usable by TokenRouter's tool-calling
3. A round-trip tool call (LLM decides → POST to MCP → result back → LLM continues) actually works

If any of those is wrong, the rest of T2's spec changes. Spike first, build second.

---

## Target

**One Composio MCP server, one tool, one chat session.**

Pick a Composio server that:
- Is universally relatable (Slack message send, GitHub issue create, Notion page write)
- Has a small surface area (1–3 tools max — easier to debug)
- Has known auth shape (Composio MCP URL with `user_id` query param)

**Recommended target:** Composio's Slack server.
- **Why:** clear "wow" demo, Seth has already verified Day-1 Slack DM works (per workspace memory `project_composio.md` 2026-04-15).
- **Tool to call:** `send_dm` or `send_message`.
- **Test recipient:** Seth's own Slack DM.

---

## 8-hour breakdown

### Hour 1 — Composio account + MCP URL ready
- Create or reuse Composio account
- Install Slack integration for the test user
- Generate the MCP URL: `https://mcp.composio.dev/v3/mcp/<server_id>/mcp?user_id=<uid>`
- Verify the URL works: `curl` against it (expects an SSE/JSON-RPC response with tool list)

**Done when:** you've curled the MCP URL and seen the tool list.

### Hour 2 — MCP introspection script (Python)
- Write `scripts/spike_mcp_introspect.py` — uses the existing `mcp` Python lib
- Connects to the MCP URL, lists tools, prints schemas in a clean format
- Output: JSON dump of `{ tools: [{ name, description, inputSchema, outputSchema }] }`

**Code shape:**
```python
import asyncio, json, sys
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def main(url):
    async with streamablehttp_client(url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(json.dumps([t.model_dump() for t in tools.tools], indent=2))

asyncio.run(main(sys.argv[1]))
```

**Done when:** running the script with the Composio MCP URL prints Slack's tool schemas.

### Hour 3 — TypeScript port
- Move introspection to TypeScript using `@modelcontextprotocol/sdk` (the official client)
- New file: `lib/importers/mcp.ts` — `introspect(url)` + `callTool(url, toolName, args)` exports
- Use the same MCP URL, same flow

**Done when:** running a tiny Node script that imports `lib/importers/mcp.ts` and calls `introspect()` returns the same tool list.

### Hour 4 — Tool-call round trip (no LLM yet)
- Direct test: from the spike script, invoke `callTool(url, 'send_message', { channel: 'D...', text: 'hello from anyport spike' })`
- Verify message arrives in Slack

**Done when:** the message lands in Slack.

### Hour 5 — Tool descriptors → TokenRouter format
- TokenRouter expects OpenAI-compatible tool descriptors:
  ```json
  { "type": "function", "function": { "name": "...", "description": "...", "parameters": <JSON Schema> } }
  ```
- Write a converter from MCP tool schema → OpenAI function descriptor in `lib/importers/mcp.ts`:
  ```ts
  export function toOpenAITools(mcpTools: McpTool[]): OpenAITool[] { ... }
  ```
- Validate by passing one converted tool to a quick TokenRouter call and checking the LLM picks it correctly

**Done when:** TokenRouter call with the converted tool returns a `tool_calls` block with the right tool name.

### Hour 6 — End-to-end loop in a CLI
- New CLI: `scripts/spike_mcp_chat.ts` — interactive chat that:
  1. Introspects the MCP URL (once at startup)
  2. Loops: read user input → TokenRouter call with messages + tools → if `tool_calls`, invoke via MCP, append result → repeat
  3. Print assistant turns
- Run it. Type: "DM Seth: hello from anyport"
- LLM picks `send_message`, fills args, our loop calls MCP, message lands in Slack, LLM acknowledges

**Done when:** the chat session sends a real Slack DM in response to a natural-language prompt.

### Hour 7 — Wire into Anyport `/agent/[id]` runtime path
- Hardcode the MCP URL into a test `anyport_agents` row in DEV (manual insert)
- Set `import_source = 'composio_mcp'` and `import_config = { url: '...', tools: [...] }`
- The chat page (`/agent/[id]`) reads the row, dispatches to the new MCP-backed tool-call loop
- Visit the URL in a browser → working chat with Slack tools

**Done when:** opening `/agent/<id>` in the browser and typing a Slack DM request actually sends one.

### Hour 8 — Results write-up
- File: `docs/SPIKE_T2_MCP_RESULTS.md`
- Sections: what worked, what surprised, gotchas, refactors needed for T2 build, time-to-implement estimate
- Tag with `verdict: green | yellow | red` for whether to proceed with T2 as-specced

**Done when:** the write-up exists and tells future-Seth whether T2 is ready to build.

---

## Failure modes to watch

| Failure | Cause | Fallback |
|---|---|---|
| Introspection returns empty tool list | Composio server didn't fully connect, missing auth | Try a non-Composio MCP server (e.g. local stdio MCP) to isolate |
| Tool schema can't be converted to OpenAI format | Schema uses MCP-specific types not OpenAI-compatible | Document the gap; T2 needs schema-translation logic for these cases |
| TokenRouter rejects the tool descriptor | Schema validation fails on TR side | Try with Anthropic API directly via TR; if that works it's a TR-specific limitation |
| MCP call returns success but Slack message doesn't appear | Composio integration not properly auth'd | Re-link Slack in Composio UI; verify `user_id` matches |
| LLM hallucinates tool args | Tool description isn't clear enough | Document; T2 needs LLM-friendly tool descriptions |

---

## What we learn (regardless of outcome)

- **Whether MCP introspection is reliable enough for production** (vs. requires per-server tweaking)
- **Whether OpenAI tool descriptors round-trip cleanly from MCP schemas**
- **Where TokenRouter fits in the loop** for inbound MCP tools (we already use it for outbound; this confirms it works on inbound too)
- **Time-to-build estimate** for T2 full implementation (the 8-hour spike will tell us if T2 is 3 days or 3 weeks)

---

## Output

After spike completion, we should have:

1. ✅ A working CLI chat that talks to a Composio MCP and sends Slack messages via natural language
2. ✅ A working hosted chat page at `/agent/<id>` doing the same in the browser
3. ✅ `lib/importers/mcp.ts` with `introspect`, `callTool`, `toOpenAITools` functions
4. ✅ `scripts/spike_mcp_introspect.py` and `scripts/spike_mcp_chat.ts` for repro
5. ✅ Results doc with verdict + time estimate

Then we can write the proper `/import/mcp` form and `/api/import/mcp` POST handler in Phase 2 of the PRD with confidence.

---

## What this spike does NOT cover

- The form UI (just hardcode for now)
- Claim/verify (manual until T2 build)
- Composio-specific auth flow (use existing user_id-in-URL only)
- Multi-tool servers (one tool is enough to prove the loop)
- Error UX (just throw and crash for spike purposes)

---

## Stretch (if hour 8 finishes early)

- Try a **non-Composio MCP server** (e.g., a local stdio MCP via HTTP wrapper) to confirm we're not Composio-coupled
- Try an **MCP server with multiple tools** to confirm the LLM picks the right one
- Try a **richer tool** (Notion page create with formatted body) to test schema fidelity
