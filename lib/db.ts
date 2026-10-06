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

    -- One scan record per account. 'generation' lets a re-scan fill a new snapshot
    -- while the explorer keeps reading the committed one, then swap atomically.
    CREATE TABLE IF NOT EXISTS scans (
      account_id    TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      root_id       TEXT,
      committed_gen INTEGER,                      -- generation the explorer reads
      scanning_gen  INTEGER,                      -- generation being filled right now
      status        TEXT NOT NULL DEFAULT 'idle', -- idle|scanning|complete|partial|error
      items_count   INTEGER NOT NULL DEFAULT 0,
      bytes_count   INTEGER NOT NULL DEFAULT 0,
      started_at    TEXT,
      finished_at   TEXT,
      error         TEXT
    );

    -- Cached snapshot of drive items. OneDrive folder 'size' is already the
    -- recursive rollup of its contents, so size is stored directly.
    CREATE TABLE IF NOT EXISTS items (
      account_id  TEXT NOT NULL,
      gen         INTEGER NOT NULL,
      item_id     TEXT NOT NULL,
      parent_id   TEXT,
      name        TEXT NOT NULL,
      is_folder   INTEGER NOT NULL DEFAULT 0,
      size        INTEGER NOT NULL DEFAULT 0,
      child_count INTEGER NOT NULL DEFAULT 0,
      mime_type   TEXT,
      created     TEXT,
      modified    TEXT,
      PRIMARY KEY (account_id, gen, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_items_children ON items (account_id, gen, parent_id);
    CREATE INDEX IF NOT EXISTS idx_items_folder_size ON items (account_id, gen, is_folder, size);
    CREATE INDEX IF NOT EXISTS idx_items_modified ON items (account_id, gen, modified);

    -- Cross-account move jobs. Safe-by-design: copy whole subtree → verify → then
    -- delete the source. Progress is tracked so the UI can show it and resume context.
    CREATE TABLE IF NOT EXISTS moves (
      id              TEXT PRIMARY KEY,
      source_account  TEXT NOT NULL,
      target_account  TEXT NOT NULL,
      item_id         TEXT NOT NULL,
      item_name       TEXT,
      is_folder       INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'copying', -- copying|verifying|deleting|complete|error
      files_total     INTEGER NOT NULL DEFAULT 0,
      files_done      INTEGER NOT NULL DEFAULT 0,
      bytes_total     INTEGER NOT NULL DEFAULT 0,
      bytes_done      INTEGER NOT NULL DEFAULT 0,
      new_item_id     TEXT,                            -- id of the copy on the target
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at     TEXT,
      error           TEXT
    );
  `);
}

const globalForDb = globalThis as unknown as { __odmDb?: Database.Database };

export const db: Database.Database = globalForDb.__odmDb ?? createConnection();
if (process.env.NODE_ENV !== "production") globalForDb.__odmDb = db;
