import { db } from "@/lib/db";
import { graphJson } from "@/lib/graph/client";

/**
 * Lazy drive caching. The explorer loads **one folder level at a time**: a folder's
 * direct children are fetched from Graph the first time it's opened and cached, so
 * a big drive is instantly browsable at the surface and deeper folders fill in as
 * you go — no up-front full crawl.
 *
 * OneDrive reports each folder's `size` as the recursive rollup of its contents, so
 * per-folder sizes are correct even when only one level has been fetched.
 *
 * An optional **full scan** walks everything (for account-wide analysis). It reuses
 * the same per-folder fetch and is cancellable.
 */

interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  package?: unknown;
  parentReference?: { id?: string };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

interface ChildrenPage {
  value: DriveItem[];
  "@odata.nextLink"?: string;
}

/**
 * Folder vs file: an item is a FILE only if it carries a `file` facet. Everything
 * else — plain folders, OneNote/packages, bundles, and special folders like
 * Personal Vault (which lack a `folder` facet) — is treated as a container.
 */
function isFolderItem(it: DriveItem): boolean {
  return !it.file;
}

/** Resolve (and cache) the drive's root item id. */
export async function getRootId(accountId: string): Promise<string> {
  const row = db.prepare("SELECT root_id FROM scans WHERE account_id = ?").get(accountId) as
    | { root_id: string | null }
    | undefined;
  if (row?.root_id) return row.root_id;

  const root = await graphJson<DriveItem>(accountId, "/me/drive/root?$select=id,name,size,folder");
  db.prepare(
    `INSERT INTO scans (account_id, root_id) VALUES (?, ?)
     ON CONFLICT(account_id) DO UPDATE SET root_id = excluded.root_id`,
  ).run(accountId, root.id);
  // Store the root as an item row so children_fetched/breadcrumbs work uniformly.
  db.prepare(
    `INSERT INTO items (account_id, item_id, parent_id, name, is_folder, size, child_count, children_fetched)
     VALUES (@a, @id, NULL, @name, 1, @size, @cc, 0)
     ON CONFLICT(account_id, item_id) DO UPDATE SET size = @size, child_count = @cc`,
  ).run({ a: accountId, id: root.id, name: root.name ?? "OneDrive", size: root.size ?? 0, cc: root.folder?.childCount ?? 0 });
  return root.id;
}

const upsertChild = () =>
  db.prepare(
    `INSERT INTO items
       (account_id, item_id, parent_id, name, is_folder, size, child_count, mime_type, created, modified, children_fetched)
     VALUES (@account_id, @item_id, @parent_id, @name, @is_folder, @size, @child_count, @mime_type, @created, @modified, 0)
     ON CONFLICT(account_id, item_id) DO UPDATE SET
       parent_id = @parent_id, name = @name, is_folder = @is_folder, size = @size,
       child_count = @child_count, mime_type = @mime_type, created = @created, modified = @modified`,
  );

/**
 * Ensure a folder's direct children are cached, fetching live only when needed.
 * `force` re-fetches even if cached (the per-folder "refresh"). Returns the
 * resolved folder id. Safe to call on every explorer render.
 */
export async function ensureChildren(
  accountId: string,
  folderId: string | null,
  opts: { force?: boolean } = {},
): Promise<string> {
  const targetId = folderId ?? (await getRootId(accountId));

  const meta = db
    .prepare("SELECT children_fetched FROM items WHERE account_id = ? AND item_id = ?")
    .get(accountId, targetId) as { children_fetched: number } | undefined;
  if (!opts.force && meta?.children_fetched) return targetId;

  const children: DriveItem[] = [];
  let url: string | null =
    `/me/drive/items/${targetId}/children?$top=200&$select=id,name,size,folder,file,package,parentReference,createdDateTime,lastModifiedDateTime`;
  let absolute = false;
  while (url) {
    const page: ChildrenPage = await graphJson<ChildrenPage>(accountId, url, { absolute });
    children.push(...(page.value ?? []));
    const next: string | undefined = page["@odata.nextLink"];
    url = next ?? null;
    absolute = !!next;
  }

  const stmt = upsertChild();
  const write = db.transaction(() => {
    // Drop direct children that no longer exist, then upsert the fresh set.
    db.prepare("DELETE FROM items WHERE account_id = ? AND parent_id = ?").run(accountId, targetId);
    for (const it of children) {
      const folder = isFolderItem(it);
      stmt.run({
        account_id: accountId,
        item_id: it.id,
        parent_id: targetId,
        name: it.name ?? "(unnamed)",
        is_folder: folder ? 1 : 0,
        size: it.size ?? 0,
        child_count: it.folder?.childCount ?? 0,
        mime_type: folder ? null : (it.file?.mimeType ?? null),
        created: it.createdDateTime ?? null,
        modified: it.lastModifiedDateTime ?? null,
      });
    }
    db.prepare(
      "UPDATE items SET children_fetched = 1, fetched_at = datetime('now') WHERE account_id = ? AND item_id = ?",
    ).run(accountId, targetId);
  });
  write();
  return targetId;
}

