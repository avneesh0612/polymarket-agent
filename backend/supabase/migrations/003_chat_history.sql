-- Chat history: stores all user ↔ agent messages per user/thread
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
