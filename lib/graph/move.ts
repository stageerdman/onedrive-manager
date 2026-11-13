import { randomUUID } from "node:crypto";
import { db, getSetting, setSetting } from "@/lib/db";
import { graphFetch, graphJson } from "@/lib/graph/client";
import { log } from "@/lib/log";
import { pruneSpools, removeMoveSpools, removeSpool, spooledStream } from "@/lib/spool";

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
 * Bytes stream through this machine chunk by chunk. Large files are also cached on
 * disk while in flight (`lib/spool.ts`) so a lost upload session doesn't mean
 * downloading them again; the live per-file counters are kept in memory for the UI.
 */

const CHUNK = 327_680 * 32; // 10 MiB, multiple of 320 KiB (upload-session requirement)
/** Files up to this size go in one PUT to `/content` (Graph allows up to 250 MB). Unlike
 * upload sessions, it kept working through the target's session 401 spells. Bigger files
 * always use a resumable upload session. */
const SIMPLE_UPLOAD_MAX = 60 * 1024 * 1024;
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

// Runner-local state. In a production build, instrumentation.ts (boot auto-resume) and
// the route handlers do NOT reliably share memory, so nothing here is used to talk
// between them: every control signal (pause, remove, preempt) and the live per-file
// progress travel through the database. This is only the runner's own bookkeeping.
const state = ((globalThis as { __odmMoveRunner?: RunnerState }).__odmMoveRunner ??= {
  running: new Set<string>(),
  serverSideCap: new Map<string, boolean>(), // moveId -> does upload-from-URL work?
  live: new Map<string, LiveFile>(),
  lastCheck: new Map<string, number>(),
  lastFlush: new Map<string, number>(),
  recheck: null,
});
type RunnerState = {
  running: Set<string>;
  serverSideCap: Map<string, boolean>;
  live: Map<string, LiveFile>;
  lastCheck: Map<string, number>;
  lastFlush: Map<string, number>;
  recheck: ReturnType<typeof setTimeout> | null;
};
const { running, serverSideCap, live } = state;
const CHECK_EVERY_MS = 750;
const FLUSH_EVERY_MS = 1_000;

