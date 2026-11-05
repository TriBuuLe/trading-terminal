import { timingSafeEqual } from "node:crypto";

/** GitHub logins are case-insensitive. */
export function isAllowedLogin(login: unknown, allowed: string | undefined = process.env.ALLOWED_GITHUB_USER): boolean {
  if (typeof login !== "string" || !allowed) return false;
  return login.trim().toLowerCase() === allowed.trim().toLowerCase();
}

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>`. */
export function hasCronBearer(header: string | null, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!header || !secret) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m?.[1]) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Paths the proxy lets through without a session (they authenticate themselves). */
export function isSelfAuthenticatingPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/") || // CRON_SECRET bearer, checked in the route
    pathname === "/api/health" // session OR CRON_SECRET bearer, checked in the route
  );
}

/**
 * DEMO_MODE login bypass for local demos and the Playwright smoke test.
 * Never on Vercel and never in a production build, even if DEMO_MODE is set.
 */
export function demoAuthBypass(): boolean {
  return process.env.DEMO_MODE === "true" && !process.env.VERCEL && process.env.NODE_ENV !== "production";
}
