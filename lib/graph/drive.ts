import { getSetting, setSetting } from "@/lib/db";
import { graphJson } from "@/lib/graph/client";
import { log } from "@/lib/log";

/**
 * Drive-level reads: storage quota and the drive's own identity. The explorer's
 * item crawl lives in the scan module (Phase 4); this is just the headline
 * numbers the overview needs.
 */

export interface DriveQuota {
  /** Bytes. `total`/`used`/`remaining` come straight from Graph. */
  total: number;
  used: number;
  remaining: number;
  /** Graph's own pressure hint: normal | nearing | critical | exceeded. */
  state: string;
  /** Fraction used in [0, 1], clamped. */
  fraction: number;
}

interface GraphDrive {
  id: string;
  quota?: {
    total?: number;
    used?: number;
    remaining?: number;
    deleted?: number;
    state?: string;
  };
}

export async function getDriveQuota(accountId: string): Promise<DriveQuota> {
  const drive = await graphJson<GraphDrive>(accountId, "/me/drive?$select=id,quota");
  const q = drive.quota ?? {};
  const total = q.total ?? 0;
  const used = q.used ?? 0;
  const remaining = q.remaining ?? Math.max(total - used, 0);
  const fraction = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0;
  return { total, used, remaining, state: q.state ?? "normal", fraction };
}

/**
 * Quota for page renders: never makes a page wait on Graph when we know an answer.
 * Graph's /me/drive can take 5–30 s (and sometimes 504s), which made every tab switch
 * hang. The last good value is kept in the DB; a value older than FRESH_MS is served
 * as-is and refreshed in the background. Only an account with no known quota waits
 * (bounded by FIRST_LOAD_MS). Errors (incl. ReconnectNeededError) are thrown only then.
 */
const FRESH_MS = 60_000;
const FIRST_LOAD_MS = 8_000;
const refreshing = ((globalThis as { __odmQuotaRefresh?: Map<string, Promise<DriveQuota>> }).__odmQuotaRefresh ??=
  new Map());

function refreshQuota(accountId: string): Promise<DriveQuota> {
  let p = refreshing.get(accountId);
  if (!p) {
    p = getDriveQuota(accountId)
      .then((q) => {
        setSetting(`quota:${accountId}`, JSON.stringify({ at: Date.now(), q }));
        return q;
      })
      .finally(() => refreshing.delete(accountId));
    refreshing.set(accountId, p);
  }
  return p;
}

export async function getDriveQuotaCached(accountId: string): Promise<DriveQuota> {
  const raw = getSetting(`quota:${accountId}`);
  const cached = raw ? (JSON.parse(raw) as { at: number; q: DriveQuota }) : null;
  if (cached) {
    if (Date.now() - cached.at > FRESH_MS) {
      refreshQuota(accountId).catch((e) => log("warn", "quota", "refresh-failed", { accountId, error: e }));
    }
    return cached.q;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      refreshQuota(accountId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Quota is taking too long.")), FIRST_LOAD_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
