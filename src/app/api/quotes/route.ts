import type { QuotesResponse } from "@/lib/types";
import { route } from "@/server/api";
import { getSnapshots } from "@/server/alpaca/market";
import { cache, TTL } from "@/server/cache";
import { getMarketStatus } from "@/server/market-status";
import { normalizeSnapshot } from "@/server/quotes";
import { symbolsParam } from "@/server/req";

export const dynamic = "force-dynamic";

/**
 * Batched quotes: one upstream snapshots call for every symbol the dashboard
 * shows (watchlist + positions + index strip). If Alpaca is down, serve the last
 * stored snapshot flagged `stale` with its timestamp (never made-up numbers).
 */
export const GET = route(async (req) => {
  const symbols = symbolsParam(req);
  const market = await getMarketStatus();
  if (!symbols.length) {
    const empty: QuotesResponse = { quotes: {}, market, fetchedAt: new Date().toISOString(), stale: false, storedAt: new Date().toISOString() };
    return Response.json(empty);
  }
  const key = `quotes:${[...symbols].sort().join(",")}`;
  const r = await cache.getOrLoadMeta(key, TTL.quote, () => getSnapshots(symbols, { fresh: true }));
  const quotes = Object.fromEntries(symbols.map((s) => [s, normalizeSnapshot(s, r.value[s])]));
  const res: QuotesResponse = {
    quotes,
    market,
    fetchedAt: new Date().toISOString(),
    stale: r.stale,
    storedAt: r.storedAt.toISOString(),
  };
  return Response.json(res);
});
