// Is the download 401 per item or account-wide? Try the first few files of a folder.
import { graphFetch, graphJson } from "@/lib/graph/client";
const [a, folder] = process.argv.slice(2);
const kids = await graphJson<any>(a, `/me/drive/items/${folder}/children?$top=50&$select=id,name,size,file`);
for (const k of kids.value.filter((x: any) => x.file).slice(0, 3)) {
  const red = await graphFetch(a, `/me/drive/items/${k.id}/content`, { redirect: "manual" });
  const r = await fetch(red.headers.get("location")!, { headers: { Range: "bytes=0-1023" } });
  console.log(k.name.slice(0, 40).padEnd(40), r.status);
  await r.body?.cancel();
}
