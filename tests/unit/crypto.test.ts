import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, decryptJson, encrypt, encryptJson, parseKey } from "@/server/crypto";

const key = randomBytes(32);

describe("AES-256-GCM field encryption", () => {
  it("round-trips and never contains the plaintext", () => {
    const t = encryptJson({ income: 4321.55, employer: "Acme" }, "profile", key);
    expect(t).not.toContain("4321");
    expect(t).not.toContain("Acme");
    expect(decryptJson(t, "profile", key)).toEqual({ income: 4321.55, employer: "Acme" });
  });
  it("uses a fresh IV each time", () => {
    expect(encrypt("same", "a", key)).not.toBe(encrypt("same", "a", key));
  });
  it("rejects tampering, the wrong key, and a ciphertext moved to another record", () => {
    const t = encrypt("secret", "row-1", key);
    const parts = t.split(".");
    parts[3] = Buffer.from("x" + Buffer.from(parts[3]!, "base64url").toString("latin1"), "latin1").toString("base64url");
    expect(() => decrypt(parts.join("."), "row-1", key)).toThrow();
    expect(() => decrypt(t, "row-1", randomBytes(32))).toThrow();
    expect(() => decrypt(t, "row-2", key)).toThrow();
  });
  it("validates the key", () => {
    expect(() => parseKey(undefined)).toThrow(/not set/);
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(parseKey(key.toString("base64"))).toHaveLength(32);
  });
});
