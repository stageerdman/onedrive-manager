import { db } from "@/lib/db";
import { getScanState } from "@/lib/graph/scan";

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

const COLS =
  "item_id, parent_id, name, is_folder, size, child_count, mime_type, created, modified";

export type ChildSort = "size" | "name" | "modified" | "created";

/** Context for a folder view: the read generation + resolved folder id. */
function readContext(accountId: string): { gen: number; rootId: string } | null {
  const scan = getScanState(accountId);
  if (scan.readGen == null || scan.rootId == null) return null;
  return { gen: scan.readGen, rootId: scan.rootId };
}

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
  const ctx = readContext(accountId);
  if (!ctx) return [];
  const parent = folderId ?? ctx.rootId;
  return db
    .prepare(
      `SELECT ${COLS} FROM items
       WHERE account_id = ? AND gen = ? AND parent_id = ?
       ORDER BY ${ORDER[sort]}`,
    )
    .all(accountId, ctx.gen, parent)
    .map((r) => toItem(r as ItemRow));
}

export function getItem(accountId: string, itemId: string): Item | null {
  const ctx = readContext(accountId);
  if (!ctx) return null;
  const row = db
    .prepare(`SELECT ${COLS} FROM items WHERE account_id = ? AND gen = ? AND item_id = ?`)
    .get(accountId, ctx.gen, itemId) as ItemRow | undefined;
  return row ? toItem(row) : null;
}

/** Path from root (exclusive) down to and including `itemId`. */
export function breadcrumbs(accountId: string, itemId: string): Item[] {
  const ctx = readContext(accountId);
  if (!ctx) return [];
  const chain: Item[] = [];
  let currentId: string | null = itemId;
  const seen = new Set<string>();
  while (currentId && currentId !== ctx.rootId && !seen.has(currentId)) {
    seen.add(currentId);
    const node = getItem(accountId, currentId);
    if (!node) break;
    chain.unshift(node);
    currentId = node.parentId;
  }
  return chain;
}

/** Account-wide files by size (spec #2 §5 "Biggest files"). */
export function biggestFiles(accountId: string, limit = 100): Item[] {
  const ctx = readContext(accountId);
  if (!ctx) return [];
  return db
    .prepare(
      `SELECT ${COLS} FROM items
       WHERE account_id = ? AND gen = ? AND is_folder = 0
       ORDER BY size DESC LIMIT ?`,
    )
    .all(accountId, ctx.gen, limit)
    .map((r) => toItem(r as ItemRow));
}

/** Account-wide folders by recursive size (spec #2 §5 "Biggest folders"). */
export function biggestFolders(accountId: string, limit = 100): Item[] {
  const ctx = readContext(accountId);
  if (!ctx) return [];
  return db
    .prepare(
      `SELECT ${COLS} FROM items
       WHERE account_id = ? AND gen = ? AND is_folder = 1 AND parent_id != ?
       ORDER BY size DESC LIMIT ?`,
    )
    .all(accountId, ctx.gen, ctx.rootId, limit)
    .map((r) => toItem(r as ItemRow));
}

/**
 * Stale files ranked by "Cleanup score" = size × age (spec #2 §5) — the single
 * most actionable ranking: big and long-untouched floats to the top. Age derived
 * from `modified` (the honest proxy; true last-accessed isn't available).
 */
export function staleFiles(accountId: string, limit = 100): Item[] {
  const ctx = readContext(accountId);
  if (!ctx) return [];
  return db
    .prepare(
      `SELECT ${COLS} FROM items
       WHERE account_id = ? AND gen = ? AND is_folder = 0 AND modified IS NOT NULL
       ORDER BY size * (julianday('now') - julianday(modified)) DESC LIMIT ?`,
    )
    .all(accountId, ctx.gen, limit)
    .map((r) => toItem(r as ItemRow));
}
