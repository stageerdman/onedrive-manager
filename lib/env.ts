/**
 * Centralised, validated access to the environment. Throwing here (rather than
 * letting `undefined` leak into a Graph request) turns a misconfigured `.env`
 * into one clear error instead of a confusing 400 from Microsoft.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. See .env (copied from RecBar's Azure registration).`,
    );
  }
  return value;
}

export const env = {
  azureClientId: required("AZURE_CLIENT_ID"),
  // Confidential "Web" app → client secret required by Microsoft for the code
  // exchange (AADSTS70002 without it). Set in .env (never committed).
  azureClientSecret: process.env.AZURE_CLIENT_SECRET || "",
  // Registration is personal-accounts-only → "consumers".
  azureTenant: process.env.AZURE_TENANT_ID || "consumers",
  azureRedirectUri: process.env.AZURE_REDIRECT_URI || "http://localhost:3417/api/auth/callback",
  tokenEncryptionKey: required("TOKEN_ENCRYPTION_KEY"),
};

/** Delegated scopes. ReadWrite (not .All) is enough for a personal drive and enables move. */
export const GRAPH_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Files.ReadWrite",
].join(" ");

export const authority = `https://login.microsoftonline.com/${env.azureTenant}`;
export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
