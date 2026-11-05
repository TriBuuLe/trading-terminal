import { route } from "@/server/api";
import { getProfile } from "@/server/finances";

export const dynamic = "force-dynamic";

const INVESTABLE = new Set(["TFSA", "RRSP", "FHSA", "ROTH_IRA", "TRADITIONAL_IRA", "401K", "HSA", "TAXABLE"]);

/**
 * The plan's stock-picking sandbox: sandboxPct of investable money (investment
 * accounts in the profile). Returns only the limit, not the balances.
 */
export const GET = route(async () => {
  const p = await getProfile();
  if (!p) return Response.json({ configured: false });
  const investable = p.accounts.filter((a) => INVESTABLE.has(a.type)).reduce((s, a) => s + a.balance, 0);
  return Response.json({ configured: true, pct: p.sandboxPct, limit: Math.round(((investable * p.sandboxPct) / 100) * 100) / 100 });
});
