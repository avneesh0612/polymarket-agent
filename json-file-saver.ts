/**
 * JsonFileSaver — a Bun-compatible persistent checkpoint saver.
 *
 * Extends MemorySaver and flushes the in-memory store to a JSON file after
 * every write. On construction it hydrates itself from that file, giving full
 * conversation persistence across restarts without needing native SQLite bindings.
 */

import { MemorySaver } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { existsSync, readFileSync, writeFileSync } from "fs";

type Storage = Record<string, Record<string, [unknown, unknown]>>;
type Writes = Record<string, Record<string, [string, unknown][]>>;

interface PersistedState {
  storage: Storage;
  writes: Writes;
}

export class JsonFileSaver extends MemorySaver {
  private readonly filePath: string;

  constructor(filePath = "agent-memory.json") {
    super();
    this.filePath = filePath;
    this._load();
  }

  // ─── Hydrate from disk on startup ──────────────────────────────────────────

  private _load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed: PersistedState = JSON.parse(raw);
      (this as any).storage = parsed.storage ?? {};
      (this as any).writes = parsed.writes ?? {};
      const threadCount = Object.keys((this as any).storage).length;
      console.log(
        `[memory] Loaded ${threadCount} conversation thread(s) from ${this.filePath}`
      );
    } catch (err) {
      console.warn(`[memory] Failed to load ${this.filePath}: ${err}`);
    }
  }

  // ─── Flush to disk after each write ────────────────────────────────────────

  private _flush(): void {
    const state: PersistedState = {
      storage: (this as any).storage,
      writes: (this as any).writes,
    };
    try {
      writeFileSync(this.filePath, JSON.stringify(state), "utf8");
    } catch (err) {
      console.warn(`[memory] Failed to save ${this.filePath}: ${err}`);
    }
  }

  // ─── Intercept writes ──────────────────────────────────────────────────────

  override async put(
    config: RunnableConfig,
    checkpoint: Parameters<MemorySaver["put"]>[1],
    metadata: Parameters<MemorySaver["put"]>[2]
  ): Promise<RunnableConfig> {
    const result = await super.put(config, checkpoint, metadata);
    this._flush();
    return result;
  }

  override async putWrites(
    config: RunnableConfig,
    writes: Parameters<MemorySaver["putWrites"]>[1],
    taskId: string
  ): Promise<void> {
    await super.putWrites(config, writes, taskId);
    this._flush();
  }
}
