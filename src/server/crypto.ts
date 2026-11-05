import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-level encryption for sensitive financial data (AES-256-GCM).
 * Format: "v1.<iv>.<tag>.<ciphertext>" (base64url). The record id is bound as
 * additional authenticated data, so a ciphertext can't be moved to another row.
 * Never log plaintext financial values.
 */
const VERSION = "v1";

export function parseKey(b64: string | undefined): Buffer {
  if (!b64) throw new Error("DATA_ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return key;
}

export function encrypt(plaintext: string, aad: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(token: string, aad: string, key: Buffer): string {
  const [v, iv, tag, ct] = token.split(".");
  if (v !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unsupported ciphertext format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export const encryptJson = (value: unknown, aad: string, key: Buffer) => encrypt(JSON.stringify(value), aad, key);
export const decryptJson = <T>(token: string, aad: string, key: Buffer): T => JSON.parse(decrypt(token, aad, key)) as T;
