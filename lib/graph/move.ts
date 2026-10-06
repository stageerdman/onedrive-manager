import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { graphFetch, graphJson } from "@/lib/graph/client";

/**
 * Cross-account move: copy → verify → delete-source (Graph has no native move
 * between two different drives).
 *
 * Designed to survive the real world of a 64 GB folder:
 *  - **Idempotent / resumable.** The target folder is reused across runs; a file
 *    already present on the target with a matching size is skipped. So a failure
 *    (transient 503, network blip, even a restart) doesn't reset anything — Resume
 *    just continues with the files that aren't there yet, even the next day.
 *  - **Retries transient errors** (429/5xx) with backoff instead of aborting.
 *  - **Source is deleted only after the whole tree is verified** on the target.
 *  - A non-cancel failure parks the job as 'paused' (target kept for resume); an
 *    explicit cancel cleans up the partial target.
 *
 * Large files are copied server-to-server via upload-from-URL (bytes never route
 * through this machine); a resilient streaming path is the fallback.
 */

const CHUNK = 327_680 * 20; // ~6 MiB, multiple of 320 KiB (upload-session requirement)
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;

const running = new Set<string>();
const cancelled = new Set<string>();

class MoveCancelled extends Error {
  constructor() {
    super("Move cancelled.");
    this.name = "MoveCancelled";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function cancelMove(id: string): boolean {
  if (!running.has(id)) return false;
  cancelled.add(id);
  return true;
}

function throwIfCancelled(id: string): void {
  if (cancelled.has(id)) throw new MoveCancelled();
}

interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  folder?: { childCount?: number };
  file?: unknown;
  "@microsoft.graph.downloadUrl"?: string;
}
interface ChildrenPage {
  value: DriveItem[];
  "@odata.nextLink"?: string;
}

export type MoveStatus = "copying" | "verifying" | "deleting" | "complete" | "error" | "cancelled" | "paused";

export interface MoveState {
  id: string;
  status: MoveStatus;
  sourceAccount: string;
  targetAccount: string;
  itemName: string | null;
  isFolder: boolean;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  isRunning: boolean;
}

interface MoveRow {
  id: string;
  source_account: string;
  target_account: string;
  item_name: string | null;
  is_folder: number;
  status: MoveStatus;
  files_done: number;
  bytes_total: number;
  bytes_done: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

function rowToState(r: MoveRow): MoveState {
  const isRunning = running.has(r.id);
  // An "active" status with no live job (process died) is really paused/resumable.
  let status = r.status;
  if (!isRunning && (status === "copying" || status === "verifying" || status === "deleting")) {
    status = "paused";
  }
  return {
    id: r.id,
    status,
    sourceAccount: r.source_account,
    targetAccount: r.target_account,
    itemName: r.item_name,
    isFolder: !!r.is_folder,
    filesDone: r.files_done,
    bytesTotal: r.bytes_total,
    bytesDone: r.bytes_done,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    isRunning,
  };
}

const SELECT =
  "id, source_account, target_account, item_name, is_folder, status, files_done, bytes_total, bytes_done, error, started_at, finished_at";

export function getMoveState(id: string): MoveState | null {
  const r = db.prepare(`SELECT ${SELECT} FROM moves WHERE id = ?`).get(id) as MoveRow | undefined;
  return r ? rowToState(r) : null;
}

/** Active + recently-finished moves for the global tracker. */
export function listRecentMoves(limit = 10): MoveState[] {
  const rows = db
    .prepare(`SELECT ${SELECT} FROM moves ORDER BY started_at DESC LIMIT ?`)
    .all(limit) as MoveRow[];
  return rows.map(rowToState);
}

export function startMove(input: {
  sourceAccount: string;
  targetAccount: string;
  itemId: string;
}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO moves (id, source_account, target_account, item_id, status)
     VALUES (?, ?, ?, ?, 'copying')`,
  ).run(id, input.sourceAccount, input.targetAccount, input.itemId);
  launch(id, { ...input });
  return id;
}

/** Resume a paused/failed move — same source/target, continues where it left off. */
export function resumeMove(id: string): boolean {
  const row = db.prepare("SELECT source_account, target_account, item_id, status FROM moves WHERE id = ?").get(id) as
    | { source_account: string; target_account: string; item_id: string; status: MoveStatus }
    | undefined;
  if (!row) return false;
  if (running.has(id)) return true; // already going
  db.prepare("UPDATE moves SET status = 'copying', error = NULL, finished_at = NULL WHERE id = ?").run(id);
  launch(id, { sourceAccount: row.source_account, targetAccount: row.target_account, itemId: row.item_id });
  return true;
}

function launch(id: string, input: { sourceAccount: string; targetAccount: string; itemId: string }): void {
  running.add(id);
  void runMove(id, input).finally(() => {
    running.delete(id);
    cancelled.delete(id);
  });
}

function setProgress(id: string, filesDone: number, bytesDone: number) {
  db.prepare("UPDATE moves SET files_done = ?, bytes_done = ? WHERE id = ?").run(filesDone, bytesDone, id);
}
function newItemId(id: string): string | null {
  const r = db.prepare("SELECT new_item_id FROM moves WHERE id = ?").get(id) as { new_item_id: string | null } | undefined;
  return r?.new_item_id ?? null;
}

async function runMove(
  id: string,
  input: { sourceAccount: string; targetAccount: string; itemId: string },
): Promise<void> {
  const { sourceAccount, targetAccount, itemId } = input;
  const progress = { files: 0, bytes: 0 };

  try {
    const item = await graphJson<DriveItem>(
      sourceAccount,
      `/me/drive/items/${itemId}?$select=id,name,size,folder,file`,
    );
    const isFolder = !item.file;
    const name = item.name ?? "(unnamed)";
    db.prepare("UPDATE moves SET item_name = ?, is_folder = ?, bytes_total = ? WHERE id = ?").run(
      name,
      isFolder ? 1 : 0,
      item.size ?? 0,
      id,
    );

    const targetRoot = await graphJson<DriveItem>(targetAccount, "/me/drive/root?$select=id");

    if (isFolder) {
      // Reuse the target folder across runs; create it once.
      let destId = newItemId(id);
      if (destId) {
        const ok = await itemExists(targetAccount, destId);
        if (!ok) destId = null;
      }
      if (!destId) {
        destId = await createFolder(targetAccount, targetRoot.id, name);
        db.prepare("UPDATE moves SET new_item_id = ? WHERE id = ?").run(destId, id);
      }
      await copyFolder(sourceAccount, targetAccount, itemId, destId, id, progress);
    } else {
      // Single file. Skip if already present with matching size.
      const existing = await findChild(targetAccount, targetRoot.id, name);
      if (existing && existing.size === (item.size ?? 0)) {
        db.prepare("UPDATE moves SET new_item_id = ? WHERE id = ?").run(existing.id, id);
      } else {
        const up = await copyFile(sourceAccount, targetAccount, item, targetRoot.id, id, progress);
        if ((up.size ?? -1) !== (item.size ?? 0)) throw new Error(`Verification failed for "${name}".`);
        db.prepare("UPDATE moves SET new_item_id = ? WHERE id = ?").run(up.id, id);
      }
      progress.files += 1;
      progress.bytes += item.size ?? 0;
      setProgress(id, progress.files, progress.bytes);
    }

    // Everything copied + verified → delete source.
    db.prepare("UPDATE moves SET status = 'deleting' WHERE id = ?").run(id);
    const del = await graphFetch(sourceAccount, `/me/drive/items/${itemId}`, { method: "DELETE" });
    if (!del.ok && del.status !== 204) {
      throw new Error(`Copy done but deleting the source failed (${del.status}). Nothing lost — copy is on the target.`);
    }
    db.prepare("UPDATE moves SET status = 'complete', finished_at = datetime('now') WHERE id = ?").run(id);
  } catch (err) {
    if (err instanceof MoveCancelled) {
      const partial = newItemId(id);
      if (partial) {
        try {
          await graphFetch(targetAccount, `/me/drive/items/${partial}`, { method: "DELETE" });
        } catch {
          /* leave it */
        }
        db.prepare("UPDATE moves SET new_item_id = NULL WHERE id = ?").run(id);
      }
      db.prepare(
        "UPDATE moves SET status = 'cancelled', error = 'Cancelled. Source intact; partial copy removed.', finished_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else {
      // Keep the partial target copy and park as paused → resumable.
      const message = err instanceof Error ? err.message : "Move failed.";
      db.prepare(
        "UPDATE moves SET status = 'paused', error = ?, finished_at = datetime('now') WHERE id = ?",
      ).run(`${message} — Resume to continue.`, id);
    }
  }
}

/** Recursively reconcile a source folder into an existing target folder. */
async function copyFolder(
  sourceAccount: string,
  targetAccount: string,
  sourceFolderId: string,
  targetFolderId: string,
  moveId: string,
  progress: { files: number; bytes: number },
): Promise<void> {
  // Snapshot what's already on the target (for skip / find-or-create).
  const targetChildren = await listChildrenLive(targetAccount, targetFolderId);
  const byName = new Map(targetChildren.map((c) => [c.name ?? "", c]));

  let url: string | null = `/me/drive/items/${sourceFolderId}/children?$top=200&$select=id,name,size,folder,file`;
  let absolute = false;
  while (url) {
    throwIfCancelled(moveId);
    const page: ChildrenPage = await graphJson<ChildrenPage>(sourceAccount, url, { absolute });
    for (const child of page.value ?? []) {
      throwIfCancelled(moveId);
      const name = child.name ?? "(unnamed)";
      if (!child.file) {
        // folder: find-or-create on target, then recurse
        let destId = byName.get(name)?.id;
        if (!destId) destId = await createFolder(targetAccount, targetFolderId, name);
        await copyFolder(sourceAccount, targetAccount, child.id, destId, moveId, progress);
      } else {
        const existing = byName.get(name);
        if (existing && existing.size === (child.size ?? 0)) {
          // already copied in a previous run → skip, count as done
          progress.files += 1;
          progress.bytes += child.size ?? 0;
        } else {
          const up = await copyFile(sourceAccount, targetAccount, child, targetFolderId, moveId, progress);
          if ((up.size ?? -1) !== (child.size ?? 0)) throw new Error(`Verification failed for "${name}".`);
          progress.files += 1;
          progress.bytes += child.size ?? 0;
        }
        setProgress(moveId, progress.files, progress.bytes);
      }
    }
    const next: string | undefined = page["@odata.nextLink"];
    url = next ?? null;
    absolute = !!next;
  }
}

async function itemExists(account: string, itemId: string): Promise<boolean> {
  const res = await graphFetch(account, `/me/drive/items/${itemId}?$select=id`);
  return res.ok;
}

async function listChildrenLive(account: string, folderId: string): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let url: string | null = `/me/drive/items/${folderId}/children?$top=200&$select=id,name,size,folder,file`;
  let absolute = false;
  while (url) {
    const page: ChildrenPage = await graphJson<ChildrenPage>(account, url, { absolute });
    out.push(...(page.value ?? []));
    const next: string | undefined = page["@odata.nextLink"];
    url = next ?? null;
    absolute = !!next;
  }
  return out;
}

async function findChild(account: string, parentId: string, name: string): Promise<DriveItem | null> {
  const kids = await listChildrenLive(account, parentId);
  return kids.find((k) => k.name === name) ?? null;
}

async function createFolder(account: string, parentId: string, name: string): Promise<string> {
  const created = await graphJson<DriveItem>(account, `/me/drive/items/${parentId}/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" }),
  });
  return created.id;
}

