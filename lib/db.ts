import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Local SQLite store for OneDrive Manager.
 *
 * Personal, single-user app → one local file, no server DB. Lives under `data/`
 * (gitignored). Phase 0 only holds the user-authored per-account metadata
 * (a display label and a custom description, keyed by Microsoft account id).
 * Connected-account rows and encrypted refresh tokens arrive in Phase 1.
 *
 * Next.js dev hot-reloads modules, which would open a new connection on every
 * reload; we cache the connection on globalThis to keep exactly one.
 */

const DB_PATH = join(process.cwd(), "data", "onedrive-manager.db");

function createConnection(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_meta (
      account_id    TEXT PRIMARY KEY,
      display_label TEXT,
      description   TEXT,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const globalForDb = globalThis as unknown as { __odmDb?: Database.Database };

export const db: Database.Database = globalForDb.__odmDb ?? createConnection();
if (process.env.NODE_ENV !== "production") globalForDb.__odmDb = db;
