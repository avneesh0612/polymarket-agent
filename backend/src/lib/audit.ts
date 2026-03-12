/**
 * Supabase-backed audit logger.
 * Replaces the flat audit.log file — all agent events are stored in the
 * audit_logs table with full JSON data and timestamps.
 */

import { supabase } from "./supabase";

export async function auditLog(entry: Record<string, unknown>): Promise<void> {
  const event = (entry.event as string) ?? "unknown";
  const { event: _event, ...data } = entry;

  try {
    await supabase.from("audit_logs").insert({
      event,
      data: { ts: new Date().toISOString(), ...data },
    });
  } catch (err) {
    // Never crash over logging
    console.warn("[audit] Failed to write to Supabase:", err);
  }
}
