-- Anyport schema. Run in Supabase SQL editor (or via nova_exec_sql RPC).

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

-- Inbound import support (PRD_INBOUND_IMPORT.md). Applied to DEV 2026-05-01.
alter table anyport_agents
  add column if not exists import_source text default 'squidgy_yaml',
  add column if not exists import_config jsonb default '{}'::jsonb,
  add column if not exists verification_status text default 'pending',
  add column if not exists verification_token text,
  add column if not exists owner_email text,
  add column if not exists owner_user_id uuid;

create index if not exists anyport_agents_import_source_idx on anyport_agents(import_source);
create index if not exists anyport_agents_owner_idx on anyport_agents(owner_user_id);

create table if not exists anyport_secrets (
  id text primary key,
  agent_id text references anyport_agents(id) on delete cascade,
  encrypted_value bytea not null,
  created_at timestamptz default now()
);
create index if not exists anyport_secrets_agent_idx on anyport_secrets(agent_id);
