import { db } from "@/lib/db";
import { graphJson } from "@/lib/graph/client";

/**
 * Recursive drive crawl into the cached `items` snapshot (spec #2 §8). The
 * explorer always reads the cache, never live Graph — this is the only writer.
 *
 * Generations: a scan fills `scanning_gen`; on success it becomes `committed_gen`
 * and older generations are pruned, so a re-scan never destroys the snapshot the
 * explorer is currently showing.
 *
 * Runs in-process, fire-and-forget (fine for a local single-process app). A
 * module-level set guards against two concurrent scans of the same account.
 */

const running = new Set<string>();

interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { id?: string };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

interface ChildrenPage {
  value: DriveItem[];
  "@odata.nextLink"?: string;
}

export interface ScanState {
  status: "idle" | "scanning" | "complete" | "partial" | "error";
  itemsCount: number;
  bytesCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** The generation the explorer should read (committed, else in-progress). */
  readGen: number | null;
  rootId: string | null;
  isRunning: boolean;
}

interface ScanRow {
  root_id: string | null;
  committed_gen: number | null;
  scanning_gen: number | null;
  status: ScanState["status"];
  items_count: number;
  bytes_count: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export function getScanState(accountId: string): ScanState {
  const row = db.prepare("SELECT * FROM scans WHERE account_id = ?").get(accountId) as
    | ScanRow
    | undefined;
  if (!row) {
    return {
      status: "idle",
      itemsCount: 0,
      bytesCount: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
      readGen: null,
      rootId: null,
      isRunning: running.has(accountId),
    };
  }
  return {
    status: row.status,
    itemsCount: row.items_count,
    bytesCount: row.bytes_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    readGen: row.committed_gen ?? row.scanning_gen,
    rootId: row.root_id,
    isRunning: running.has(accountId),
  };
}

const insertItem = () =>
  db.prepare(
    `INSERT OR REPLACE INTO items
       (account_id, gen, item_id, parent_id, name, is_folder, size, child_count, mime_type, created, modified)
     VALUES (@account_id, @gen, @item_id, @parent_id, @name, @is_folder, @size, @child_count, @mime_type, @created, @modified)`,
  );

/** Start a scan unless one is already running for this account. */
export function startScan(accountId: string): void {
  if (running.has(accountId)) return;
  running.add(accountId);
  // Fire-and-forget; errors are captured into the scans row.
  void runScan(accountId).finally(() => running.delete(accountId));
}

async function runScan(accountId: string): Promise<void> {
  const prev = db.prepare("SELECT committed_gen FROM scans WHERE account_id = ?").get(accountId) as
    | { committed_gen: number | null }
    | undefined;
  const gen = (prev?.committed_gen ?? 0) + 1;

  // Resolve the drive root.
  const root = await graphJson<DriveItem>(accountId, "/me/drive/root?$select=id,name");
  const rootId = root.id;

  db.prepare(
    `INSERT INTO scans (account_id, root_id, scanning_gen, status, items_count, bytes_count, started_at, finished_at, error)
     VALUES (@account_id, @root_id, @gen, 'scanning', 0, 0, datetime('now'), NULL, NULL)
     ON CONFLICT(account_id) DO UPDATE SET
       root_id = @root_id, scanning_gen = @gen, status = 'scanning',
       items_count = 0, bytes_count = 0, started_at = datetime('now'),
       finished_at = NULL, error = NULL`,
  ).run({ account_id: accountId, root_id: rootId, gen });

  const stmt = insertItem();
  const SELECT_FIELDS =
    "id,name,size,folder,file,parentReference,createdDateTime,lastModifiedDateTime";
  let itemsCount = 0;
  let bytesCount = 0;

  // Batch-insert each folder's children in a transaction, then recurse into
  // subfolders breadth-first.
  const queue: string[] = [rootId];
  try {
    while (queue.length > 0) {
      const folderId = queue.shift()!;
      let url: string | null =
        `/me/drive/items/${folderId}/children?$top=200&$select=${SELECT_FIELDS}`;
      let absolute = false;

      while (url) {
        const page: ChildrenPage = await graphJson<ChildrenPage>(accountId, url, { absolute });
        const children = page.value ?? [];
        const subfolders: string[] = [];

        const insertBatch = db.transaction((rows: DriveItem[]) => {
          for (const it of rows) {
            const isFolder = it.folder ? 1 : 0;
            stmt.run({
              account_id: accountId,
              gen,
              item_id: it.id,
              parent_id: it.parentReference?.id ?? folderId,
              name: it.name ?? "(unnamed)",
              is_folder: isFolder,
              size: it.size ?? 0,
              child_count: it.folder?.childCount ?? 0,
              mime_type: it.file?.mimeType ?? null,
              created: it.createdDateTime ?? null,
              modified: it.lastModifiedDateTime ?? null,
            });
            if (isFolder) {
              subfolders.push(it.id);
            } else {
              bytesCount += it.size ?? 0;
            }
            itemsCount++;
          }
        });
        insertBatch(children);
        queue.push(...subfolders);

        const next = page["@odata.nextLink"];
        url = next ?? null;
        absolute = !!next;
      }

      // Progress heartbeat after each folder.
      db.prepare("UPDATE scans SET items_count = ?, bytes_count = ? WHERE account_id = ?").run(
        itemsCount,
        bytesCount,
        accountId,
      );
    }

    // Success: commit this generation and prune older ones.
    db.prepare(
      `UPDATE scans SET status = 'complete', committed_gen = ?, scanning_gen = NULL,
         items_count = ?, bytes_count = ?, finished_at = datetime('now') WHERE account_id = ?`,
    ).run(gen, itemsCount, bytesCount, accountId);
    db.prepare("DELETE FROM items WHERE account_id = ? AND gen != ?").run(accountId, gen);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    // Keep whatever we gathered, mark partial so the UI can offer Resume.
    db.prepare(
      `UPDATE scans SET status = 'partial', error = ?, finished_at = datetime('now') WHERE account_id = ?`,
    ).run(message, accountId);
  }
}
