// Spike 2026-11-13: does the legacy api.onedrive.com endpoint accept our token, and does its
// upload session (different upload host?) work when Graph's sessions 401?
import { getAccessToken } from "@/lib/graph/client";
const body = new Uint8Array(327680 * 2);
for (const a of process.argv.slice(2)) {
  const tok = await getAccessToken(a);
  const h = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
  const me = await fetch("https://api.onedrive.com/v1.0/drive?select=id", { headers: h });
  console.log(a, "legacy GET /drive →", me.status, (await me.text()).slice(0, 120));
  const r0 = await fetch("https://api.onedrive.com/v1.0/drive/root:/__odm-legacy.bin:/upload.createSession", { method: "POST", headers: h, body: JSON.stringify({ item: { "@name.conflictBehavior": "replace" } }) });
  const t0 = await r0.text();
  console.log(a, "legacy createSession →", r0.status, t0.slice(0, 120));
  if (!r0.ok) continue;
  const { uploadUrl } = JSON.parse(t0);
  const u = new URL(uploadUrl);
  const r = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes 0-${body.length - 1}/${body.length}` }, body });
  console.log(a, "legacy PUT", u.host + u.pathname.slice(0, 30), "→", r.status);
  if (r.ok) { const j = await r.json(); await fetch(`https://api.onedrive.com/v1.0/drive/items/${j.id}`, { method: "DELETE", headers: h }); }
  else await fetch(uploadUrl, { method: "DELETE" });
}
