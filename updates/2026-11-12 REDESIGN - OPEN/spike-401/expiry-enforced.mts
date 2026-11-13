// Spike 2026-11-13: is the 15-min sliding expiry enforced? Upload 1 chunk, wait 20 min,
// then check status and try the next chunk.
import { graphJson } from "@/lib/graph/client";
const a = process.argv[2];
const s = await graphJson<{ uploadUrl: string; expirationDateTime: string }>(a, `/me/drive/root:/__odm-expiry2.bin:/createUploadSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const chunk = new Uint8Array(327680);
const r = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes 0-${chunk.length - 1}/${chunk.length * 2}` }, body: chunk });
console.log(new Date().toISOString(), "chunk1", r.status, (await r.json()).expirationDateTime);
await new Promise((res) => setTimeout(res, 20 * 60_000));
const g = await fetch(s.uploadUrl);
console.log(new Date().toISOString(), "status after 20m", g.status, (await g.text()).slice(0, 200));
const p = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${chunk.length}-${chunk.length * 2 - 1}/${chunk.length * 2}` }, body: chunk });
console.log(new Date().toISOString(), "chunk2 after 20m", p.status, (await p.text()).slice(0, 200));
if (p.ok) { const j = await graphJson<{ id: string }>(a, "/me/drive/root:/__odm-expiry2.bin"); await graphJson(a, `/me/drive/items/${j.id}`, { method: "DELETE" }).catch(() => {}); }
else await fetch(s.uploadUrl, { method: "DELETE" });