/** fetch() with retry on transient network/5xx/429 errors. */
async function resilientFetch(url: string, init: RequestInit = {}, attempts = 6): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(Math.min(2 ** i, 30) * 1000);
  }
  throw lastErr instanceof Error ? lastErr : new Error("Network error");
}

async function getDownloadUrl(account: string, itemId: string, name: string): Promise<string> {
  const res = await graphFetch(account, `/me/drive/items/${itemId}/content`, { redirect: "manual" });
  const location = res.headers.get("location");
  if ((res.status === 302 || res.status === 301) && location) return location;
  const item = await graphJson<DriveItem>(account, `/me/drive/items/${itemId}?$select=@microsoft.graph.downloadUrl`);
  const url = item["@microsoft.graph.downloadUrl"];
  if (!url) throw new Error(`No download URL for "${name}" (status ${res.status}).`);
  return url;
}

async function copyFile(
  sourceAccount: string,
  targetAccount: string,
  item: DriveItem,
  targetParentId: string,
  moveId: string,
  progress: { files: number; bytes: number },
): Promise<DriveItem> {
  const name = item.name ?? "(unnamed)";
  const size = item.size ?? 0;
  const encoded = encodeURIComponent(name);
  const downloadUrl = await getDownloadUrl(sourceAccount, item.id, name);

  // Prefer server-to-server upload-from-URL (retried a couple of times).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await uploadFromUrl(targetAccount, targetParentId, name, downloadUrl, size, moveId, progress);
    } catch {
      await sleep(2000);
    }
  }

  // Fallback: route bytes through here (resiliently).
  if (size <= SIMPLE_UPLOAD_MAX) {
    const src = await resilientFetch(downloadUrl);
    if (!src.ok) throw new Error(`Download of "${name}" failed (${src.status}).`);
    const buf = new Uint8Array(await src.arrayBuffer());
    const res = await graphFetch(
      targetAccount,
      `/me/drive/items/${targetParentId}:/${encoded}:/content?@microsoft.graph.conflictBehavior=replace`,
      { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: buf },
    );
    if (!res.ok) throw new Error(`Upload of "${name}" failed (${res.status}).`);
    return (await res.json()) as DriveItem;
  }
  return streamLargeFile(targetAccount, targetParentId, encoded, name, size, downloadUrl);
}

