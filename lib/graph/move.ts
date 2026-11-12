import { randomUUID } from "node:crypto";
import { db, getSetting, setSetting } from "@/lib/db";
import { graphFetch, graphJson } from "@/lib/graph/client";

/**
 * Cross-account transfers: copy → verify → delete-source (Graph has no native move
 * between two different drives), run as a **priority queue**.
 *
 * Designed to survive the real world of a 64 GB folder:
 *  - **Idempotent / resumable.** The target folder is reused across runs; a file
 *    already present on the target with a matching size is skipped. So a pause,
 *    preemption, failure or restart doesn't reset anything — the next run just
 *    continues with the files that aren't there yet.
 *  - **Retries transient errors** (429/5xx) with backoff instead of aborting.
 *  - **Source is deleted only after the whole tree is verified** on the target.
 *
 * Queue: one transfer runs at a time — the runnable row with the lowest `priority`.
 * Reordering something above the active transfer preempts it (it goes back to
 * `queued` and later resumes where it got to). A global pause stops the active one
 * the same way and starts nothing until resumed. Removing a transfer cleans up its
 * partial copy on the target; the source is never touched.
 *
 * Bytes stream through this machine chunk by chunk (nothing is written to disk);
 * the live per-file download/upload counters are kept in memory for the UI.
 */

const CHUNK = 327_680 * 20; // ~6 MiB, multiple of 320 KiB (upload-session requirement)
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const HEARTBEAT_MS = 5_000;
const HEARTBEAT_STALE_MS = 20_000;
const PAUSED_KEY = "transfers_paused";

/**
 * Whether this process may run transfers. Set ODM_TRANSFERS_WORKER=0 for a second
 * server (e.g. a dev server next to the installed app) so it never runs a job.
 */
const IS_WORKER = process.env.ODM_TRANSFERS_WORKER !== "0";

type StopReason = "cancel" | "pause";

interface LiveFile {
  name: string;
  size: number;
  downloaded: number; // bytes read from the source so far
  uploaded: number; // bytes accepted by the target so far
  serverSide: boolean; // target pulls straight from source (nothing via this machine)
}

// Process-wide, not module-wide: in a production build, instrumentation.ts (which
// auto-resumes transfers on boot) and the route handlers get *separate* instances of
// this module. Module-level state would make a boot-resumed transfer invisible to the API.
const state = ((globalThis as { __odmMoveQueue?: ProcessMoveState }).__odmMoveQueue ??= {
  running: new Set<string>(),
  stopping: new Map<string, StopReason>(),
  serverSideCap: new Map<string, boolean>(), // moveId -> does upload-from-URL work?
  live: new Map<string, LiveFile>(),
});
type ProcessMoveState = {
  running: Set<string>;
  stopping: Map<string, StopReason>;
  serverSideCap: Map<string, boolean>;
  live: Map<string, LiveFile>;
};
const { running, stopping, serverSideCap, live } = state;

class MoveStopped extends Error {
  constructor(public reason: StopReason) {
    super(reason === "cancel" ? "Transfer removed." : "Transfer paused.");
    this.name = "MoveStopped";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function throwIfStopped(id: string): void {
  const reason = stopping.get(id);
  if (reason) throw new MoveStopped(reason);
}

/** Sleep in short slices so a pause/remove takes effect promptly. */
async function sleepUnlessStopped(id: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    throwIfStopped(id);
    await sleep(Math.min(1000, until - Date.now()));
  }
  throwIfStopped(id);
}

function liveUpdate(id: string | undefined, patch: Partial<LiveFile>): void {
  if (!id) return;
  const cur = live.get(id);
  if (cur) live.set(id, { ...cur, ...patch });
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

/**
 * `queued`   waiting its turn (or interrupted — it resumes where it got to)
 * `stalled`  stopped after repeated failures; needs a manual retry
 */
export type MoveStatus = "queued" | "copying" | "deleting" | "complete" | "stalled";

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
  /** A transient error being auto-retried, or why the transfer stalled. */
  error: string | null;
  priority: number;
  startedAt: string | null;
  finishedAt: string | null;
  isRunning: boolean;
  /** The file streaming right now (only for the running transfer, in this process). */
  current: LiveFile | null;
}

interface MoveRow {
  id: string;
  source_account: string;
  target_account: string;
  item_id: string;
  item_name: string | null;
  is_folder: number;
  status: string;
  files_done: number;
  bytes_total: number;
  bytes_done: number;
  error: string | null;
  priority: number;
  heartbeat_at: number | null;
  started_at: string | null;
  finished_at: string | null;
}

const ACTIVE = ["queued", "copying", "verifying", "deleting"];

/** Running here, or heart-beating in another server process. */
function isLive(r: Pick<MoveRow, "id" | "heartbeat_at">): boolean {
  return running.has(r.id) || (r.heartbeat_at != null && Date.now() - r.heartbeat_at < HEARTBEAT_STALE_MS);
}

function rowToState(r: MoveRow): MoveState {
  const isRunning = isLive(r);
  let status: MoveStatus;
  if (r.status === "complete") status = "complete";
  else if (r.status === "paused" || r.status === "error" || r.status === "stalled") status = "stalled";
  else if (!isRunning) status = "queued";
  else status = r.status === "deleting" ? "deleting" : "copying";
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
    priority: r.priority,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    isRunning,
    current: live.get(r.id) ?? null,
  };
}

