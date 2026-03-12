/**
 * PgSaver — a Postgres-backed LangGraph checkpoint saver.
 *
 * Extends MemorySaver (keeping fast in-memory access) and persists the full
 * checkpoint state to Postgres after every write. On first access it hydrates
 * itself from Postgres, giving full conversation persistence across restarts.
 */

import { MemorySaver } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { sql } from "./db";

interface PersistedState {
  storage: Record<string, unknown>;
  writes: Record<string, unknown>;
}

export class PgSaver extends MemorySaver {
  private loaded = false;

  // ─── Hydrate from Postgres on first access ──────────────────────────────────

  private async _load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const rows = await sql`
        SELECT checkpoint_data FROM agent_memory WHERE id = 'main'
      `;

      if (rows.length > 0 && rows[0].checkpoint_data) {
        const state = rows[0].checkpoint_data as PersistedState;
        (this as any).storage = state.storage ?? {};
        (this as any).writes = state.writes ?? {};
        const threadCount = Object.keys((this as any).storage).length;
        console.log(
          `[memory] Loaded ${threadCount} conversation thread(s) from Postgres`
        );
      }
    } catch (err) {
      console.warn("[memory] Postgres load error, starting fresh:", err);
    }
  }

  // ─── Flush to Postgres after each write ─────────────────────────────────────

  private async _flush(): Promise<void> {
    try {
      const state: PersistedState = {
        storage: (this as any).storage,
        writes: (this as any).writes,
      };

      await sql`
        INSERT INTO agent_memory (id, checkpoint_data, updated_at)
        VALUES ('main', ${sql.json(state as any)}, now())
        ON CONFLICT (id) DO UPDATE SET
          checkpoint_data = EXCLUDED.checkpoint_data,
          updated_at      = now()
      `;
    } catch (err) {
      console.warn("[memory] Postgres flush error:", err);
    }
  }

  // ─── Intercept reads to ensure loaded ───────────────────────────────────────

  override async get(config: RunnableConfig) {
    await this._load();
    return super.get(config);
  }

  override async list(config: RunnableConfig, options?: any) {
    await this._load();
    return super.list(config, options);
  }

  // ─── Intercept writes to persist ────────────────────────────────────────────

  override async put(
    config: RunnableConfig,
    checkpoint: Parameters<MemorySaver["put"]>[1],
    metadata: Parameters<MemorySaver["put"]>[2]
  ): Promise<RunnableConfig> {
    await this._load();
    const result = await super.put(config, checkpoint, metadata);
    await this._flush();
    return result;
  }

  override async putWrites(
    config: RunnableConfig,
    writes: Parameters<MemorySaver["putWrites"]>[1],
    taskId: string
  ): Promise<void> {
    await this._load();
    await super.putWrites(config, writes, taskId);
    await this._flush();
  }
}
