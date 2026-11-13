// Spike: why does the 27-Bonus upload session 401 on chunk 0? Read-only except a
// tiny test upload named __odm-spike.bin in the target root (deleted afterwards).
import { graphJson, graphFetch } from "@/lib/graph/client";
const [target, folderId] = process.argv.slice(2);
const quota = await graphJson<any>(target, "/me/drive?$select=quota");
console.log("quota", quota.quota);
// tiny test session with a 12.7 GB declared size vs a small one
for (const size of [12751047972, 655360 * 10]) {
  const s = await graphJson<{ uploadUrl: string }>(target, `/me/drive/root:/__odm-spike-${size}.bin:/createUploadSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });
  console.log("uploadUrl host", new URL(s.uploadUrl).host);
  const chunk = new Uint8Array(327680 * 20);
  const r = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Length": String(chunk.length), "Content-Range": `bytes 0-${chunk.length - 1}/${size}` }, body: chunk });
  console.log("declared", size, "→", r.status, [...r.headers].filter(([h]) => /auth|error|x-ms|www/i.test(h)), (await r.text()).slice(0, 300));
  await fetch(s.uploadUrl, { method: "DELETE" });
}
void graphFetch;
