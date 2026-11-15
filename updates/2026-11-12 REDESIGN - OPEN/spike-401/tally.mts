// Read-only: walk source + target folder trees, tally files/bytes and what counts as "done".
import { graphJson } from "@/lib/graph/client";
const [src, srcId, tgt, tgtId] = process.argv.slice(2);
async function kids(a: string, id: string) {
  const out: any[] = []; let url: string | null = `/me/drive/items/${id}/children?$top=200&$select=id,name,size,folder,file`; let absolute = false;
  while (url) { const p: any = await graphJson<any>(a, url, { absolute }); out.push(...p.value); url = p["@odata.nextLink"] ?? null; absolute = !!url; }
  return out;
}
let files = 0, bytes = 0, doneFiles = 0, doneBytes = 0; const missing: string[] = [];
async function walk(s: string, t: string | null, path: string) {
  const tk = t ? await kids(tgt, t) : []; const by = new Map(tk.map((k) => [k.name, k]));
  for (const c of await kids(src, s)) {
    if (!c.file) { await walk(c.id, by.get(c.name)?.id ?? null, path + "/" + c.name); continue; }
    files++; bytes += c.size;
    if (by.get(c.name)?.size === c.size) { doneFiles++; doneBytes += c.size; } else missing.push(`${path}/${c.name} ${(c.size/1e9).toFixed(2)}GB`);
  }
}
const root = await graphJson<any>(src, `/me/drive/items/${srcId}?$select=size`);
await walk(srcId, tgtId, "");
console.log({ folderSize: root.size, files, bytes, doneFiles, doneBytes, leftBytes: bytes - doneBytes });
console.log(missing.join("\n"));
