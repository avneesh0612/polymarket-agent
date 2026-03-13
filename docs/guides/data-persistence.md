# Data Persistence

The backend uses three independent Postgres-backed persistence layers. Each serves a distinct purpose and is written/read at different points in the request lifecycle.

| Layer | Table | File | Purpose |
|---|---|---|---|
| Delegation records | `delegations` | `backend/src/lib/delegation-store.ts` | Stores MPC key shares from the Dynamic webhook |
| LangGraph checkpoints | `agent_memory` | `backend/src/lib/pg-saver.ts` | Persists full agent state so conversations survive restarts |
| Chat history | `chat_history` | `backend/src/lib/chat-history.ts` | Human-readable message log served to the UI |

---

## Database Setup

Run the three migrations in order. They are idempotent (`CREATE TABLE IF NOT EXISTS`), so they are safe to re-run.

```bash
psql $DATABASE_URL -f backend/supabase/migrations/001_delegations.sql
psql $DATABASE_URL -f backend/supabase/migrations/002_memory.sql
psql $DATABASE_URL -f backend/supabase/migrations/003_chat_history.sql
```

If you are using Supabase, run the same files through the Supabase dashboard SQL editor or the Supabase CLI:

```bash
supabase db push
```

---

## Layer 1: Delegation Records

### What it stores

Delegation records hold the decrypted MPC key shares that Dynamic delivers via webhook when a user approves wallet delegation. The agent needs these credentials on every request to sign transactions on the user's behalf.

### TypeScript interface

```typescript
export interface DelegationRecord {
  userId: string;      // Dynamic user ID (JWT sub claim)
  walletId: string;    // Dynamic wallet ID
  address: string;     // Lowercase EVM address
  chain: string;       // e.g. "EVM", "eip155:1"
  walletApiKey: string;
  keyShare: ServerKeyShare; // Stored as JSONB in Postgres
}
```

### Schema (`001_delegations.sql`)

```sql
create table if not exists delegations (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  wallet_id      text not null,
  address        text not null,        -- lowercase wallet address
  chain          text not null,        -- e.g. "EVM", "eip155:1"
  wallet_api_key text not null,        -- decrypted Dynamic wallet API key
  key_share      jsonb not null,       -- decrypted ECDSA keygen result
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (user_id, chain)
);
```

The unique constraint on `(user_id, chain)` means there is at most one delegation row per user per chain. `storeDelegation()` uses `ON CONFLICT ... DO UPDATE` (upsert), so re-delegation automatically replaces the old key share without leaving stale rows.

### When data is written and read

- **Written**: `POST /api/webhooks` → Dynamic fires `wallet.delegation.created` → `storeDelegation()` is called.
- **Read**: Every `POST /api/agent` request calls `getDelegation(userId)` before running the agent. If no record exists, the request is rejected with `403`.
- **Deleted**: `wallet.delegation.revoked` webhook event → `deleteDelegation(userId)`.

### Functions

```typescript
// Upsert a delegation record (called at webhook time)
storeDelegation(record: DelegationRecord): Promise<void>

// Retrieve the most recent delegation for a user (called per agent request)
getDelegation(userId: string): Promise<DelegationRecord | null>

// Delete all delegations for a user (called on revocation)
deleteDelegation(userId: string): Promise<void>
```

---

## Layer 2: LangGraph Checkpoints (PgSaver)

### What LangGraph checkpoints are

LangGraph checkpoints are snapshots of the full agent state machine — every message in the conversation, pending tool calls, tool results, and graph node metadata. They allow the agent to resume an interrupted run, and they give the agent memory across separate HTTP requests.

Without a checkpoint saver, each API call would start a blank conversation. With one, the agent picks up exactly where it left off.

### PgSaver implementation

`PgSaver` (in `backend/src/lib/pg-saver.ts`) extends LangGraph's built-in `MemorySaver` to add Postgres persistence:

