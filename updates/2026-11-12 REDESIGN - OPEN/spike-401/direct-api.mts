// Spike 2026-11-13: during a tempauth 401 spell, does the storage host's own API accept the
// Graph token directly (no tempauth)? Also: Graph /content following the redirect manually.
import { graphFetch, getAccessToken } from "@/lib/graph/client";
const [a, itemId] = process.argv.slice(2);
const tok = await getAccessToken(a);
const red = await graphFetch(a, `/me/drive/items/${itemId}/content`, { redirect: "manual" });
const loc = new URL(red.headers.get("location")!);
const base = loc.origin + loc.pathname.split("/_layouts/")[0]; // https://my.microsoftpersonalcontent.com/personal/<cid>
const shortId = itemId.split("!").pop();
const urls = [
  `${base}/_api/v2.0/drive/items/${itemId}/content`,
  `${base}/_api/v2.0/me/drive/items/${itemId}/content`,
  `${base}/_api/v2.1/drive/items/${itemId}/content`,
  `${base}/_layouts/15/download.aspx?UniqueId=${loc.searchParams.get("UniqueId")}`,
];
for (const u of urls) {
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}`, Range: "bytes=0-1023" }, redirect: "manual" });
  console.log(r.status, u.replace(base, "<base>").slice(0, 90), (r.headers.get("www-authenticate") ?? r.headers.get("location") ?? "").slice(0, 60));
  await r.body?.cancel();
}
void shortId;
