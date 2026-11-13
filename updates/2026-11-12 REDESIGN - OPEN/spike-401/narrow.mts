// Narrow the 401: simple PUT vs upload session, per account. Test files deleted after.
import { graphJson, graphFetch } from "@/lib/graph/client";
for (const acct of process.argv.slice(2)) {
  const small = new Uint8Array(1024);
  const r1 = await graphFetch(acct, `/me/drive/root:/__odm-spike-small.bin:/content`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: small });
  const b1 = await r1.text();
  console.log(acct, "simple PUT →", r1.status, b1.slice(0, 100));
  if (r1.ok) await graphFetch(acct, `/me/drive/items/${JSON.parse(b1).id}`, { method: "DELETE" });

  const s = await graphJson<{ uploadUrl: string; expirationDateTime: string }>(acct, `/me/drive/root:/__odm-spike.bin:/createUploadSession`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const st = await fetch(s.uploadUrl);
  console.log(acct, "session GET status →", st.status, (await st.text()).slice(0, 150));
  const chunk = new Uint8Array(327680);
  const r = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Length": String(chunk.length), "Content-Range": `bytes 0-${chunk.length - 1}/${chunk.length}` }, body: chunk });
  const b = await r.text();
  console.log(acct, "session PUT 320KiB →", r.status, b.slice(0, 100));
  if (r.ok) await graphFetch(acct, `/me/drive/items/${JSON.parse(b).id}`, { method: "DELETE" });
  else await fetch(s.uploadUrl, { method: "DELETE" });
}
