// List (and with --delete, remove) spike/probe files: names starting "__odm-" or ".odm-upload-probe".
import { graphJson } from "@/lib/graph/client";
const [a, folder, flag] = process.argv.slice(2);
const path = folder === "root" ? "/me/drive/root/children" : `/me/drive/items/${folder}/children`;
const kids = await graphJson<any>(a, `${path}?$top=999&$select=id,name,size,createdDateTime`);
for (const k of kids.value.filter((x: any) => /^(__odm-|\.odm-upload-probe)/.test(x.name))) {
  console.log(a, k.name, k.size, k.createdDateTime);
  if (flag === "--delete") await graphJson(a, `/me/drive/items/${k.id}`, { method: "DELETE" }).then(() => console.log("  deleted"), (e) => console.log("  delete failed", String(e).slice(0, 80)));
}
