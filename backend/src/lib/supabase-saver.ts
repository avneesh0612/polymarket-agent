/**
 * SupabaseSaver — a Supabase-backed LangGraph checkpoint saver.
 *
 * Extends MemorySaver (keeping fast in-memory access) and persists the full
 * checkpoint state to Supabase after every write. On first access it hydrates
 * itself from Supabase, giving full conversation persistence across restarts
 * without relying on the local filesystem.
 */

import { MemorySaver } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { supabase } from "./supabase";

interface PersistedState {
  storage: Record<string, unknown>;
  writes: Record<string, unknown>;
}

export class SupabaseSaver extends MemorySaver {
  private loaded = false;

  // ─── Hydrate from Supabase on first access ──────────────────────────────────

  private async _load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const { data, error } = await supabase
        .from("agent_memory")
        .select("checkpoint_data")
        .eq("id", "main")
        .maybeSingle();

      if (error) {
        console.warn("[memory] Failed to load from Supabase:", error.message);
        return;
      }

      if (data?.checkpoint_data) {
        const state = data.checkpoint_data as PersistedState;
        (this as any).storage = state.storage ?? {};
        (this as any).writes = state.writes ?? {};
        const threadCount = Object.keys((this as any).storage).length;
        console.log(
          `[memory] Loaded ${threadCount} conversation thread(s) from Supabase`
        );
      }
    } catch (err) {
      console.warn("[memory] Supabase load error, starting fresh:", err);
    }
  }

  // ─── Flush to Supabase after each write ─────────────────────────────────────

  private async _flush(): Promise<void> {
    try {
      const state: PersistedState = {
        storage: (this as any).storage,
        writes: (this as any).writes,
      };

      const { error } = await supabase.from("agent_memory").upsert({
        id: "main",
        checkpoint_data: state,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        console.warn("[memory] Failed to persist to Supabase:", error.message);
      }
    } catch (err) {
      console.warn("[memory] Supabase flush error:", err);
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
