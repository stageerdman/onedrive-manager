// Run: npx tsx --tsconfig tsconfig.json --test lib/spool.test.ts
// The risk worth testing: the spool must hand back *exactly* the source's bytes, whatever
// mix of cached prefix and network is used, including after an abort mid-file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { removeMoveSpools, spooledStream } from "@/lib/spool";

const SIZE = 150 * 1024 * 1024; // > 2 commits (64 MiB each)
const data = randomBytes(SIZE);

function fakeNetwork(calls: number[]) {
  return async (offset: number, signal: AbortSignal) => {
    calls.push(offset);
    let pos = offset;
    const body = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (signal.aborted) return ctl.error(new Error("aborted"));
        if (pos >= SIZE) return ctl.close();
        const end = Math.min(pos + 65536, SIZE);
        ctl.enqueue(new Uint8Array(data.subarray(pos, end)));
        pos = end;
      },
    });
    return new Response(body);
  };
}

async function readAll(s: ReadableStream<Uint8Array>, stopAfter = Infinity, ctrl?: AbortController): Promise<Buffer> {
  const parts: Buffer[] = [];
  let n = 0;
  const r = s.getReader();
  try {
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      parts.push(Buffer.from(value));
      n += value.length;
      if (n >= stopAfter) {
        ctrl?.abort();
        break;
      }
    }
  } catch {
    /* aborted */
  }
  return Buffer.concat(parts);
}

test("full pass, then a second pass served from disk", async () => {
  const id = `test-${randomUUID()}`;
  try {
    const calls: number[] = [];
    const a = await readAll(await spooledStream(id, "k", 0, new AbortController().signal, fakeNetwork(calls)));
    assert.ok(a.equals(data));
    const b = await readAll(await spooledStream(id, "k", 0, new AbortController().signal, fakeNetwork(calls)));
    assert.ok(b.equals(data));
    assert.deepEqual(calls, [0, SIZE]); // second pass only asked the network for the (empty) tail
  } finally {
    await removeMoveSpools(id);
  }
});

test("abort mid-file keeps a committed prefix; resume mixes disk + network exactly", async () => {
  const id = `test-${randomUUID()}`;
  try {
    const calls: number[] = [];
    const ctrl = new AbortController();
    await readAll(await spooledStream(id, "k", 0, ctrl.signal, fakeNetwork(calls)), 100 * 1024 * 1024, ctrl);
    await new Promise((r) => setTimeout(r, 200)); // let the abort's close/commit run
    const from = 10 * 1024 * 1024;
    const b = await readAll(await spooledStream(id, "k", from, new AbortController().signal, fakeNetwork(calls)));
    assert.ok(b.equals(data.subarray(from)));
    assert.ok(calls[1] >= 64 * 1024 * 1024, `network resumed at ${calls[1]}, expected past the first commit`);
  } finally {
    await removeMoveSpools(id);
  }
});

test("offset past the cache streams from the network, bytes exact", async () => {
  const id = `test-${randomUUID()}`;
  try {
    const calls: number[] = [];
    const from = 120 * 1024 * 1024;
    const b = await readAll(await spooledStream(id, "k", from, new AbortController().signal, fakeNetwork(calls)));
    assert.ok(b.equals(data.subarray(from)));
    assert.deepEqual(calls, [from]);
  } finally {
    await removeMoveSpools(id);
  }
});
