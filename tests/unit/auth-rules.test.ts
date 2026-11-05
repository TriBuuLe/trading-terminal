import { describe, expect, it } from "vitest";
import { hasCronBearer, isAllowedLogin, isSelfAuthenticatingPath } from "@/server/auth-rules";

describe("auth rules", () => {
  it("allows only the configured GitHub user (case-insensitive)", () => {
    expect(isAllowedLogin("TriBuuLe", "tribuule")).toBe(true);
    expect(isAllowedLogin("someone-else", "tribuule")).toBe(false);
    expect(isAllowedLogin(undefined, "tribuule")).toBe(false);
    expect(isAllowedLogin("tribuule", undefined)).toBe(false);
    expect(isAllowedLogin("", "")).toBe(false);
  });

  it("checks the cron bearer token exactly", () => {
    const s = "a".repeat(64);
    expect(hasCronBearer(`Bearer ${s}`, s)).toBe(true);
    expect(hasCronBearer(`bearer ${s}`, s)).toBe(true);
    expect(hasCronBearer(`Bearer ${s}x`, s)).toBe(false);
    expect(hasCronBearer(s, s)).toBe(false);
    expect(hasCronBearer(null, s)).toBe(false);
    expect(hasCronBearer("Bearer x", undefined)).toBe(false);
  });

  it("only exempts login, auth callback, cron and health from the proxy", () => {
    expect(isSelfAuthenticatingPath("/api/auth/callback/github")).toBe(true);
    expect(isSelfAuthenticatingPath("/api/cron/daily")).toBe(true);
    expect(isSelfAuthenticatingPath("/api/health")).toBe(true);
    expect(isSelfAuthenticatingPath("/login")).toBe(true);
    expect(isSelfAuthenticatingPath("/api/orders")).toBe(false);
    expect(isSelfAuthenticatingPath("/")).toBe(false);
    expect(isSelfAuthenticatingPath("/api/healthz")).toBe(false);
  });
});
