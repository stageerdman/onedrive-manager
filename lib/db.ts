import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Local SQLite store for OneDrive Manager.
 *
 * Personal, single-user app → one local file, no server DB. Lives under `data/`
 * (gitignored). Holds the connected accounts (identity, user-authored
 * label/description, status, accent, order) with each refresh token encrypted at
 * rest. Scan-cache tables arrive in Phase 4.
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
    CREATE TABLE IF NOT EXISTS accounts (
      id             TEXT PRIMARY KEY,           -- Microsoft account id (oid/sub)
      email          TEXT,                       -- UPN / email, OAuth-derived (immutable)
      display_name   TEXT,                       -- OAuth-derived display name
      label          TEXT NOT NULL,              -- user-authored title (defaults to name/email)
      description    TEXT,                        -- user-authored one-liner (optional)
      accent         TEXT NOT NULL,              -- identity hue: indigo | teal | rose
      status         TEXT NOT NULL DEFAULT 'connected', -- connected | reconnect
      refresh_token  TEXT,                       -- AES-256-GCM encrypted (see lib/crypto)
      sort_order     INTEGER NOT NULL DEFAULT 0, -- fixed user-defined card order
      connected_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const globalForDb = globalThis as unknown as { __odmDb?: Database.Database };

export const db: Database.Database = globalForDb.__odmDb ?? createConnection();
if (process.env.NODE_ENV !== "production") globalForDb.__odmDb = db;