const SELECT =
  "id, source_account, target_account, item_id, item_name, is_folder, status, files_done, bytes_total, bytes_done, error, priority, heartbeat_at, started_at, finished_at";

export function getMoveState(id: string): MoveState | null {
  const r = db.prepare(`SELECT ${SELECT} FROM moves WHERE id = ?`).get(id) as MoveRow | undefined;
  return r ? rowToState(r) : null;
}

/** The queue (priority order) followed by the most recently finished transfers. */
export function listMoves(): { paused: boolean; moves: MoveState[] } {
  const queue = db
    .prepare(`SELECT ${SELECT} FROM moves WHERE status NOT IN ('complete', 'cancelled') ORDER BY priority, started_at`)
    .all() as MoveRow[];
  const done = db
    .prepare(`SELECT ${SELECT} FROM moves WHERE status = 'complete' ORDER BY finished_at DESC LIMIT 20`)
    .all() as MoveRow[];
  return { paused: isQueuePaused(), moves: [...queue, ...done].map(rowToState) };
}

export function isQueuePaused(): boolean {
  return getSetting(PAUSED_KEY) === "1";
}

/** Add a transfer to the bottom of the queue. */
export function startMove(input: { sourceAccount: string; targetAccount: string; itemId: string }): string {
  const id = randomUUID();
  const { p } = db.prepare("SELECT COALESCE(MAX(priority), -1) + 1 AS p FROM moves").get() as { p: number };
  db.prepare(
    `INSERT INTO moves (id, source_account, target_account, item_id, status, priority)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
  ).run(id, input.sourceAccount, input.targetAccount, input.itemId, p);
  schedule();
  return id;
}

/** Put a stalled transfer back in the queue (it continues where it left off). */
export function retryMove(id: string): boolean {
  const res = db
    .prepare(
      "UPDATE moves SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ? AND status IN ('paused', 'error', 'stalled')",
    )
    .run(id);
  schedule();
  return res.changes > 0;
}

/** Pause or resume the whole queue. Pausing stops the active transfer (resumable). */
export function setQueuePaused(paused: boolean): void {
  setSetting(PAUSED_KEY, paused ? "1" : "0");
  if (paused) for (const id of running) stopping.set(id, "pause");
  else schedule();
}

/** New priority order (first = runs first). May preempt the active transfer. */
export function reorderMoves(ids: string[]): void {
  const stmt = db.prepare("UPDATE moves SET priority = ? WHERE id = ?");
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id)))();
  schedule();
}

/**
 * Remove a transfer from the queue. Its partial copy on the target is deleted; the
 * source is untouched (it's only ever deleted after a fully verified copy).
 */
export async function removeMove(id: string): Promise<boolean> {
  const row = db.prepare(`SELECT ${SELECT} FROM moves WHERE id = ?`).get(id) as MoveRow | undefined;
  if (!row || row.status === "complete") return false;
  if (running.has(id)) {
    stopping.set(id, "cancel"); // the runner cleans up, then the queue moves on
    return true;
  }
  if (isLive(row)) return false; // running in another process — not ours to stop
  db.prepare("UPDATE moves SET status = 'cancelled' WHERE id = ?").run(id);
  await deletePartialCopy(id, row.target_account);
  db.prepare("DELETE FROM moves WHERE id = ?").run(id);
  return true;
}

/** Forget finished transfers. */
export function clearFinishedMoves(): void {
  db.prepare("DELETE FROM moves WHERE status IN ('complete', 'cancelled')").run();
}

/**
 * Boot hook: transfers that were mid-flight when the process stopped are still
 * `copying`/`deleting` rows with nothing driving them — they're simply runnable, so
 * the scheduler picks the top one and continues it where it left off.
 */
export function resumeInterruptedMoves(): void {
  schedule();
}

/**
 * Make the top runnable transfer the one that's running. Called after every queue
 * change and whenever a run ends.
 */
export function schedule(): void {
  if (!IS_WORKER || isQueuePaused()) return;
  const placeholders = ACTIVE.map(() => "?").join(",");
  const next = db
    .prepare(`SELECT id FROM moves WHERE status IN (${placeholders}) ORDER BY priority, started_at LIMIT 1`)
    .get(...ACTIVE) as { id: string } | undefined;

  const current = [...running][0];
  if (current) {
    // Something higher-priority was put on top → preempt (it resumes later).
    if (next && next.id !== current && !stopping.has(current)) stopping.set(current, "pause");
    return;
  }
  if (!next) return;
  // Never double-run a job another server process is driving.
  const elsewhere = db
    .prepare(`SELECT 1 FROM moves WHERE heartbeat_at > ? AND status IN (${placeholders})`)
    .get(Date.now() - HEARTBEAT_STALE_MS, ...ACTIVE);
  if (elsewhere) return;
  launch(next.id);
}

function launch(id: string): void {
  const row = db.prepare("SELECT source_account, target_account, item_id FROM moves WHERE id = ?").get(id) as
    | { source_account: string; target_account: string; item_id: string }
    | undefined;
  if (!row) return;
  running.add(id);
  const beat = () => db.prepare("UPDATE moves SET heartbeat_at = ? WHERE id = ?").run(Date.now(), id);
  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  void runMove(id, { sourceAccount: row.source_account, targetAccount: row.target_account, itemId: row.item_id })
    .catch((e) => console.error("[move] runner crashed", e))
    .finally(() => {
      clearInterval(timer);
      db.prepare("UPDATE moves SET heartbeat_at = NULL WHERE id = ?").run(id);
      running.delete(id);
      stopping.delete(id);
      serverSideCap.delete(id);
      live.delete(id);
      schedule();
    });
}

/**
 * Progress never goes backwards: each (re)run re-walks the tree from zero, counting
 * files already on the target as it skips them, so the stored high-water mark stays
 * truthful while the walk catches up. Any progress also clears a stale retry notice.
 */
function setProgress(id: string, filesDone: number, bytesDone: number) {
  db.prepare(
    "UPDATE moves SET files_done = MAX(files_done, ?), bytes_done = MAX(bytes_done, ?), error = NULL WHERE id = ?",
  ).run(filesDone, bytesDone, id);
}
function newItemId(id: string): string | null {
  const r = db.prepare("SELECT new_item_id FROM moves WHERE id = ?").get(id) as { new_item_id: string | null } | undefined;
  return r?.new_item_id ?? null;
}

/**
 * Drive the transfer with automatic retry. Because the copy is idempotent (skips files
 * already on the target), a transient failure just retries the pass and continues.
 * It stalls for a manual retry only after many automatic attempts.
 */
async function runMove(
  id: string,
  input: { sourceAccount: string; targetAccount: string; itemId: string },
): Promise<void> {
  const MAX_ATTEMPTS = 25;
  db.prepare("UPDATE moves SET status = 'copying', error = NULL, finished_at = NULL WHERE id = ? AND status <> 'deleting'").run(id);

  for (let attempt = 1; ; attempt++) {
    try {
      await attemptMove(id, input);
      return; // success
    } catch (err) {
      if (err instanceof MoveStopped) return onStopped(id, input.targetAccount, err.reason);
      const message = err instanceof Error ? err.message : "Transfer failed.";
      if (attempt >= MAX_ATTEMPTS) {
        db.prepare(
          "UPDATE moves SET status = 'stalled', error = ?, finished_at = datetime('now') WHERE id = ?",
        ).run(`${message} — auto-retried ${attempt}×.`, id);
        return;
      }
      // Auto-retry (resumes from where it got to). Back off, but keep going.
      db.prepare("UPDATE moves SET error = ? WHERE id = ?").run(
        `${message} — retrying automatically (attempt ${attempt + 1})…`,
        id,
      );
      live.delete(id);
      try {
        await sleepUnlessStopped(id, Math.min(2 ** attempt, 60) * 1000);
      } catch (e) {
        if (e instanceof MoveStopped) return onStopped(id, input.targetAccount, e.reason);
        throw e;
      }
    }
  }
}

async function onStopped(id: string, targetAccount: string, reason: StopReason): Promise<void> {
  if (reason === "pause") {
    // Paused or preempted: back in the queue, partial copy kept for the next run.
    db.prepare("UPDATE moves SET status = 'queued', error = NULL WHERE id = ?").run(id);
    return;
  }
  db.prepare("UPDATE moves SET status = 'cancelled' WHERE id = ?").run(id);
  await deletePartialCopy(id, targetAccount);
  db.prepare("DELETE FROM moves WHERE id = ?").run(id);
}

async function deletePartialCopy(id: string, targetAccount: string): Promise<void> {
  const partial = newItemId(id);
  if (!partial) return;
  try {
    await graphFetch(targetAccount, `/me/drive/items/${partial}`, { method: "DELETE" });
  } catch {
    /* leave it */
  }
}

/** One copy→verify→delete pass. Throws on failure (the caller retries). */
async function attemptMove(
  id: string,
  input: { sourceAccount: string; targetAccount: string; itemId: string },
): Promise<void> {
  const { sourceAccount, targetAccount, itemId } = input;
  const progress = { files: 0, bytes: 0 };

  {
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
    throwIfStopped(moveId);
    const page: ChildrenPage = await graphJson<ChildrenPage>(sourceAccount, url, { absolute });
    for (const child of page.value ?? []) {
      throwIfStopped(moveId);
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
  live.set(moveId, { name, size, downloaded: 0, uploaded: 0, serverSide: false });

  // Try server-to-server (upload-from-URL) ONCE per move. Many personal accounts
  // reject it ("sourceUrl not supported"); once we learn that, skip it for the rest
  // of the move and stream directly instead of wasting an attempt on every file.
  if (serverSideCap.get(moveId) !== false) {
    try {
      liveUpdate(moveId, { serverSide: true });
      const result = await uploadFromUrl(targetAccount, targetParentId, name, downloadUrl, size, moveId, progress);
      if (serverSideCap.get(moveId) !== true) {
        serverSideCap.set(moveId, true);
        console.log(`[move] server-to-server works for this move`);
      }
      return result;
    } catch (e) {
      serverSideCap.set(moveId, false);
      liveUpdate(moveId, { serverSide: false, downloaded: 0, uploaded: 0 });
      console.log(`[move] server-to-server unavailable (${e instanceof Error ? e.message : e}) — streaming through this machine from here on`);
    }
  }

  // Stream through this machine (download from source → upload to target).
  const onProgress = (uploaded: number) => setProgress(moveId, progress.files, progress.bytes + uploaded);
  if (size <= SIMPLE_UPLOAD_MAX) {
    const src = await resilientFetch(downloadUrl);
    if (!src.ok) throw new Error(`Download of "${name}" failed (${src.status}).`);
    const buf = new Uint8Array(await src.arrayBuffer());
    liveUpdate(moveId, { downloaded: buf.length });
    const res = await graphFetch(
      targetAccount,
      `/me/drive/items/${targetParentId}:/${encoded}:/content?@microsoft.graph.conflictBehavior=replace`,
      { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: buf },
    );
    if (!res.ok) throw new Error(`Upload of "${name}" failed (${res.status}).`);
    liveUpdate(moveId, { uploaded: size });
    onProgress(size);
    return (await res.json()) as DriveItem;
  }
  return streamLargeFile(targetAccount, targetParentId, encoded, name, size, downloadUrl, onProgress, moveId);
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
    throwIfStopped(moveId);
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
      const moved = Math.floor((size * pct) / 100);
      liveUpdate(moveId, { downloaded: moved, uploaded: moved });
      setProgress(moveId, progress.files, progress.bytes + moved);
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
  onProgress?: (uploaded: number) => void,
  moveId?: string,
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
    if (moveId) throwIfStopped(moveId); // allow cancelling mid-file
    const { value, done: d } = await reader.read();
    if (value) {
      carry = Buffer.concat([carry, Buffer.from(value)]);
      liveUpdate(moveId, { downloaded: (live.get(moveId ?? "")?.downloaded ?? 0) + value.length });
    }
    done = d;
    while (carry.length >= CHUNK) {
      if (moveId) throwIfStopped(moveId);
      await put(Buffer.from(carry.subarray(0, CHUNK)), offset);
      offset += CHUNK;
      carry = carry.subarray(CHUNK);
      liveUpdate(moveId, { uploaded: offset });
      onProgress?.(offset); // live within-file progress
    }
  }
  if (carry.length > 0 || offset < size) await put(carry, offset);
  if (!lastItem) throw new Error(`Upload of "${name}" did not complete.`);
  return lastItem;
}