- **In-memory speed**: All reads and writes go through `MemorySaver`'s in-memory store first, keeping latency low.
- **Lazy hydration**: On the first access after startup, `_load()` fetches the single `id = 'main'` row from Postgres and restores `storage` and `writes` into the in-memory saver. Subsequent accesses skip this step.
- **Flush after every write**: After every `put()` or `putWrites()` call, `_flush()` serializes the entire in-memory state back to Postgres as JSONB.

The result is that the in-memory state is always authoritative at runtime, and Postgres is always an up-to-date snapshot. A backend restart hydrates from Postgres in milliseconds.

### Schema (`002_memory.sql`)

```sql
create table if not exists agent_memory (
  id              text primary key default 'main',
  checkpoint_data jsonb not null default '{"storage": {}, "writes": {}}',
  updated_at      timestamptz not null default now()
);
```

There is always exactly one row with `id = 'main'`. That single JSONB column holds the checkpoint state for **all** user threads at once.

### Instantiation

```typescript
// backend/src/lib/agent/index.ts
import { PgSaver } from "../pg-saver";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const checkpointer = new PgSaver();

const agent = createReactAgent({
  llm: model,
  tools: [...allTools, ...polymarketTools],
  checkpointSaver: checkpointer,
  stateModifier: SYSTEM_PROMPT,
});
```

The `checkpointer` instance is a module-level singleton shared across all requests in a process.

### Thread IDs

LangGraph uses a `thread_id` to isolate each conversation. The backend sets it in the agent invocation config:

```typescript
const effectiveThreadId = threadId ?? user.sub; // user.sub is the Dynamic user ID

await agent.invoke(
  { messages: [new HumanMessage(message)] },
  { configurable: { thread_id: effectiveThreadId } }
);
```

By default the thread ID is the user's Dynamic ID (`user.sub`), so each user gets their own isolated conversation thread. A custom `threadId` can be passed in the request body to support multiple named threads per user — for example, separate chats for different wallets or topics.

---

## Layer 3: Chat History

### What it stores

The chat history table is a sequential log of human-readable messages. Each row is a single message with a role (`user` or `assistant`) and plain text content.

### How it differs from checkpoints

| | LangGraph checkpoints | Chat history |
|---|---|---|
| **Contents** | Full agent state machine snapshot (messages + tool calls + graph metadata) | Plain `role` + `content` text only |
| **Format** | Opaque JSONB, internal LangGraph format | Simple rows, readable by any SQL client |
| **Purpose** | Agent memory — resuming runs, multi-turn reasoning | UI display — rendering the conversation to the user |
| **Table** | `agent_memory` (single row) | `chat_history` (one row per message) |

Both layers exist because they serve different consumers. The agent needs the checkpoint format to reason correctly. The frontend needs a clean, paginated message list.

### Schema (`003_chat_history.sql`)

```sql
create table if not exists chat_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  thread_id  text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);
```

### Functions

```typescript
// Save a single message (called in backend/src/routes/agent.ts after each response)
saveChatMessage(
  userId: string,
  threadId: string,
  role: "user" | "assistant",
  content: string
): Promise<void>

// Retrieve ordered message history for a thread (default limit 100)
getChatHistory(
  userId: string,
  threadId: string,
  limit?: number  // default 100
): Promise<{ role: "user" | "assistant"; content: string; created_at: string }[]>
```

### When data is written and read

In `backend/src/routes/agent.ts`, after the agent returns a response:

```typescript
const response = await runAgentForUser(message, effectiveThreadId, creds, jwt);
await saveChatMessage(user.sub, effectiveThreadId, "user", message.trim());
await saveChatMessage(user.sub, effectiveThreadId, "assistant", response);
```

Both the user message and the assistant response are saved in a single request handler, so they always appear as a matched pair.

### GET /api/history endpoint

```
GET /api/history?threadId=<id>
Authorization: Bearer <jwt>
```

Returns the full message history for the authenticated user and the given thread (defaults to `user.sub` if `threadId` is omitted):

```json
{
  "messages": [
    { "role": "user",      "content": "What's my ETH balance?", "created_at": "2025-01-01T12:00:00Z" },
    { "role": "assistant", "content": "Your balance is 0.42 ETH.", "created_at": "2025-01-01T12:00:01Z" }
  ]
}
```