/** When a folder's children were last loaded (for the "loaded Xm ago" hint). */
export function getFolderFetchedAt(accountId: string, folderId: string): string | null {
  const row = db
    .prepare("SELECT fetched_at FROM items WHERE account_id = ? AND item_id = ?")
    .get(accountId, folderId) as { fetched_at: string | null } | undefined;
  return row?.fetched_at ?? null;
}

// ─── Optional full scan (for account-wide analysis) ──────────────────────────

const runningFull = new Set<string>();
const cancelledFull = new Set<string>();

class ScanCancelled extends Error {
  constructor() {
    super("Scan cancelled.");
    this.name = "ScanCancelled";
  }
}

export interface FullScanState {
  status: "none" | "scanning" | "complete" | "partial" | "error";
  items: number;
  finishedAt: string | null;
  error: string | null;
  isRunning: boolean;
}

export function getFullScanState(accountId: string): FullScanState {
  const row = db
    .prepare("SELECT full_status, full_items, full_finished_at, full_error FROM scans WHERE account_id = ?")
    .get(accountId) as
    | { full_status: FullScanState["status"]; full_items: number; full_finished_at: string | null; full_error: string | null }
    | undefined;
  return {
    status: row?.full_status ?? "none",
    items: row?.full_items ?? 0,
    finishedAt: row?.full_finished_at ?? null,
    error: row?.full_error ?? null,
    isRunning: runningFull.has(accountId),
  };
}

export function cancelFullScan(accountId: string): boolean {
  if (!runningFull.has(accountId)) return false;
  cancelledFull.add(accountId);
  return true;
}

export function startFullScan(accountId: string): void {
  if (runningFull.has(accountId)) return;
  runningFull.add(accountId);
  void runFullScan(accountId).finally(() => {
    runningFull.delete(accountId);
    cancelledFull.delete(accountId);
  });
}

async function runFullScan(accountId: string): Promise<void> {
  db.prepare(
    `INSERT INTO scans (account_id, full_status, full_items, full_finished_at, full_error)
     VALUES (?, 'scanning', 0, NULL, NULL)
     ON CONFLICT(account_id) DO UPDATE SET full_status='scanning', full_items=0, full_finished_at=NULL, full_error=NULL`,
  ).run(accountId);

  let count = 0;
  try {
    const rootId = await getRootId(accountId);
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      if (cancelledFull.has(accountId)) throw new ScanCancelled();
      const folderId = queue.shift()!;
      await ensureChildren(accountId, folderId, { force: true });
      const subfolders = db
        .prepare("SELECT item_id FROM items WHERE account_id = ? AND parent_id = ? AND is_folder = 1")
        .all(accountId, folderId) as { item_id: string }[];
      for (const s of subfolders) queue.push(s.item_id);
      count = (db.prepare("SELECT COUNT(*) n FROM items WHERE account_id = ?").get(accountId) as { n: number }).n;
      db.prepare("UPDATE scans SET full_items = ? WHERE account_id = ?").run(count, accountId);
    }
    db.prepare(
      "UPDATE scans SET full_status='complete', full_items=?, full_finished_at=datetime('now') WHERE account_id=?",
    ).run(count, accountId);
  } catch (err) {
    const cancelled = err instanceof ScanCancelled;
    db.prepare(
      "UPDATE scans SET full_status=?, full_error=?, full_finished_at=datetime('now') WHERE account_id=?",
    ).run(cancelled ? "partial" : "error", cancelled ? "Cancelled — analysis covers folders scanned so far." : (err instanceof Error ? err.message : "Scan failed."), accountId);
  }
}