class MoveStopped extends Error {
  constructor(public reason: StopReason) {
    super(reason === "cancel" ? "Transfer removed." : "Transfer paused.");
    this.name = "MoveStopped";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Why this transfer should stop now, if at all — read from the DB (any context can ask). */
function stopReason(id: string): StopReason | null {
  const row = db.prepare("SELECT control FROM moves WHERE id = ?").get(id) as { control: string | null } | undefined;
  if (!row || row.control === "remove") return "cancel";
  if (isQueuePaused()) return "pause";
  const top = topRunnable();
  if (top && top !== id) return "pause"; // something was put above us → preempted
  return null;
}

/** Checkpoint (throttled): throws if the transfer was paused, preempted or removed. */
function throwIfStopped(id: string): void {
  const now = Date.now();
  if (now - (state.lastCheck.get(id) ?? 0) < CHECK_EVERY_MS) return;
  state.lastCheck.set(id, now);
  const reason = stopReason(id);
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

/** Start tracking a new current file (flushed to the DB immediately). */
function liveStart(id: string, file: LiveFile): void {
  live.set(id, file);
  flushLive(id, true);
}

function liveUpdate(id: string | undefined, patch: Partial<LiveFile>): void {
  if (!id) return;
  const cur = live.get(id);
  if (!cur) return;
  live.set(id, { ...cur, ...patch });
  flushLive(id, false);
}

function liveClear(id: string): void {
  live.delete(id);
  db.prepare("UPDATE moves SET live_json = NULL WHERE id = ?").run(id);
}

function flushLive(id: string, force: boolean): void {
  const now = Date.now();
  if (!force && now - (state.lastFlush.get(id) ?? 0) < FLUSH_EVERY_MS) return;
  state.lastFlush.set(id, now);
  const cur = live.get(id);
  db.prepare("UPDATE moves SET live_json = ? WHERE id = ?").run(cur ? JSON.stringify(cur) : null, id);
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
  live_json: string | null;
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
    current: isRunning && r.live_json ? (JSON.parse(r.live_json) as LiveFile) : null,
  };
}

const SELECT =
  "id, source_account, target_account, item_id, item_name, is_folder, status, files_done, bytes_total, bytes_done, error, priority, heartbeat_at, live_json, started_at, finished_at";

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
  setSetting(PAUSED_KEY, paused ? "1" : "0"); // the runner sees it at its next checkpoint
  if (!paused) schedule();
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
  if (isLive(row)) {
    // The runner (whichever context it's in) cleans up, then the queue moves on.
    db.prepare("UPDATE moves SET control = 'remove' WHERE id = ?").run(id);
    return true;
  }
  db.prepare("UPDATE moves SET status = 'cancelled' WHERE id = ?").run(id);
  await removeMoveSpools(id);
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
  // Finish removals whose runner died before it could clean up.
  const orphans = db
    .prepare("SELECT id FROM moves WHERE control = 'remove' AND (heartbeat_at IS NULL OR heartbeat_at < ?)")
    .all(Date.now() - HEARTBEAT_STALE_MS) as { id: string }[];
  for (const { id } of orphans) {
    db.prepare("UPDATE moves SET control = NULL WHERE id = ?").run(id);
    void removeMove(id);
  }
  const keep = db.prepare("SELECT id FROM moves WHERE status NOT IN ('complete', 'cancelled')").all() as { id: string }[];
  void pruneSpools(new Set(keep.map((r) => r.id)));
  schedule();
}

/**
 * Make the top runnable transfer the one that's running. Called after every queue
 * change and whenever a run ends.
 */
function topRunnable(): string | null {
  const placeholders = ACTIVE.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT id FROM moves WHERE status IN (${placeholders}) AND control IS NULL ORDER BY priority, started_at LIMIT 1`,
    )
    .get(...ACTIVE) as { id: string } | undefined;
  return row?.id ?? null;
}

export function schedule(): void {
  if (!IS_WORKER || isQueuePaused() || running.size > 0) return;
  const next = topRunnable();
  if (!next) return;
  const placeholders = ACTIVE.map(() => "?").join(",");
  // One transfer at a time, across every context/process: a fresh heartbeat means one
  // is running (it notices preemption itself and hands over when it stops). A heartbeat
  // can also be left by a process that just died (app restart), so look again once it
  // would have gone stale.
  const elsewhere = db
    .prepare(`SELECT 1 FROM moves WHERE heartbeat_at > ? AND status IN (${placeholders})`)
    .get(Date.now() - HEARTBEAT_STALE_MS, ...ACTIVE);
  if (elsewhere) {
    if (!state.recheck) {
      state.recheck = setTimeout(() => {
        state.recheck = null;
        schedule();
      }, HEARTBEAT_STALE_MS + 1000);
    }
    return;
  }
  launch(next);
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
    .catch((e) => log("error", "move", "runner-crashed", { moveId: id, error: e, stack: e instanceof Error ? e.stack : undefined }))
    .finally(() => {
      clearInterval(timer);
      db.prepare("UPDATE moves SET heartbeat_at = NULL, live_json = NULL WHERE id = ?").run(id);
      running.delete(id);
      serverSideCap.delete(id);
      live.delete(id);
      state.lastCheck.delete(id);
      state.lastFlush.delete(id);
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

  log("info", "move", "run-start", { moveId: id, ...input });
  let refusingSince: number | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      await attemptMove(id, input);
      log("info", "move", "run-complete", { moveId: id, attempt });
      await removeMoveSpools(id);
      return; // success
    } catch (err) {
      if (err instanceof MoveStopped) return onStopped(id, input.targetAccount, err.reason);
      const message = err instanceof Error ? err.message : "Transfer failed.";
      const file = live.get(id);
      if (err instanceof TargetRefusing) {
        // Microsoft is refusing uploads to the target for now. Waiting doesn't use up the
        // retry budget — these spells have lasted 15–60 min — up to REFUSING_MAX_MS.
        refusingSince ??= Date.now();
        const waitedMs = Date.now() - refusingSince;
        log("warn", "move", "target-refusing", { moveId: id, file: file?.name, waitedMins: Math.round(waitedMs / 60_000), error: message });
        if (waitedMs < REFUSING_MAX_MS) {
          attempt--;
          db.prepare("UPDATE moves SET error = ? WHERE id = ?").run(
            `${message} Microsoft is refusing uploads to this account for now — retrying every ${REFUSING_RETRY_MS / 60_000} min…`,
            id,
          );
          liveClear(id);
          try {
            await sleepUnlessStopped(id, REFUSING_RETRY_MS);
          } catch (e) {
            if (e instanceof MoveStopped) return onStopped(id, input.targetAccount, e.reason);
            throw e;
          }
          continue;
        }
      } else {
        refusingSince = null;
      }
      log(attempt >= MAX_ATTEMPTS ? "error" : "warn", "move", "attempt-failed", {
        moveId: id,
        attempt,
        error: message,
        file: file?.name,
        uploaded: file?.uploaded,
        size: file?.size,
      });
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
      liveClear(id);
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
  log("info", "move", "stopped", { moveId: id, reason, file: live.get(id)?.name, uploaded: live.get(id)?.uploaded });
  if (reason === "pause") {
    // Paused or preempted: back in the queue, partial copy kept for the next run.
    db.prepare("UPDATE moves SET status = 'queued', error = NULL WHERE id = ?").run(id);
    return;
  }
  db.prepare("UPDATE moves SET status = 'cancelled' WHERE id = ?").run(id);
  saveUpload(id, null);
  await removeMoveSpools(id);
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
      log("info", "move", "pass-copied", { moveId: id, files: progress.files, bytes: progress.bytes });
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
  liveStart(moveId, { name, size, downloaded: 0, uploaded: 0, serverSide: false });

  // Try server-to-server (upload-from-URL) ONCE per move. Many personal accounts
  // reject it ("sourceUrl not supported"); once we learn that, skip it for the rest
  // of the move and stream directly instead of wasting an attempt on every file.
  if (serverSideCap.get(moveId) !== false) {
    try {
      liveUpdate(moveId, { serverSide: true });
      const result = await uploadFromUrl(targetAccount, targetParentId, name, downloadUrl, size, moveId, progress);
      if (serverSideCap.get(moveId) !== true) {
        serverSideCap.set(moveId, true);
        log("info", "move", "server-side-works", { moveId });
      }
      return result;
    } catch (e) {
      serverSideCap.set(moveId, false);
      liveUpdate(moveId, { serverSide: false, downloaded: 0, uploaded: 0 });
      log("info", "move", "server-side-unavailable", { moveId, error: e });
    }
  }

  // Stream through this machine (download from source → upload to target).
  const onProgress = (uploaded: number) => setProgress(moveId, progress.files, progress.bytes + uploaded);
  if (size <= SIMPLE_UPLOAD_MAX) {
    // Generous but finite: assume at least ~100 KB/s, never less than 2 minutes.
    const timeoutMs = Math.max(120_000, size / 100);
    const src = await resilientFetch(downloadUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!src.ok) throw new Error(`Download of "${name}" failed (${src.status}).`);
    const buf = new Uint8Array(await src.arrayBuffer());
    liveUpdate(moveId, { downloaded: buf.length });
    const res = await graphFetch(
      targetAccount,
      `/me/drive/items/${targetParentId}:/${encoded}:/content?@microsoft.graph.conflictBehavior=replace`,
      { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: buf, signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) throw new Error(`Upload of "${name}" failed (${res.status}).`);
    liveUpdate(moveId, { uploaded: size });
    onProgress(size);
    return (await res.json()) as DriveItem;
  }
  const openDownload = async (offset: number, signal: AbortSignal): Promise<Response> => {
    // Fresh pre-authenticated URL per (re)open — they expire.
    const url = await getDownloadUrl(sourceAccount, item.id, name);
    const res = await fetch(url, { signal, headers: offset > 0 ? { Range: `bytes=${offset}-` } : {} });
    if (offset > 0 && res.status !== 206) throw new Error(`Source ignored the resume range (${res.status}).`);
    if (!res.ok || !res.body) throw new Error(`Download of "${name}" failed (${res.status}).`);
    return res;
  };
  // Same item, same size, same content hashes → the cached bytes are this file's bytes.
  const spoolKey = `${item.id}|${size}|${JSON.stringify((item.file as { hashes?: unknown } | undefined)?.hashes ?? null)}`;
  const openSource = (offset: number, signal: AbortSignal) => spooledStream(moveId, spoolKey, offset, signal, openDownload);
  const started = Date.now();
  log("info", "move", "file-start", { moveId, name, size });
  const result = await streamLargeFile(targetAccount, targetParentId, encoded, name, size, openSource, onProgress, moveId);
  await removeSpool(moveId, spoolKey);
  log("info", "move", "file-done", { moveId, name, size, secs: Math.round((Date.now() - started) / 1000) });
  return result;
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

// --- Large-file streaming: stall-proof and resumable mid-file -------------------------

const STALL_MS = 60_000; // no bytes from the source for this long → reconnect
const CHUNK_TIMEOUT_MS = 3 * 60_000; // one 10 MiB chunk PUT
/** While the target refuses uploads, retry this often — those waits don't use up attempts. */
const REFUSING_RETRY_MS = 2 * 60_000;
/** …but stop waiting (stall for a manual retry) after this long without any progress. */
const REFUSING_MAX_MS = 12 * 60 * 60_000;
const MAX_REOPENS_WITHOUT_PROGRESS = 8;
const LOG_EVERY_MS = 60_000;

class StallError extends Error {
  constructor(what: string) {
    super(`${what} stalled (no data for ${STALL_MS / 1000}s)`);
    this.name = "StallError";
  }
}
/** A chunk rejection retrying can't fix (e.g. the upload session is gone). */
class ChunkFatal extends Error {}
/** The target is refusing this upload (401) — Microsoft-side, usually passes. Retry later. */
class TargetRefusing extends ChunkFatal {}

interface SavedUpload {
  key: string;
  uploadUrl: string;
}
function loadUpload(moveId: string): SavedUpload | null {
  const r = db.prepare("SELECT upload_json FROM moves WHERE id = ?").get(moveId) as { upload_json: string | null } | undefined;
  return r?.upload_json ? (JSON.parse(r.upload_json) as SavedUpload) : null;
}
function saveUpload(moveId: string, u: SavedUpload | null): void {
  db.prepare("UPDATE moves SET upload_json = ? WHERE id = ?").run(u ? JSON.stringify(u) : null, moveId);
}

/** How many bytes an upload session already holds, or null if it can't say right now. */
async function sessionOffset(uploadUrl: string): Promise<number | null> {
  return (await sessionStatus(uploadUrl)).offset;
}

/** `gone` = Microsoft says the session doesn't exist (404/410) — no point waiting for it. */
async function sessionStatus(uploadUrl: string): Promise<{ offset: number | null; httpStatus: number | null; gone: boolean }> {
  try {
    const res = await fetch(uploadUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { offset: null, httpStatus: res.status, gone: res.status === 404 || res.status === 410 };
    const body = (await res.json()) as { nextExpectedRanges?: string[] };
    const first = body.nextExpectedRanges?.[0];
    return { offset: first ? Number(first.split("-")[0]) : null, httpStatus: res.status, gone: !first };
  } catch {
    return { offset: null, httpStatus: null, gone: false };
  }
}

/**
 * Does the target accept upload sessions right now? Opens a throwaway session in the
 * folder, sends one 320 KiB chunk of a declared 640 KiB file (so nothing is ever created),
 * then deletes the session. Used to tell a dead saved session from a Microsoft 401 spell:
 * both answer 401, and the session's own `expirationDateTime` is not a reliable guide (a
 * 12.7 GB session resumed after 53 min idle although it reported a 15-min expiry).
 */
async function targetAcceptsUploads(targetAccount: string, targetParentId: string): Promise<boolean> {
  try {
    const s = await graphJson<{ uploadUrl: string }>(
      targetAccount,
      `/me/drive/items/${targetParentId}:/.odm-upload-probe:/createUploadSession`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }) },
    );
    const piece = new Uint8Array(327_680);
    const r = await fetch(s.uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes 0-${piece.length - 1}/${piece.length * 2}` },
      body: piece,
      signal: AbortSignal.timeout(60_000),
    });
    await fetch(s.uploadUrl, { method: "DELETE", signal: AbortSignal.timeout(30_000) }).catch(() => {});
    return r.status === 202;
  } catch {
    return false; // can't tell → assume a spell and keep the saved session
  }
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StallError("Download")), STALL_MS);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function putChunk(uploadUrl: string, chunk: Buffer, start: number, size: number, name: string): Promise<DriveItem | null> {
  const end = start + chunk.length - 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Length": String(chunk.length), "Content-Range": `bytes ${start}-${end}/${size}` },
        body: new Uint8Array(chunk),
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });
      if (res.status === 200 || res.status === 201) return (await res.json()) as DriveItem;
      if (res.status === 202) return null;
      const text = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 409 || res.status === 416) {
        // Often an earlier try of this same chunk did land (response lost) — check.
        const have = await sessionOffset(uploadUrl);
        log("warn", "move", "chunk-conflict", { name, status: res.status, start, have, body: text });
        if (have != null && have >= end + 1) return null;
        throw new ChunkFatal(`Chunk upload for "${name}" rejected (${res.status}) at ${start}.`);
      }
      if (res.status !== 429 && res.status < 500) {
        log("error", "move", "chunk-rejected", { name, status: res.status, start, body: text });
        if (res.status === 401) throw new TargetRefusing(`Upload for "${name}" is being refused by Microsoft (401) — waiting it out.`);
        throw new ChunkFatal(`Chunk upload for "${name}" failed (${res.status}).`);
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof ChunkFatal) throw e;
      lastErr = e;
    }
    log("warn", "move", "chunk-retry", { name, start, attempt: attempt + 1, error: lastErr });
    await sleep(Math.min(2 ** attempt, 30) * 1000);
  }
  throw lastErr instanceof Error ? lastErr : new Error("Chunk upload failed");
}

