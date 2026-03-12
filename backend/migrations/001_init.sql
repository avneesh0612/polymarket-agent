-- Delegation records
-- Stores decrypted MPC key shares received from the Dynamic delegation webhook.
-- Each row represents one user's delegation on one chain.

create table if not exists delegations (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  wallet_id   text not null,
  address     text not null,          -- lowercase wallet address
  chain       text not null,          -- e.g. "EVM", "eip155:1"
  wallet_api_key  text not null,      -- decrypted Dynamic wallet API key
  key_share   jsonb not null,         -- decrypted ECDSA keygen result
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, chain)
);

create index if not exists delegations_user_id_idx on delegations (user_id);
create index if not exists delegations_address_idx on delegations (address);

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger delegations_updated_at
  before update on delegations
  for each row execute procedure update_updated_at();

-- Agent memory (LangGraph checkpoints)
-- Stores the full in-memory LangGraph MemorySaver state so conversation
-- history persists across backend restarts.

create table if not exists agent_memory (
  id              text primary key default 'main',
  checkpoint_data jsonb not null default '{"storage": {}, "writes": {}}',
  updated_at      timestamptz not null default now()
);

-- Audit log for all agent actions and events

create table if not exists audit_logs (
  id         uuid primary key default gen_random_uuid(),
  event      text not null,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_event_idx      on audit_logs (event);
create index if not exists audit_logs_created_at_idx on audit_logs (created_at desc);

-- Chat history: stores all user <-> agent messages per user/thread

create table if not exists chat_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  thread_id  text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_history_user_id_idx   on chat_history (user_id);
create index if not exists chat_history_thread_id_idx on chat_history (thread_id, created_at);
