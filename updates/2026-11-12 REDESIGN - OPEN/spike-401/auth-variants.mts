// Does a chunk PUT to an upload session need a Bearer token now? Uploads a 6.5 MB
// test file "__odm-spike.bin" to the target root, then deletes it.
import { graphJson, getAccessToken, graphFetch } from "@/lib/graph/client";
const target = process.argv[2];
for (const withAuth of [false, true]) {
  const s = await graphJson<{ uploadUrl: string }>(target, `/me/drive/root:/__odm-spike.bin:/createUploadSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });
  const chunk = new Uint8Array(327680 * 20);
  const headers: Record<string, string> = { "Content-Length": String(chunk.length), "Content-Range": `bytes 0-${chunk.length - 1}/${chunk.length}` };
  if (withAuth) headers.Authorization = `Bearer ${await getAccessToken(target)}`;
  const r = await fetch(s.uploadUrl, { method: "PUT", headers, body: chunk });
  const body = await r.text();
  console.log(withAuth ? "WITH bearer" : "no bearer  ", "→", r.status, body.slice(0, 120));
  if (r.ok) { const id = JSON.parse(body).id; await graphFetch(target, `/me/drive/items/${id}`, { method: "DELETE" }); }
  else await fetch(s.uploadUrl, { method: "DELETE" });
}
