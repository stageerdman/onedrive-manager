// Find a file by name under a folder (walks the tree).
import { graphJson } from "@/lib/graph/client";
const [a, root, name] = process.argv.slice(2);
async function walk(id: string): Promise<string | null> {
  const r = await graphJson<any>(a, `/me/drive/items/${id}/children?$top=999&$select=id,name,folder`);
  for (const c of r.value) if (c.name === name) return c.id;
  for (const c of r.value) if (c.folder) { const f = await walk(c.id); if (f) return f; }
  return null;
}
console.log(await walk(root));
