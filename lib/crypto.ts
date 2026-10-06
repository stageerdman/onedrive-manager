import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Encrypt OAuth refresh tokens at rest (AES-256-GCM). The 32-byte key comes from
 * TOKEN_ENCRYPTION_KEY (64 hex chars). Stored form: `iv:tag:ciphertext`, all base64.
 *
 * This is the web-app equivalent of RecBar's native Keychain storage — the DB file
 * holds only ciphertext, and the key lives in .env (never committed). Combined with
 * OS disk encryption, the refresh tokens are not readable from the DB alone.
 */

function key(): Buffer {
  const k = Buffer.from(env.tokenEncryptionKey, "hex");
  if (k.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars).");
  }
  return k;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted token.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
