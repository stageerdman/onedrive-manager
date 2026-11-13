// Spike 2026-11-13: during a source 401 spell, does sending the URL's own tempauth as a
// Bearer header (with/without it in the query) make the download work?
import { graphFetch, getAccessToken } from "@/lib/graph/client";
const [a, itemId] = process.argv.slice(2);
const red = await graphFetch(a, `/me/drive/items/${itemId}/content`, { redirect: "manual" });
const loc = new URL(red.headers.get("location")!);
const ta = loc.searchParams.get("tempauth") ?? "";
const stripped = new URL(loc); stripped.searchParams.delete("tempauth");
const tok = await getAccessToken(a);
const R = { Range: "bytes=0-1023" };
const tries: [string, string, Record<string, string>][] = [
  ["as-is", loc.href, R],
  ["as-is + Bearer tempauth", loc.href, { ...R, Authorization: `Bearer ${ta}` }],
  ["no-query + Bearer tempauth", stripped.href, { ...R, Authorization: `Bearer ${ta}` }],
  ["no-query + Bearer graph token", stripped.href, { ...R, Authorization: `Bearer ${tok}` }],
];
console.log("query params:", [...loc.searchParams.keys()].join(","), "tempauth len", ta.length);
for (const [label, url, h] of tries) {
  const r = await fetch(url, { headers: h });
  console.log(label.padEnd(32), r.status, (r.headers.get("www-authenticate") ?? "").slice(0, 70));
  await r.body?.cancel();
}
