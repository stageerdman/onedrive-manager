import { GRAPH_BASE } from "@/lib/env";
import { getRefreshToken, setRefreshToken, setStatus } from "@/lib/accounts";
import { refreshAccessToken } from "@/lib/graph/oauth";

/**
 * Per-account Graph access. Access tokens are short-lived and kept in memory
 * only (spec #3 §4); refresh tokens live encrypted in SQLite. We refresh
 * silently before expiry and mark the account "reconnect" if the refresh token
 * is rejected (expired/revoked) — never dumping the user to a dead end.
 */

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const cache = new Map<string, CachedToken>();

/** Raised when the refresh token is no longer valid — caller shows "Reconnect". */
export class ReconnectNeededError extends Error {
  constructor(public accountId: string) {
    super(`Account ${accountId} needs reconnection.`);
    this.name = "ReconnectNeededError";
  }
}

export async function getAccessToken(accountId: string): Promise<string> {
  const now = Date.now();
  const cached = cache.get(accountId);
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const refreshToken = getRefreshToken(accountId);
  if (!refreshToken) throw new ReconnectNeededError(accountId);

  try {
    const res = await refreshAccessToken(refreshToken);
    cache.set(accountId, { token: res.access_token, expiresAt: now + res.expires_in * 1000 });
    // Microsoft rotates refresh tokens — persist the new one so it doesn't go stale.
    if (res.refresh_token) setRefreshToken(accountId, res.refresh_token);
    return res.access_token;
  } catch {
    cache.delete(accountId);
    setStatus(accountId, "reconnect");
    throw new ReconnectNeededError(accountId);
  }
}

export function clearTokenCache(accountId: string): void {
  cache.delete(accountId);
}

export interface GraphFetchOptions extends RequestInit {
  /** Absolute Graph URL (e.g. a @odata.nextLink) bypasses GRAPH_BASE prefixing. */
  absolute?: boolean;
}

/**
 * Authenticated Graph request for an account. Retries transient 429/503 with the
 * server's Retry-After, and refreshes the token once on a 401.
 */
export async function graphFetch(
  accountId: string,
  path: string,
  options: GraphFetchOptions = {},
): Promise<Response> {
  const url = options.absolute ? path : `${GRAPH_BASE}${path}`;
  const maxRetries = 4;

  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(accountId);
    const res = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });

    if (res.status === 401 && attempt === 0) {
      clearTokenCache(accountId);
      continue;
    }
    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
      continue;
    }
    return res;
  }
}

export async function graphJson<T>(
  accountId: string,
  path: string,
  options?: GraphFetchOptions,
): Promise<T> {
  const res = await graphFetch(accountId, path, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}
