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

  // One-time migration from the old generation-based full-scan cache to the lazy,
  // per-folder model. The items/scans tables are pure cache (rebuilt by browsing),
  // so dropping them loses nothing but a snapshot.
  const itemCols = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  if (itemCols.some((c) => c.name === "gen")) {
    db.exec("DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS scans;");
  }

  db.exec(`
    -- Per-account drive metadata (root id + optional full-scan status for analysis).
    CREATE TABLE IF NOT EXISTS scans (
      account_id    TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      root_id       TEXT,
      full_status   TEXT NOT NULL DEFAULT 'none', -- none|scanning|complete|partial|error
      full_items    INTEGER NOT NULL DEFAULT 0,
      full_finished_at TEXT,
      full_error    TEXT
    );

    -- Lazily-cached drive items. Each folder's direct children are fetched on open
    -- (children_fetched flags that). OneDrive folder 'size' is already the recursive
    -- rollup, so per-folder size is correct even without a full crawl.
    CREATE TABLE IF NOT EXISTS items (
      account_id       TEXT NOT NULL,
      item_id          TEXT NOT NULL,
      parent_id        TEXT,
      name             TEXT NOT NULL,
      is_folder        INTEGER NOT NULL DEFAULT 0,
      size             INTEGER NOT NULL DEFAULT 0,
      child_count      INTEGER NOT NULL DEFAULT 0,
      mime_type        TEXT,
      created          TEXT,
      modified         TEXT,
      children_fetched INTEGER NOT NULL DEFAULT 0,  -- have this folder's children been loaded?
      fetched_at       TEXT,                         -- when this folder was last loaded
      PRIMARY KEY (account_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_items_children ON items (account_id, parent_id);
    CREATE INDEX IF NOT EXISTS idx_items_folder_size ON items (account_id, is_folder, size);
    CREATE INDEX IF NOT EXISTS idx_items_modified ON items (account_id, modified);

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
