// Decode the tempauth token's claims (values that identify the user are masked).
import { graphFetch } from "@/lib/graph/client";
const [a, itemId] = process.argv.slice(2);
const red = await graphFetch(a, `/me/drive/items/${itemId}/content`, { redirect: "manual" });
const ta = new URL(red.headers.get("location")!).searchParams.get("tempauth")!;
console.log("prefix", ta.slice(0, 4), "segments", ta.split(".").length);
for (const seg of ta.replace(/^v1\./, "").split(".").slice(0, 2)) {
  try {
    const j = JSON.parse(Buffer.from(seg, "base64url").toString());
    for (const [k, v] of Object.entries(j)) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      console.log(" ", k.padEnd(14), /ip|addr/i.test(k) ? s : s.length > 60 ? s.slice(0, 24) + "…(" + s.length + ")" : s);
    }
  } catch { console.log("  (not JSON)", seg.slice(0, 20)); }
}
