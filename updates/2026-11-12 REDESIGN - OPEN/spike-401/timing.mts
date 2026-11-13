// How long does the quota read (what the pages await) take per account?
import { getDriveQuota } from "@/lib/graph/drive";
for (const a of process.argv.slice(2)) { const t = Date.now(); await getDriveQuota(a); console.log(a, Date.now() - t, "ms"); }
for (const a of process.argv.slice(2)) { const t = Date.now(); await getDriveQuota(a); console.log(a, "warm", Date.now() - t, "ms"); }