/**
 * Stream one large file source → target through an upload session.
 *
 * - The session URL is saved on the move row; a retry / pause / restart asks it how many
 *   bytes it holds and continues from there (download re-opened with a Range header).
 * - A download that goes quiet for STALL_MS is aborted and re-opened at the current
 *   offset (with a fresh download URL) — the bytes already uploaded are kept.
 */
async function streamLargeFile(
  targetAccount: string,
  targetParentId: string,
  encodedName: string,
  name: string,
  size: number,
  openSource: (offset: number, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
  onProgress: (uploaded: number) => void,
  moveId: string,
): Promise<DriveItem> {
  const key = `${targetParentId}/${name}/${size}`;
  let uploadUrl: string | null = null;
  let offset = 0;

  const saved = loadUpload(moveId);
  if (saved?.key === key) {
    const st = await sessionStatus(saved.uploadUrl);
    if (st.offset != null) {
      uploadUrl = saved.uploadUrl;
      offset = st.offset;
      log("info", "move", "session-resumed", { name, offset, size });
    } else if (!st.gone && !(await targetAcceptsUploads(targetAccount, targetParentId))) {
      // The whole target is refusing uploads (a Microsoft spell) — the saved session may
      // well come back, so keep it and its gigabytes. The caller retries without limit-burn.
      log("warn", "move", "session-unavailable", { name, httpStatus: st.httpStatus });
      throw new TargetRefusing(`Upload session for "${name}" is temporarily refusing requests (${st.httpStatus ?? "network"}).`);
    } else {
      // Gone, or new sessions work but this one doesn't → it's dead. Start a new one
      // (the downloaded bytes come from the local spool, not the source).
      log("warn", "move", "session-expired", { name, httpStatus: st.httpStatus, gone: st.gone });
    }
  }
  if (!uploadUrl) {
    const session = await graphJson<{ uploadUrl: string }>(
      targetAccount,
      `/me/drive/items/${targetParentId}:/${encodedName}:/createUploadSession`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
      },
    );
    uploadUrl = session.uploadUrl;
    saveUpload(moveId, { key, uploadUrl });
    log("info", "move", "session-created", { name, size });
  }

  liveUpdate(moveId, { downloaded: offset, uploaded: offset });
  onProgress(offset);

  let lastItem: DriveItem | null = null;
  let fruitless = 0; // re-opens in a row that moved nothing
  let lastLog = Date.now();
  let lastLogOffset = offset;

  while (!lastItem) {
    throwIfStopped(moveId);
    const openedAt = offset;
    const ctrl = new AbortController();
    try {
      const headerTimer = setTimeout(() => ctrl.abort(new StallError("Download start")), STALL_MS);
      let src: ReadableStream<Uint8Array>;
      try {
        src = await openSource(offset, ctrl.signal);
      } finally {
        clearTimeout(headerTimer);
      }
      const reader = src.getReader();
      // Pipeline: while one chunk is uploading, keep downloading the next one (the old
      // download-then-upload lockstep idled each side half the time). Incoming pieces are
      // collected in a list and joined once per chunk — no re-copying the buffer per read.
      let parts: Buffer[] = [];
      let buffered = 0;
      let downloaded = offset;
      let sendAt = offset; // where the next chunk starts (offset = what the target confirmed)
      let inFlight: Promise<void> | null = null;
      const send = (piece: Buffer, start: number) =>
        putChunk(uploadUrl!, piece, start, size, name).then((item) => {
          offset = start + piece.length;
          if (item) lastItem = item;
          liveUpdate(moveId, { uploaded: offset });
          onProgress(offset);
          if (Date.now() - lastLog >= LOG_EVERY_MS) {
            const mbps = (offset - lastLogOffset) / 1e6 / ((Date.now() - lastLog) / 1000);
            log("info", "move", "progress", { name, offset, size, pct: +((offset / size) * 100).toFixed(1), mbps: +mbps.toFixed(2) });
            lastLog = Date.now();
            lastLogOffset = offset;
          }
        });
      try {
        for (;;) {
          throwIfStopped(moveId);
          const { value, done } = await readWithTimeout(reader);
          if (value) {
            parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
            buffered += value.length;
            downloaded += value.length;
            liveUpdate(moveId, { downloaded });
          }
          while (buffered >= CHUNK || (done && buffered > 0)) {
            throwIfStopped(moveId);
            const all = parts.length === 1 ? parts[0] : Buffer.concat(parts, buffered);
            const n = Math.min(CHUNK, all.length);
            const piece = Buffer.from(all.subarray(0, n)); // own copy; the rest stays buffered
            const rest = all.subarray(n);
            parts = rest.length ? [rest] : [];
            buffered = rest.length;
            if (inFlight) await inFlight; // chunks must land in order
            inFlight = send(piece, sendAt);
            sendAt += n;
          }
          if (done) break;
        }
        if (inFlight) await inFlight;
      } finally {
        // On a stall/stop, let the chunk already on the wire settle first, so the session's
        // offset we re-read next is final (no overlapping PUTs).
        if (inFlight) await (inFlight as Promise<void>).catch(() => {});
      }
      if (!lastItem) {
        if (offset >= size) throw new ChunkFatal(`Upload of "${name}" sent every byte but never completed.`);
        throw new Error(`Download ended early at ${offset}/${size}`);
      }
    } catch (e) {
      if (e instanceof MoveStopped) throw e;
      if (e instanceof ChunkFatal) throw e; // the next attempt re-checks the saved session
      // Network drop / stall / early end: re-open the download where the target is.
      fruitless = offset > openedAt ? 0 : fruitless + 1;
      log("warn", "move", "download-reopen", { name, offset, size, fruitless, error: e });
      if (fruitless > MAX_REOPENS_WITHOUT_PROGRESS) {
        throw new Error(`Download of "${name}" keeps failing at ${offset}/${size}: ${e instanceof Error ? e.message : e}`);
      }
      const have = await sessionOffset(uploadUrl);
      if (have == null) {
        // Leave it saved: the next attempt decides between waiting it out and starting over.
        throw new Error(`Upload session for "${name}" was lost at ${offset}/${size}.`);
      }
      offset = have;
      await sleepUnlessStopped(moveId, Math.min(2 ** fruitless, 30) * 1000);
    } finally {
      ctrl.abort();
    }
  }
  saveUpload(moveId, null);
  return lastItem;
}
