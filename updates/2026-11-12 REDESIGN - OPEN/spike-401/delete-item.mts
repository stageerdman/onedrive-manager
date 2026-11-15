// Delete one drive item by id (prints its name/size first). Used to remove the duplicate "Jeremy Miner 1".
import { graphJson, graphFetch } from "@/lib/graph/client";
const [a, id, expectName] = process.argv.slice(2);
const it = await graphJson<any>(a, `/me/drive/items/${id}?$select=id,name,size`);
console.log("item", it.name, it.size);
if (it.name !== expectName) { console.log("name mismatch, not deleting"); process.exit(1); }
const r = await graphFetch(a, `/me/drive/items/${id}`, { method: "DELETE" });
console.log("delete", r.status);
