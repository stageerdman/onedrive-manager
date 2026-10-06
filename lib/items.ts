import { db } from "@/lib/db";

/** A cached drive item as the explorer consumes it. */
export interface Item {
  id: string;
  parentId: string | null;
  name: string;
  isFolder: boolean;
  size: number;
  childCount: number;
  mimeType: string | null;
  created: string | null;
  modified: string | null;
}

interface ItemRow {
  item_id: string;
  parent_id: string | null;
  name: string;
  is_folder: number;
  size: number;
  child_count: number;
  mime_type: string | null;
  created: string | null;
  modified: string | null;
}

function toItem(r: ItemRow): Item {
  return {
    id: r.item_id,
    parentId: r.parent_id,
    name: r.name,
    isFolder: !!r.is_folder,
    size: r.size,
    childCount: r.child_count,
    mimeType: r.mime_type,
    created: r.created,
    modified: r.modified,
  };
}

const COLS = "item_id, parent_id, name, is_folder, size, child_count, mime_type, created, modified";

/** Synchronously read the cached root id (ensureChildren/getRootId populates it). */
export function readRootId(accountId: string): string | null {
  const row = db.prepare("SELECT root_id FROM scans WHERE account_id = ?").get(accountId) as
    | { root_id: string | null }
    | undefined;
  return row?.root_id ?? null;
}

export type ChildSort = "size" | "name" | "modified" | "created";

const ORDER: Record<ChildSort, string> = {
  size: "is_folder DESC, size DESC",
  name: "name COLLATE NOCASE ASC",
  modified: "modified DESC",
  created: "created DESC",
};

/** Direct children of a folder (root when folderId omitted), sorted. */
export function listChildren(
  accountId: string,
  folderId: string | null,
  sort: ChildSort = "size",
): Item[] {
  const parent = folderId ?? readRootId(accountId);
  if (!parent) return [];
  return db
    .prepare(`SELECT ${COLS} FROM items WHERE account_id = ? AND parent_id = ? ORDER BY ${ORDER[sort]}`)
    .all(accountId, parent)
    .map((r) => toItem(r as ItemRow));
}

export function getItem(accountId: string, itemId: string): Item | null {
  const row = db
    .prepare(`SELECT ${COLS} FROM items WHERE account_id = ? AND item_id = ?`)
    .get(accountId, itemId) as ItemRow | undefined;
  return row ? toItem(row) : null;
}

/** Path from root (exclusive) down to and including `itemId`. */
export function breadcrumbs(accountId: string, itemId: string): Item[] {
  const rootId = readRootId(accountId);
  const chain: Item[] = [];
  let currentId: string | null = itemId;
  const seen = new Set<string>();
  while (currentId && currentId !== rootId && !seen.has(currentId)) {
    seen.add(currentId);
    const node = getItem(accountId, currentId);
    if (!node) break;
    chain.unshift(node);
    currentId = node.parentId;
  }
  return chain;
}

/**
 * Account-wide analysis over whatever is cached. With lazy browsing this covers the
 * folders opened so far; a full scan makes it complete. The root row is excluded.
 */
export function biggestFiles(accountId: string, limit = 100): Item[] {
  return db
    .prepare(
      `SELECT ${COLS} FROM items WHERE account_id = ? AND is_folder = 0 ORDER BY size DESC LIMIT ?`,
    )
    .all(accountId, limit)
    .map((r) => toItem(r as ItemRow));
}

export function biggestFolders(accountId: string, limit = 100): Item[] {
  return db
    .prepare(
      `SELECT ${COLS} FROM items
       WHERE account_id = ? AND is_folder = 1 AND parent_id IS NOT NULL
       ORDER BY size DESC LIMIT ?`,
    )
    .all(accountId, limit)
    .map((r) => toItem(r as ItemRow));
}

/** Stale files by "Cleanup score" = size × age (age from `modified`, the honest proxy). */
export function staleFiles(accountId: string, limit = 100): Item[] {
  return db
    .prepare(
      `SELECT ${COLS} FROM items
       WHERE account_id = ? AND is_folder = 0 AND modified IS NOT NULL
       ORDER BY size * (julianday('now') - julianday(modified)) DESC LIMIT ?`,
    )
    .all(accountId, limit)
    .map((r) => toItem(r as ItemRow));
}
