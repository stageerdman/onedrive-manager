import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, createPkce, randomState } from "@/lib/graph/oauth";
import { getAccount } from "@/lib/accounts";

export const runtime = "nodejs";

const OAUTH_COOKIE = "odm_oauth";

/**
 * Start the connect flow. Generates PKCE + state, stashes them in a short-lived
 * httpOnly cookie, and redirects to Microsoft's hosted consent page.
 *
 * `?reconnect=<accountId>` re-consents a known account: we pass its email as
 * login_hint so Microsoft skips the chooser, and the callback asserts the same id.
 */
export function GET(req: NextRequest) {
  const reconnectId = req.nextUrl.searchParams.get("reconnect");
  const reconnectAccount = reconnectId ? getAccount(reconnectId) : null;

  const { verifier, challenge } = createPkce();
  const state = randomState();

  const authorizeUrl = buildAuthorizeUrl({
    state,
    challenge,
    loginHint: reconnectAccount?.email ?? undefined,
  });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, reconnectId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // localhost over http
    path: "/api/auth",
    maxAge: 600,
  });
  return res;
}
