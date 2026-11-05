import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { route } from "@/server/api";
import { getMostActives, getMovers, getSnapshots } from "@/server/alpaca/market";
import { normalizeSnapshot } from "@/server/quotes";

export const dynamic = "force-dynamic";

export interface MoverRow {
  symbol: string;
  price: number | null;
  changePct: number | null;
  volume: number | null; // IEX daily volume
  screenerVolume: number | null; // most-actives volume (consolidated per Alpaca)
  exchange: string | null;
  name: string | null;
  tradable: boolean;
}

/** Gainers / losers / most active from Alpaca's screener, enriched for filtering. */
export const GET = route(async () => {
  const [movers, actives] = await Promise.all([getMovers(50), getMostActives(50)]);
  const symbols = [...new Set([...movers.gainers, ...movers.losers, ...actives.most_actives].map((m) => m.symbol))];
  const [snaps, meta] = await Promise.all([
    getSnapshots(symbols),
    db().select({ symbol: assets.symbol, exchange: assets.exchange, name: assets.name, tradable: assets.tradable }).from(assets).where(inArray(assets.symbol, symbols)),
  ]);
  const metaBy = new Map(meta.map((m) => [m.symbol, m]));
  const activeVol = new Map(actives.most_actives.map((a) => [a.symbol, a.volume]));
  const row = (symbol: string, fallback?: { price: number; percent_change: number }): MoverRow => {
    const q = normalizeSnapshot(symbol, snaps[symbol]);
    const m = metaBy.get(symbol);
    return {
      symbol,
      price: q.price ?? fallback?.price ?? null,
      changePct: fallback?.percent_change ?? q.changePct,
      volume: q.volume,
      screenerVolume: activeVol.get(symbol) ?? null,
      // Not in Alpaca's tradable list (often OTC/warrants/units): flagged, filterable.
      exchange: m?.exchange ?? null,
      name: m?.name ?? null,
      tradable: m?.tradable ?? false,
    };
  };
  return Response.json({
    lastUpdated: movers.last_updated,
    gainers: movers.gainers.map((g) => row(g.symbol, g)),
    losers: movers.losers.map((g) => row(g.symbol, g)),
    mostActive: actives.most_actives.map((a) => row(a.symbol)),
  });
});
