// Spike 2026-11-13: source download 401s on resume. Which download URL / header combos work?
import { graphFetch, graphJson, getAccessToken } from "@/lib/graph/client";
const [acct, itemId, offStr] = process.argv.slice(2);
const off = Number(offStr);
const tok = await getAccessToken(acct);
const red = await graphFetch(acct, `/me/drive/items/${itemId}/content`, { redirect: "manual" });
const loc = red.headers.get("location")!;
const meta = await graphJson<any>(acct, `/me/drive/items/${itemId}?$select=@microsoft.graph.downloadUrl`);
const dl = meta["@microsoft.graph.downloadUrl"] as string;
console.log("302 status", red.status, "loc host", loc && new URL(loc).host, "| downloadUrl host", dl && new URL(dl).host, "same?", loc === dl);
async function t(label: string, url: string, headers: Record<string, string>) {
  const ctrl = new AbortController();
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
    const www = r.headers.get("www-authenticate");
    console.log(label.padEnd(34), r.status, r.headers.get("content-range") ?? "", www ? "WWW: " + www.slice(0, 90) : "");
  } catch (e) { console.log(label, "error", String(e).slice(0, 100)); }
  ctrl.abort();
}
const R = { Range: `bytes=${off}-` };
await t("302-loc, no range", loc, {});
await t("302-loc, range", loc, R);
await t("302-loc, range 0-", loc, { Range: "bytes=0-" });
await t("downloadUrl, no range", dl, {});
await t("downloadUrl, range", dl, R);
await t("302-loc, range + bearer", loc, { ...R, Authorization: `Bearer ${tok}` });
await t("graph /content follow, range", `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/content`, { ...R, Authorization: `Bearer ${tok}` });
