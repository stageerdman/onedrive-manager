import { graphJson } from "@/lib/graph/client";
for (const a of process.argv.slice(2)) {
  const d = await graphJson<any>(a, "/me/drive?$select=quota,owner");
  console.log(a, d.owner?.user?.displayName, JSON.stringify(d.quota));
}