---

## Querying the Data

Common SQL queries for debugging and operations:

```sql
-- Get all messages for a user thread, in order
SELECT role, content, created_at
FROM chat_history
WHERE user_id = 'usr_abc123' AND thread_id = 'usr_abc123'
ORDER BY created_at ASC;

-- Check whether a user has an active delegation
SELECT address, chain, updated_at
FROM delegations
WHERE user_id = 'usr_abc123';

-- Check the size of the agent memory blob
SELECT id, pg_size_pretty(pg_column_size(checkpoint_data)::bigint) AS size
FROM agent_memory;

-- Count messages per user
SELECT user_id, COUNT(*) AS message_count
FROM chat_history
GROUP BY user_id
ORDER BY message_count DESC;

-- Find all delegations updated in the last 24 hours
SELECT user_id, address, chain, updated_at
FROM delegations
WHERE updated_at > now() - interval '24 hours'
ORDER BY updated_at DESC;
```

---

## Data Flow Diagram

```
User Request (POST /api/agent)
    │
    ▼
JWT Auth (Dynamic JWKS)
    │
    ▼
getDelegation(userId) ◄─────────────── delegations table
    │
    │  (403 if no delegation found)
    │
    ▼
runAgentForUser(message, threadId, creds)
    │
    ├── PgSaver.get() ◄──────────────── agent_memory table (lazy hydrate on first call)
    │
    ├── [agent executes tools with delegated wallet]
    │
    └── PgSaver.put() ──────────────►  agent_memory table (flush after every step)
            │
            ▼
    saveChatMessage("user", ...) ────► chat_history table
    saveChatMessage("assistant", ...)► chat_history table
```

---

## Using Supabase vs Raw Postgres

The repo ships two interchangeable implementations of each persistence component:

| Component | Raw Postgres (postgres.js) | Supabase |
|---|---|---|
| Database client | `backend/src/lib/db.ts` | `backend/src/lib/supabase.ts` |
| Checkpoint saver | `backend/src/lib/pg-saver.ts` (`PgSaver`) | `backend/src/lib/supabase-saver.ts` (`SupabaseSaver`) |
| SQL migrations | Same files for both | Same files for both |

Both `PgSaver` and `SupabaseSaver` extend `MemorySaver` with identical behavior — lazy hydration on first access, flush after every write, single `id = 'main'` row. They differ only in how they connect to the database.

To switch from raw Postgres to Supabase (or vice versa), update the import in `backend/src/lib/agent/index.ts`:

```typescript
// Raw Postgres
import { PgSaver } from "../pg-saver";
const checkpointer = new PgSaver();

// Supabase
import { SupabaseSaver } from "../supabase-saver";
const checkpointer = new SupabaseSaver();
```

The SQL migrations are identical for both backends — run them once regardless of which client you use.

---

## Resetting State

### Clear agent memory for all users

This removes the entire checkpoint blob. All users lose their conversation history on the next request.

```sql
DELETE FROM agent_memory WHERE id = 'main';
```

### Clear agent memory for a specific user thread

LangGraph stores thread state inside the `checkpoint_data` JSONB. To surgically remove one thread, use `jsonb` operators:

```sql
UPDATE agent_memory
SET checkpoint_data = jsonb_set(
  checkpoint_data,
  '{storage}',
  (checkpoint_data->'storage') - 'usr_abc123'
)
WHERE id = 'main';
```

Replace `'usr_abc123'` with the user's Dynamic ID (which is the default thread ID).

### Clear chat history for a user

```sql
-- Delete all threads for a user
DELETE FROM chat_history WHERE user_id = 'usr_abc123';

-- Delete a specific thread only
DELETE FROM chat_history
WHERE user_id = 'usr_abc123' AND thread_id = 'usr_abc123';
```

### Revoke a delegation

```sql
DELETE FROM delegations WHERE user_id = 'usr_abc123';
```

After deleting the delegation row, the user will receive a `403` on their next agent request until they re-delegate their wallet.
