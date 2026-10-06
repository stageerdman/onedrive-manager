import { createHash, randomBytes } from "node:crypto";
import { authority, env, GRAPH_BASE, GRAPH_SCOPES } from "@/lib/env";

/**
 * Microsoft identity platform OAuth — authorization-code flow with PKCE for a
 * PUBLIC client (no client secret). Endpoints are built from the `consumers`
 * authority (personal Microsoft accounts).
 */

const AUTHORIZE_URL = `${authority}/oauth2/v2.0/authorize`;
const TOKEN_URL = `${authority}/oauth2/v2.0/token`;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(randomBytes(16));
}

/**
 * Build the Microsoft consent URL. `prompt=select_account` forces the account
 * chooser so a different OneDrive can be added each time; `login_hint` skips the
 * chooser when reconnecting a known account.
 */
export function buildAuthorizeUrl(opts: {
  state: string;
  challenge: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: env.azureClientId,
    response_type: "code",
    redirect_uri: env.azureRedirectUri,
    response_mode: "query",
    scope: GRAPH_SCOPES,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    prompt: opts.loginHint ? "login" : "select_account",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Token request failed (${res.status}): ${json.error ?? "unknown"} — ${json.error_description ?? ""}`,
    );
  }
  return json as TokenResponse;
}

export function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  return postToken({
    client_id: env.azureClientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.azureRedirectUri,
    code_verifier: verifier,
    scope: GRAPH_SCOPES,
  });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return postToken({
    client_id: env.azureClientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: GRAPH_SCOPES,
  });
}

export interface GraphProfile {
  id: string;
  displayName: string | null;
  email: string | null;
}

/** Fetch the signed-in account's identity. `userPrincipalName`/`mail` is the email. */
export async function fetchProfile(accessToken: string): Promise<GraphProfile> {
  const res = await fetch(`${GRAPH_BASE}/me?$select=id,displayName,userPrincipalName,mail`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Graph /me failed (${res.status})`);
  const me = await res.json();
  return {
    id: me.id,
    displayName: me.displayName ?? null,
    email: me.mail ?? me.userPrincipalName ?? null,
  };
}
