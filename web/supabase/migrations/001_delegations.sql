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

-- Row Level Security: only the service role key can read/write
alter table delegations enable row level security;

-- Indexes for fast lookups
create index if not exists delegations_user_id_idx  on delegations (user_id);
create index if not exists delegations_address_idx  on delegations (address);

-- Auto-update updated_at on row changes
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
