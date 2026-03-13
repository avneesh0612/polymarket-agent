# Data Persistence

The backend stores three types of data in Postgres, all tied to Dynamic users.

| Table | Purpose |
|---|---|
| `delegations` | Signing credentials received from Dynamic's webhook, keyed by Dynamic user ID |
| `agent_memory` | Agent conversation state, so sessions survive server restarts |
| `chat_history` | Message history per Dynamic user, served to the UI |

---

## Database setup

Run the three migrations in order:

```bash
psql $DATABASE_URL -f backend/supabase/migrations/001_delegations.sql
psql $DATABASE_URL -f backend/supabase/migrations/002_memory.sql
psql $DATABASE_URL -f backend/supabase/migrations/003_chat_history.sql
```

All migrations use `CREATE TABLE IF NOT EXISTS` and are safe to re-run.

---

## Delegation records

This is the most Dynamic-specific table. It stores the decrypted signing credentials that Dynamic delivers via the `wallet.delegation.created` webhook. The agent reads from this table on every request to sign transactions on behalf of the user.

### Schema

```sql
create table if not exists delegations (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,         -- Dynamic user ID (JWT sub)
  wallet_id      text not null,         -- Dynamic wallet ID
  address        text not null,         -- lowercase EVM address
  chain          text not null,         -- e.g. "EVM"
  wallet_api_key text not null,         -- Dynamic wallet API key
  key_share      jsonb not null,        -- signing key share from Dynamic
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (user_id, chain)
);
```

The `user_id` is the `sub` claim from the user's Dynamic JWT — this is how records are linked to authenticated users. The unique constraint on `(user_id, chain)` means re-delegation overwrites the old record.

### When it's written and read

- **Written** — when `wallet.delegation.created` fires from Dynamic
- **Read** — on every `POST /api/agent` request, before running the agent
- **Deleted** — when `wallet.delegation.revoked` fires from Dynamic

### Functions

```typescript
storeDelegation(record)          // called by webhook handler
getDelegation(userId)            // called before each agent run
deleteDelegation(userId)         // called on revocation
```

---

## Agent memory

Stores conversation state so the agent remembers previous messages across requests and server restarts. Keyed by `thread_id`, which defaults to the Dynamic user ID.

### Schema

```sql
create table if not exists agent_memory (
  id              text primary key default 'main',
  checkpoint_data jsonb not null default '{"storage": {}, "writes": {}}',
  updated_at      timestamptz not null default now()
);
```

There is one row (`id = 'main'`) that holds state for all users. The `PgSaver` class in `backend/src/lib/pg-saver.ts` keeps an in-memory copy for speed and flushes to this table after each agent step.

The thread ID isolates each user's conversation:

```typescript
// Defaults to the Dynamic user ID, so each user gets their own thread
const threadId = requestBody.threadId ?? user.sub;
```

---

## Chat history

A plain message log per user, used to display conversation history in the UI.

### Schema

```sql
create table if not exists chat_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,    -- Dynamic user ID
  thread_id  text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
```

Both the user message and agent response are saved after each successful agent run:

```typescript
await saveChatMessage(user.sub, threadId, "user", message);
await saveChatMessage(user.sub, threadId, "assistant", response);
```

Retrieved via `GET /api/history?threadId=<id>` (returns last 100 messages by default).

---

## Data flow

```
POST /api/agent
    │
    ├─ verify Dynamic JWT → extract user.sub
    │
    ├─ getDelegation(user.sub) ──────────► delegations table
    │   └─ 403 if not found
    │
    ├─ runAgentForUser()
    │   ├─ load memory ◄─────────────────  agent_memory table
    │   ├─ execute tools
    │   └─ save memory ─────────────────►  agent_memory table
    │
    └─ saveChatMessage() ───────────────►  chat_history table
```

---

## Querying the data

```sql
-- Check if a Dynamic user has an active delegation
SELECT address, chain, updated_at FROM delegations WHERE user_id = 'usr_abc123';

-- Get conversation history for a user
SELECT role, content, created_at FROM chat_history
WHERE user_id = 'usr_abc123' ORDER BY created_at ASC;

-- Clear a user's conversation history
DELETE FROM chat_history WHERE user_id = 'usr_abc123';

-- Manually revoke a delegation
DELETE FROM delegations WHERE user_id = 'usr_abc123';
```

---

## Supabase vs raw Postgres

Both are supported. The only difference is which client and saver you use in `backend/src/lib/agent/index.ts`:

```typescript
// Raw Postgres
import { PgSaver } from "../pg-saver";
const checkpointer = new PgSaver();

// Supabase
import { SupabaseSaver } from "../supabase-saver";
const checkpointer = new SupabaseSaver();
```

The SQL migrations are identical for both — run them once regardless of which client you use.
