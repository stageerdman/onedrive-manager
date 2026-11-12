import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

export type AccountStatus = "connected" | "reconnect";
export type Accent = "indigo" | "teal" | "rose";

/** The three identity hues, assigned by connection order (spec #1 §8). */
const ACCENTS: Accent[] = ["indigo", "teal", "rose"];

export interface Account {
  id: string;
  email: string | null;
  displayName: string | null;
  label: string;
  description: string | null;
  accent: Accent;
  status: AccountStatus;
  sortOrder: number;
  connectedAt: string;
  /**
   * When access lapses if the app isn't used: Microsoft personal-account refresh
   * tokens expire after 90 days of inactivity, and every refresh re-issues one.
   */
  accessExpiresAt: string;
}

/** Sliding lifetime of a Microsoft personal-account refresh token. */
const REFRESH_TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

interface AccountRow {
  id: string;
  email: string | null;
  display_name: string | null;
  label: string;
  description: string | null;
  accent: Accent;
  status: AccountStatus;
  sort_order: number;
  connected_at: string;
  token_refreshed_at: string | null;
  updated_at: string;
}

/** SQLite `datetime('now')` is UTC without a zone marker. */
const sqliteUtc = (s: string) => Date.parse(`${s.replace(" ", "T")}Z`);

function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    label: r.label,
    description: r.description,
    accent: r.accent,
    status: r.status,
    sortOrder: r.sort_order,
    connectedAt: r.connected_at,
    accessExpiresAt: new Date(
      sqliteUtc(r.token_refreshed_at ?? r.updated_at) + REFRESH_TOKEN_LIFETIME_MS,
    ).toISOString(),
  };
}

const SELECT = `
  SELECT id, email, display_name, label, description, accent, status, sort_order, connected_at,
         token_refreshed_at, updated_at
  FROM accounts
`;

export function listAccounts(): Account[] {
  return db
    .prepare(`${SELECT} ORDER BY sort_order ASC, connected_at ASC`)
    .all()
    .map((r) => toAccount(r as AccountRow));
}

export function getAccount(id: string): Account | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as AccountRow | undefined;
  return row ? toAccount(row) : null;
}

export function accountExists(id: string): boolean {
  return db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id) !== undefined;
}

export function countAccounts(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
}

/** Insert a freshly connected account. Assigns the next free accent + sort order. */
export function upsertConnectedAccount(input: {
  id: string;
  email: string | null;
  displayName: string | null;
  refreshToken: string;
}): Account {
  const existing = getAccount(input.id);
  const n = countAccounts();
  const accent: Accent = existing?.accent ?? ACCENTS[n % ACCENTS.length];
  const sortOrder = existing?.sortOrder ?? n;
  const label = existing?.label ?? input.displayName ?? input.email ?? "OneDrive";

  db.prepare(
    `INSERT INTO accounts (id, email, display_name, label, description, accent, status, refresh_token, sort_order, connected_at, updated_at, token_refreshed_at)
     VALUES (@id, @email, @display_name, @label, @description, @accent, 'connected', @refresh_token, @sort_order, datetime('now'), datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       status = 'connected',
       refresh_token = excluded.refresh_token,
       token_refreshed_at = datetime('now'),
       updated_at = datetime('now')`,
  ).run({
    id: input.id,
    email: input.email,
    display_name: input.displayName,
    label,
    description: existing?.description ?? null,
    accent,
    refresh_token: encrypt(input.refreshToken),
    sort_order: sortOrder,
  });

  return getAccount(input.id)!;
}

export function getRefreshToken(id: string): string | null {
  const row = db.prepare("SELECT refresh_token FROM accounts WHERE id = ?").get(id) as
    | { refresh_token: string | null }
    | undefined;
  if (!row?.refresh_token) return null;
  return decrypt(row.refresh_token);
}

export function setRefreshToken(id: string, refreshToken: string): void {
  db.prepare(
    "UPDATE accounts SET refresh_token = ?, token_refreshed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  ).run(
    encrypt(refreshToken),
    id,
  );
}

export function setStatus(id: string, status: AccountStatus): void {
  db.prepare("UPDATE accounts SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function updateLabelDescription(
  id: string,
  fields: { label?: string; description?: string | null },
): Account | null {
  const current = getAccount(id);
  if (!current) return null;
  db.prepare(
    "UPDATE accounts SET label = ?, description = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(
    fields.label ?? current.label,
    fields.description === undefined ? current.description : fields.description,
    id,
  );
  return getAccount(id);
}

export function disconnectAccount(id: string): void {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
}
