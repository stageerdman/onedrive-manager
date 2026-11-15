// Read-only: list target root folders with sizes.
import { graphJson } from "@/lib/graph/client";
const [a] = process.argv.slice(2);
const r = await graphJson<any>(a, `/me/drive/root/children?$top=999&$select=id,name,size,folder,createdDateTime`);
for (const k of r.value) console.log(k.id, JSON.stringify(k.name), (k.size / 1e9).toFixed(2) + "GB", k.createdDateTime);
