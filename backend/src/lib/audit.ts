/**
 * Postgres-backed audit logger.
 * All agent events are stored in the audit_logs table with full JSON data and timestamps.
 */

import { sql } from "./db";

export async function auditLog(entry: Record<string, unknown>): Promise<void> {
  const event = (entry.event as string) ?? "unknown";
  const { event: _event, ...data } = entry;

  try {
    await sql`
      INSERT INTO audit_logs (event, data)
      VALUES (${event}, ${sql.json({ ts: new Date().toISOString(), ...data })})
    `;
  } catch (err) {
    // Never crash over logging
    console.warn("[audit] Failed to write audit log:", err);
  }
}
