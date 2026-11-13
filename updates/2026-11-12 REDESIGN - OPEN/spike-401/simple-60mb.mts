// Spike 2026-11-13: does a 60 MB simple PUT /content work on the target? (deleted afterwards)
import { randomBytes } from "node:crypto";
import { getAccessToken, graphJson } from "@/lib/graph/client";
const a = process.argv[2];
const body = randomBytes(60 * 1024 * 1024);
const t = Date.now();
const r = await fetch("https://graph.microsoft.com/v1.0/me/drive/root:/__odm-simple60.bin:/content", { method: "PUT", headers: { Authorization: `Bearer ${await getAccessToken(a)}` }, body });
const j = await r.json() as { id?: string; size?: number };
console.log("PUT 60MB →", r.status, "size", j.size, "secs", Math.round((Date.now() - t) / 1000));
if (j.id) await graphJson(a, `/me/drive/items/${j.id}`, { method: "DELETE" }).catch(() => {});
