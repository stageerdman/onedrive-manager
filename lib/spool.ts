import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, readFile, rm, statfs, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { log } from "@/lib/log";

/**
 * Local download cache for large-file transfers ("spool").
 *
 * Bytes downloaded from the source are also written to `data/spool/<moveId>/<hash>.part`,
 * so when the target's upload session is lost (Microsoft expires it, or a 401 spell
 * outlasts it) the re-upload reads the already-downloaded prefix from disk instead of
 * downloading it again. Deleted when the file lands on the target, or the transfer ends.
 *
 * Only a *committed* prefix is trusted: every COMMIT_EVERY bytes the data is fsync'd and
 * its length written to `<hash>.len`. Anything past that (e.g. after a crash) is
 * re-downloaded. Spooling pauses when the disk would drop below MIN_FREE.
 */

const ROOT = join(process.cwd(), "data", "spool");
const MIN_FREE = 5 * 1024 ** 3;
const COMMIT_EVERY = 64 * 1024 * 1024;
const READ_PIECE = 1024 * 1024;

function paths(moveId: string, key: string) {
  const dir = join(ROOT, moveId);
  const h = createHash("sha1").update(key).digest("hex").slice(0, 20);
  return { dir, data: join(dir, `${h}.part`), len: join(dir, `${h}.len`) };
}

async function committedLength(p: ReturnType<typeof paths>): Promise<number> {
  try {
    const n = Number((await readFile(p.len, "utf8")).trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function freeBytes(dir: string): Promise<number> {
  try {
    const s = await statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return 0; // unknown → don't spool
  }
}

/**
 * A byte stream of the file from `offset`: the committed local prefix first, then the
 * network (via `openNetwork`), which is written to the spool as it passes through.
 */
export async function spooledStream(
  moveId: string,
  key: string,
  offset: number,
  signal: AbortSignal,
  openNetwork: (offset: number, signal: AbortSignal) => Promise<Response>,
): Promise<ReadableStream<Uint8Array>> {
  const p = paths(moveId, key);
  await mkdir(p.dir, { recursive: true });
  const committed = await committedLength(p);
  let pos = offset;
  let fh: FileHandle | null = await open(p.data, constants.O_RDWR | constants.O_CREAT).catch(() => null); // never truncates; not O_APPEND (positional writes)
  // Spool only when the network part continues the committed prefix exactly (no gaps).
  let spooling = fh != null && offset <= committed && (await freeBytes(p.dir)) > MIN_FREE;
  let sinceCommit = 0;
  let net: ReadableStreamDefaultReader<Uint8Array> | null = null;
  if (offset < committed) log("info", "move", "spool-hit", { moveId, offset, committed });

  const commit = async () => {
    if (!fh || !spooling || sinceCommit === 0) return;
    try {
      await fh.datasync();
      await writeFile(p.len, String(pos));
      sinceCommit = 0;
    } catch (e) {
      spooling = false;
      log("warn", "move", "spool-off", { moveId, error: e });
    }
  };
  const close = async () => {
    await commit();
    const h = fh;
    fh = null;
    await h?.close().catch(() => {});
    await net?.cancel().catch(() => {});
  };

  // Pulls run one at a time; closing waits for the one in progress (no write races).
  let work: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const r = work.then(f);
    work = r.catch(() => {});
    return r;
  };
  signal.addEventListener("abort", () => void serial(close), { once: true });

  return new ReadableStream<Uint8Array>({
    pull: (ctl) =>
      serial(async () => {
        try {
          if (signal.aborted) throw signal.reason ?? new Error("aborted");
          if (pos < committed && fh) {
            const buf = Buffer.allocUnsafe(Math.min(READ_PIECE, committed - pos));
            const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
            if (bytesRead > 0) {
              pos += bytesRead;
              ctl.enqueue(buf.subarray(0, bytesRead));
              return;
            }
            // Spool shorter than recorded — fall through to the network from here.
            spooling = false;
          }
          net ??= (await openNetwork(pos, signal)).body!.getReader();
          const { value, done } = await net.read();
          if (done) {
            await close();
            ctl.close();
            return;
          }
          if (spooling && fh) {
            await fh.write(value, 0, value.length, pos);
            sinceCommit += value.length;
            if (sinceCommit >= COMMIT_EVERY) {
              await commit();
              if ((await freeBytes(p.dir)) <= MIN_FREE) {
                spooling = false;
                log("warn", "move", "spool-full", { moveId, at: pos + value.length });
              }
            }
          }
          pos += value.length;
          ctl.enqueue(value);
        } catch (e) {
          await close();
          throw e;
        }
      }),
    cancel: () => serial(close),
  });
}

/** The file landed on the target — its local copy is no longer needed. */
export async function removeSpool(moveId: string, key: string): Promise<void> {
  const p = paths(moveId, key);
  await rm(p.data, { force: true }).catch(() => {});
  await rm(p.len, { force: true }).catch(() => {});
}

/** The transfer finished or was removed. */
export async function removeMoveSpools(moveId: string): Promise<void> {
  await rm(join(ROOT, moveId), { recursive: true, force: true }).catch(() => {});
}

/** Boot: drop spools of transfers that no longer need them. */
export async function pruneSpools(keepMoveIds: Set<string>): Promise<void> {
  const dirs = await readdir(ROOT).catch(() => [] as string[]);
  for (const d of dirs) if (!keepMoveIds.has(d)) await removeMoveSpools(d);
}
