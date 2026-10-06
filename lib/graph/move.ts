import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { graphFetch, graphJson } from "@/lib/graph/client";

/**
 * Cross-account move. Microsoft Graph has no native move between two different
 * drives, so this is copy → verify → delete-source (spec #2 / INIT Phase 6):
 *
 *   1. Recreate the item (recursively, for folders) on the target drive.
 *   2. Verify every uploaded file's size matches the source.
 *   3. ONLY THEN delete the source item (one delete removes the whole subtree).
 *
 * If anything fails, the source is left completely untouched and the job is
 * marked 'error'. Large files are streamed in aligned chunks via an upload
 * session (never fully buffered). Runs in-process, fire-and-forget.
 */

// Upload-session chunks must be multiples of 320 KiB; ~6 MiB per PUT.
const CHUNK = 327_680 * 20;
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;

const running = new Set<string>();

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

export interface MoveState {
  id: string;
  status: "copying" | "verifying" | "deleting" | "complete" | "error";
  itemName: string | null;
  isFolder: boolean;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  error: string | null;
  finishedAt: string | null;
}

interface MoveRow {
  id: string;
  item_name: string | null;
  is_folder: number;
  status: MoveState["status"];
  files_done: number;
  bytes_total: number;
  bytes_done: number;
  error: string | null;
  finished_at: string | null;
}

export function getMoveState(id: string): MoveState | null {
  const r = db.prepare("SELECT * FROM moves WHERE id = ?").get(id) as MoveRow | undefined;
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    itemName: r.item_name,
    isFolder: !!r.is_folder,
    filesDone: r.files_done,
    bytesTotal: r.bytes_total,
    bytesDone: r.bytes_done,
    error: r.error,
    finishedAt: r.finished_at,
  };
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
  running.add(id);
  void runMove(id, input).finally(() => running.delete(id));
  return id;
}

function setProgress(id: string, filesDone: number, bytesDone: number) {
  db.prepare("UPDATE moves SET files_done = ?, bytes_done = ? WHERE id = ?").run(filesDone, bytesDone, id);
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
    const isFolder = !!item.folder;
    db.prepare(
      "UPDATE moves SET item_name = ?, is_folder = ?, bytes_total = ? WHERE id = ?",
    ).run(item.name ?? null, isFolder ? 1 : 0, item.size ?? 0, id);

    const targetRoot = await graphJson<DriveItem>(targetAccount, "/me/drive/root?$select=id");

    // 1 + 2: copy (and verify each file as it lands).
    await copyInto(sourceAccount, targetAccount, item, targetRoot.id, id, progress, (newId) =>
      db.prepare("UPDATE moves SET new_item_id = ? WHERE id = ?").run(newId, id),
    );

    // 3: everything copied + verified → delete the source subtree.
    db.prepare("UPDATE moves SET status = 'deleting' WHERE id = ?").run(id);
    const del = await graphFetch(sourceAccount, `/me/drive/items/${itemId}`, { method: "DELETE" });
    if (!del.ok && del.status !== 204) {
      throw new Error(`Copy succeeded but deleting the source failed (${del.status}). Nothing lost — the copy is on the target; remove the original manually.`);
    }

    db.prepare("UPDATE moves SET status = 'complete', finished_at = datetime('now') WHERE id = ?").run(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Move failed.";
    db.prepare(
      "UPDATE moves SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?",
    ).run(message, id);
  }
}

