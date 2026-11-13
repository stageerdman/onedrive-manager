// Spike 2026-11-13: when upload sessions 401 on an account, which other upload paths still work?
// Writes tiny __odm-alt-*.bin files in the drive root and deletes them.
import { graphJson, getAccessToken } from "@/lib/graph/client";
const accts = process.argv.slice(2);
const body = new Uint8Array(327680 * 2);
async function trySession(acct: string, label: string, base: string) {
  try {
    const tok = await getAccessToken(acct);
    const r0 = await fetch(`${base}/me/drive/root:/__odm-alt-${label}.bin:/createUploadSession`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }) });
    if (!r0.ok) return console.log(acct, label, "create →", r0.status, (await r0.text()).slice(0, 150));
    const { uploadUrl } = await r0.json() as { uploadUrl: string };
    const r = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes 0-${body.length - 1}/${body.length}` }, body });
    console.log(acct, label, new URL(uploadUrl).host, "PUT →", r.status);
    if (r.ok) { const j = await r.json() as { id?: string }; if (j.id) await graphJson(acct, `/me/drive/items/${j.id}`, { method: "DELETE" }).catch(() => {}); }
    else await fetch(uploadUrl, { method: "DELETE" });
  } catch (e) { console.log(acct, label, "error", String(e).slice(0, 150)); }
}
for (const a of accts) {
  await trySession(a, "v1", "https://graph.microsoft.com/v1.0");
  await trySession(a, "beta", "https://graph.microsoft.com/beta");
  try {
    const tok = await getAccessToken(a);
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/__odm-alt-simple.bin:/content`, { method: "PUT", headers: { Authorization: `Bearer ${tok}` }, body });
    console.log(a, "simple PUT /content →", r.status);
    if (r.ok) { const j = await r.json() as { id: string }; await graphJson(a, `/me/drive/items/${j.id}`, { method: "DELETE" }).catch(() => {}); }
  } catch (e) { console.log(a, "simple error", String(e).slice(0, 150)); }
}
