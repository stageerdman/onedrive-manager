// Compare upload-session URL shapes per account (tempauth value redacted).
import { graphJson, getAccessToken } from "@/lib/graph/client";
for (const acct of process.argv.slice(2)) {
  const s = await graphJson<{ uploadUrl: string }>(acct, `/me/drive/root:/__odm-spike.bin:/createUploadSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const u = new URL(s.uploadUrl);
  const params = [...u.searchParams.keys()].map((k) => `${k}=<${u.searchParams.get(k)!.length} chars>`);
  console.log(acct, u.host + u.pathname.replace(/[A-Za-z0-9_-]{40,}/g, "<id>"), params.join("&"));
  const tok = await getAccessToken(acct);
  const claims = JSON.parse(Buffer.from(tok.split(".")[1] ?? "", "base64url").toString() || "{}");
  console.log("   token: jwt?", tok.split(".").length === 3, "aud", claims.aud, "scp", claims.scp, "appid", claims.appid ?? claims.azp);
  await fetch(s.uploadUrl, { method: "DELETE" });
}
