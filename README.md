# Anyport

Publish any agent to Claude in 60 seconds. Billed by the token, automatically.

Built at Builders Collective hackathon, 2026-04-29.

## What it does

Paste a name + system prompt → get an installable MCP chat-app inside Claude/ChatGPT. Every token routed through TokenRouter for metering, audit, and quota. Reboot.dev hosts the MCP runtime.

## Stack

- **Next.js 15** (App Router) — UI + API
- **Reboot.dev** — MCP chat-app runtime
- **TokenRouter** — model routing, per-agent sub-keys, usage metering
- **Supabase** — agent registry + usage log

## Setup

```bash
npm install
cp .env.example .env.local   # fill in keys
# run database/schema.sql in your Supabase project
npm run dev
```

## Hackathon plan

| Time | Block |
|---|---|
| 11:30–12:30 | Skeleton + hardcoded agent live in Claude (steal Reboot's todo template) |
| 12:30–13:30 | Wire TokenRouter under Reboot's inference; confirm dashboard ticks |
| 13:30–14:30 | Paste-form → publish → install URL flow end-to-end |
| 14:30–15:00 | Usage dashboard polling `/api/agents` |
| 15:00–15:30 | Polish + record demo video |
| 15:30–16:00 | Submit on hackerquad |

## Cut order if behind

1. Dashboard polish → show TokenRouter's native dashboard instead
2. Form parsing → hardcode 2 sample agents as buttons
3. Multi-agent → demo with one, talk about rest

**Never cut:** the Claude-app actually working.

## Demo script (3 min)

1. Problem: builders make agents, can't distribute or bill them
2. Stack: Reboot + TokenRouter + Supabase
3. Live: paste prompt → publish → install in Claude → chat → dashboard ticks
4. Why now: Claude/ChatGPT just opened MCP directories
