import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Persistent, append-only app log: one JSON object per line in `data/logs/app.log`
 * (gitignored with the rest of `data/`). The Mac launcher truncates its stdout log on
 * every start, so anything worth debugging later must land here.
 *
 *   grep '27-Bonus' data/logs/app.log | tail
 *
 * Rotates to `app.log.1` at ~20 MB (one generation kept). Logging never throws.
 */

const DIR = join(process.cwd(), "data", "logs");
const FILE = join(DIR, "app.log");
const MAX_BYTES = 20 * 1024 * 1024;

let ready = false;
let writes = 0;

export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, scope: string, event: string, fields: Record<string, unknown> = {}): void {
  const entry = { t: new Date().toISOString(), level, scope, event, ...fields };
  const line = JSON.stringify(entry, (_k, v) => (v instanceof Error ? v.message : v));
  try {
    if (!ready) {
      mkdirSync(DIR, { recursive: true });
      ready = true;
    }
    if (++writes % 200 === 0) rotateIfLarge();
    appendFileSync(FILE, line + "\n");
  } catch {
    /* never let logging break the caller */
  }
  const short = `[${scope}] ${event} ${JSON.stringify(fields)}`;
  if (level === "info") console.log(short);
  else console.error(short);
}

function rotateIfLarge(): void {
  try {
    if (statSync(FILE).size > MAX_BYTES) renameSync(FILE, FILE + ".1");
  } catch {
    /* missing file is fine */
  }
}
