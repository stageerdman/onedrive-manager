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
