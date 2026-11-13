// Spike 2026-11-13: the targetAcceptsUploads() probe from lib/graph/move.ts, run live.
// Checks it answers true on a healthy account and leaves no file behind.
import { graphJson } from "@/lib/graph/client";
for (const a of process.argv.slice(2)) {
  const root = await graphJson<{ id: string }>(a, "/me/drive/root?$select=id");
  const s = await graphJson<{ uploadUrl: string }>(a, `/me/drive/items/${root.id}:/.odm-upload-probe:/createUploadSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }) });
  const piece = new Uint8Array(327_680);
  const r = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes 0-${piece.length - 1}/${piece.length * 2}` }, body: piece });
  const d = await fetch(s.uploadUrl, { method: "DELETE" });
  const left = await graphJson<{ value: { name: string }[] }>(a, `/me/drive/root/children?$filter=name eq '.odm-upload-probe'&$select=name`).catch((e) => ({ value: [{ name: String(e).slice(0, 80) }] }));
  console.log(a, "probe PUT", r.status, "→ accepts", r.status === 202, "| delete", d.status, "| leftover", left.value.map((x) => x.name));
}
