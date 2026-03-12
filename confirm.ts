import readline from "readline";
import { appendFileSync } from "fs";

// ─── Shared readline instance ─────────────────────────────────────────────────

let _rl: readline.Interface | null = null;

export function setReadlineForConfirm(rl: readline.Interface): void {
  _rl = rl;
}

// ─── Confirmation prompt ──────────────────────────────────────────────────────

const WIDTH = 58;

export async function confirm(summary: string): Promise<boolean> {
  const lines = summary.split("\n");
  const bar = "─".repeat(WIDTH);

  process.stdout.write(`\n┌─ ACTION REQUIRED ${bar.slice(18)}\n`);
  for (const line of lines) {
    process.stdout.write(`│  ${line}\n`);
  }
  process.stdout.write(`└${bar}\n`);

  return new Promise((resolve) => {
    if (!_rl) {
      // No readline (e.g. web/voice mode) — default deny for safety
      process.stdout.write("No readline available — action denied.\n");
      resolve(false);
      return;
    }
    _rl.question("Proceed? [y/N] ", (answer) => {
      const confirmed = answer.trim().toLowerCase() === "y";
      process.stdout.write(confirmed ? "" : "Cancelled.\n");
      resolve(confirmed);
    });
  });
}

// ─── Audit log ────────────────────────────────────────────────────────────────

const AUDIT_FILE = "audit.log";

export function auditLog(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    appendFileSync(AUDIT_FILE, line + "\n");
  } catch {
    // Never crash the agent over a logging failure
  }
}