async function uploadFromUrl(
  targetAccount: string,
  targetParentId: string,
  name: string,
  sourceUrl: string,
  size: number,
  moveId: string,
  progress: { files: number; bytes: number },
): Promise<DriveItem> {
  const res = await graphFetch(targetAccount, `/me/drive/items/${targetParentId}/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "respond-async" },
    body: JSON.stringify({
      name,
      file: {},
      "@microsoft.graph.sourceUrl": sourceUrl,
      "@microsoft.graph.conflictBehavior": "replace",
    }),
  });
  const monitorUrl = res.headers.get("location");
  if (res.status !== 202 || !monitorUrl) throw new Error(`Upload-from-URL not accepted (${res.status}).`);

  const started = Date.now();
  const MAX_MS = 6 * 60 * 60 * 1000;
  while (Date.now() - started < MAX_MS) {
    await sleep(3000);
    throwIfCancelled(moveId);
    let mon: Response;
    try {
      mon = await fetch(monitorUrl, { redirect: "manual", headers: { Accept: "application/json" } });
    } catch {
      continue; // transient; keep polling
    }
    if (mon.status >= 300 && mon.status < 400) {
      const loc = mon.headers.get("location");
      if (!loc) throw new Error(`Monitor redirect without location for "${name}".`);
      return graphJson<DriveItem>(targetAccount, `${loc}?$select=id,name,size`, { absolute: true });
    }
    if (mon.status === 200 || mon.status === 202) {
      const body = await mon.json().catch(() => null);
      if (body?.id && body?.size !== undefined) return { id: body.id, name: body.name, size: body.size };
      const status: string | undefined = body?.status;
      const pct = Number(body?.percentageComplete ?? 0);
      setProgress(moveId, progress.files, progress.bytes + Math.floor((size * pct) / 100));
      if (status === "completed" && body?.resourceId) {
        const resourceId = String(body.resourceId).replace(/^driveItem_/, "");
        return graphJson<DriveItem>(targetAccount, `/me/drive/items/${resourceId}?$select=id,name,size`);
      }
      if (status === "failed") throw new Error(`Target failed to fetch "${name}".`);
    } else if (mon.status === 429 || mon.status >= 500) {
      continue; // transient
    } else {
      throw new Error(`Monitor for "${name}" returned ${mon.status}.`);
    }
  }
  throw new Error(`Upload-from-URL for "${name}" timed out.`);
}

async function streamLargeFile(
  targetAccount: string,
  targetParentId: string,
  encodedName: string,
  name: string,
  size: number,
  downloadUrl: string,
): Promise<DriveItem> {
  const session = await graphJson<{ uploadUrl: string }>(
    targetAccount,
    `/me/drive/items/${targetParentId}:/${encodedName}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    },
  );
  const uploadUrl = session.uploadUrl;
  const src = await resilientFetch(downloadUrl);
  if (!src.ok || !src.body) throw new Error(`Download of "${name}" failed (${src.status}).`);
  const reader = src.body.getReader();

  let offset = 0;
  let carry = Buffer.alloc(0);
  let done = false;
  let lastItem: DriveItem | null = null;

  async function put(chunk: Buffer, start: number): Promise<void> {
    const end = start + chunk.length - 1;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Length": String(chunk.length), "Content-Range": `bytes ${start}-${end}/${size}` },
          body: new Uint8Array(chunk),
        });
        if (res.status === 200 || res.status === 201) {
          lastItem = (await res.json()) as DriveItem;
          return;
        }
        if (res.status === 202) return;
        if (res.status !== 429 && res.status < 500) {
          throw new Error(`Chunk upload for "${name}" failed (${res.status}).`);
        }
      } catch (e) {
        if (attempt === 5) throw e;
      }
      await sleep(Math.min(2 ** attempt, 30) * 1000);
    }
  }

  while (!done) {
    const { value, done: d } = await reader.read();
    if (value) carry = Buffer.concat([carry, Buffer.from(value)]);
    done = d;
    while (carry.length >= CHUNK) {
      await put(Buffer.from(carry.subarray(0, CHUNK)), offset);
      offset += CHUNK;
      carry = carry.subarray(CHUNK);
    }
  }
  if (carry.length > 0 || offset < size) await put(carry, offset);
  if (!lastItem) throw new Error(`Upload of "${name}" did not complete.`);
  return lastItem;
}
