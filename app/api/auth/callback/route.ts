import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, fetchProfile } from "@/lib/graph/oauth";
import { accountExists, getAccount, setStatus, upsertConnectedAccount } from "@/lib/accounts";

export const runtime = "nodejs";

const OAUTH_COOKIE = "odm_oauth";

interface OAuthCookie {
  state: string;
  verifier: string;
  reconnectId: string | null;
}

/** Redirect home with a short status code the overview can surface as a toast. */
function home(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/", req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // User denied consent or Microsoft returned an error.
  const oauthError = params.get("error");
  if (oauthError) {
    return home(req, { connect_error: params.get("error_description") ?? oauthError });
  }

  const code = params.get("code");
  const state = params.get("state");
  const raw = req.cookies.get(OAUTH_COOKIE)?.value;
  if (!code || !state || !raw) {
    return home(req, { connect_error: "Missing authorization code or session expired. Try again." });
  }

  let cookie: OAuthCookie;
  try {
    cookie = JSON.parse(raw);
  } catch {
    return home(req, { connect_error: "Invalid auth session. Try again." });
  }
  if (cookie.state !== state) {
    return home(req, { connect_error: "State mismatch — possible CSRF. Try again." });
  }

  try {
    const tokens = await exchangeCode(code, cookie.verifier);
    const profile = await fetchProfile(tokens.access_token);
    if (!tokens.refresh_token) {
      return home(req, { connect_error: "Microsoft did not return a refresh token (offline_access not granted)." });
    }

    // Reconnect must land on the SAME account that expired.
    if (cookie.reconnectId) {
      if (profile.id !== cookie.reconnectId) {
        const existing = getAccount(cookie.reconnectId);
        return home(req, {
          connect_error: `You signed into a different account. Reconnect '${existing?.label ?? "that drive"}' with its own Microsoft account.`,
        });
      }
    } else if (accountExists(profile.id)) {
      // Duplicate guard for a fresh connect.
      const existing = getAccount(profile.id)!;
      setStatus(profile.id, "connected");
      return home(req, { connect_notice: `This OneDrive is already connected as '${existing.label}'.` });
    }

    const account = upsertConnectedAccount({
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      refreshToken: tokens.refresh_token,
    });

    return home(req, { connected: account.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during sign-in.";
    return home(req, { connect_error: message });
  }
}
