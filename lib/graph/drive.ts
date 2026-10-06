import { graphJson } from "@/lib/graph/client";

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
