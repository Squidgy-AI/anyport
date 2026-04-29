-- Anyport schema. Run in Supabase SQL editor.

create table if not exists anyport_agents (
  id text primary key,
  name text not null,
  system_prompt text not null,
  tools jsonb not null default '[]'::jsonb,
  model text default 'claude-sonnet-4-6',
  mcp_install_url text,
  tokenrouter_key text,
  reboot_app_id text,
  created_at timestamptz default now()
);

create table if not exists anyport_usage (
  id bigserial primary key,
  agent_id text references anyport_agents(id) on delete cascade,
  prompt_tokens int default 0,
  completion_tokens int default 0,
  cost_usd numeric(10,6) default 0,
  created_at timestamptz default now()
);

create index if not exists anyport_usage_agent_idx on anyport_usage(agent_id, created_at desc);
