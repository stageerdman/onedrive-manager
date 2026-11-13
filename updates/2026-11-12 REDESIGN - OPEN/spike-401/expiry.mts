// Spike 2026-11-13: how long does an upload session live, and does a chunk extend it?
import { graphJson } from "@/lib/graph/client";
const a = process.argv[2];
const s = await graphJson<{ uploadUrl: string; expirationDateTime: string }>(a, `/me/drive/root:/__odm-expiry.bin:/createUploadSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
console.log("now", new Date().toISOString(), "created → expires", s.expirationDateTime);
const chunk = new Uint8Array(327680);
const r = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes 0-${chunk.length - 1}/${chunk.length * 4}` }, body: chunk });
console.log("chunk", r.status, await r.text());
const g = await fetch(s.uploadUrl);
console.log("status GET", g.status, await g.text());
await fetch(s.uploadUrl, { method: "DELETE" });
