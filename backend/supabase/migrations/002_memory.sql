-- Agent memory (LangGraph checkpoints)
-- Stores the full in-memory LangGraph MemorySaver state so conversation
-- history persists across backend restarts.

create table if not exists agent_memory (
  id          text primary key default 'main',
  checkpoint_data jsonb not null default '{"storage": {}, "writes": {}}',
  updated_at  timestamptz not null default now()
);

-- Audit log for all agent actions and events
create table if not exists audit_logs (
  id         uuid primary key default gen_random_uuid(),
  event      text not null,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_event_idx on audit_logs (event);
create index if not exists audit_logs_created_at_idx on audit_logs (created_at desc);