/** Recursively recreate `item` under `targetParentId` on the target drive. */
async function copyInto(
  sourceAccount: string,
  targetAccount: string,
  item: DriveItem,
  targetParentId: string,
  moveId: string,
  progress: { files: number; bytes: number },
  onRoot?: (newId: string) => void,
): Promise<void> {
  const name = item.name ?? "(unnamed)";

  if (item.folder) {
    const created = await graphJson<DriveItem>(targetAccount, `/me/drive/items/${targetParentId}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" }),
    });
    onRoot?.(created.id);

    // Recurse over the source folder's children (live, paged).
    let url: string | null = `/me/drive/items/${item.id}/children?$top=200&$select=id,name,size,folder,file`;
    let absolute = false;
    while (url) {
      const page: ChildrenPage = await graphJson<ChildrenPage>(sourceAccount, url, { absolute });
      for (const child of page.value ?? []) {
        await copyInto(sourceAccount, targetAccount, child, created.id, moveId, progress);
      }
      const next: string | undefined = page["@odata.nextLink"];
      url = next ?? null;
      absolute = !!next;
    }
    return;
  }

  // File: copy content, then verify size.
  const size = item.size ?? 0;
  const uploaded = await copyFile(sourceAccount, targetAccount, item, targetParentId);
  if ((uploaded.size ?? -1) !== size) {
    throw new Error(`Verification failed for "${name}": size ${uploaded.size} ≠ ${size}. Source left intact.`);
  }
  if (onRoot) onRoot(uploaded.id);
  progress.files += 1;
  progress.bytes += size;
  setProgress(moveId, progress.files, progress.bytes);
}

/** Copy one file's content from source → target, returning the new DriveItem. */
async function copyFile(
  sourceAccount: string,
  targetAccount: string,
  item: DriveItem,
  targetParentId: string,
): Promise<DriveItem> {
  const name = item.name ?? "(unnamed)";
  const size = item.size ?? 0;
  const encoded = encodeURIComponent(name);

  // Pre-authenticated, short-lived download URL for the source content.
  const withUrl = await graphJson<DriveItem>(
    sourceAccount,
    `/me/drive/items/${item.id}?$select=id,name,size,@microsoft.graph.downloadUrl`,
  );
  const downloadUrl = withUrl["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) throw new Error(`No download URL for "${name}".`);

  if (size <= SIMPLE_UPLOAD_MAX) {
    const src = await fetch(downloadUrl);
    if (!src.ok) throw new Error(`Download of "${name}" failed (${src.status}).`);
    const buf = new Uint8Array(await src.arrayBuffer());
    const res = await graphFetch(
      targetAccount,
      `/me/drive/items/${targetParentId}:/${encoded}:/content?@microsoft.graph.conflictBehavior=rename`,
      { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: buf },
    );
    if (!res.ok) throw new Error(`Upload of "${name}" failed (${res.status}).`);
    return (await res.json()) as DriveItem;
  }

  return streamLargeFile(targetAccount, targetParentId, encoded, name, size, downloadUrl);
}

/** Large file: create an upload session and stream aligned chunks into it. */
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
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
    },
  );
  const uploadUrl = session.uploadUrl;

  const src = await fetch(downloadUrl);
  if (!src.ok || !src.body) throw new Error(`Download of "${name}" failed (${src.status}).`);
  const reader = src.body.getReader();

  let offset = 0;
  let carry = Buffer.alloc(0);
  let done = false;
  let lastItem: DriveItem | null = null;

  async function put(chunk: Buffer, start: number): Promise<void> {
    const end = start + chunk.length - 1;
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
      body: new Uint8Array(chunk),
    });
    if (res.status === 200 || res.status === 201) {
      lastItem = (await res.json()) as DriveItem;
    } else if (res.status !== 202) {
      const text = await res.text().catch(() => "");
      throw new Error(`Chunk upload for "${name}" failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }

  while (!done) {
    const { value, done: d } = await reader.read();
    if (value) carry = Buffer.concat([carry, Buffer.from(value)]);
    done = d;
    // Flush full aligned chunks while we have them (keep remainder for next loop).
    while (carry.length >= CHUNK) {
      const chunk = carry.subarray(0, CHUNK);
      await put(Buffer.from(chunk), offset);
      offset += CHUNK;
      carry = carry.subarray(CHUNK);
    }
  }
  // Final (possibly short) chunk completes the session.
  if (carry.length > 0 || offset < size) {
    await put(carry, offset);
  }

  if (!lastItem) throw new Error(`Upload of "${name}" did not complete.`);
  return lastItem;
}
