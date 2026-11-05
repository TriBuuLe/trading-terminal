import { cache, TTL } from "../cache";
import { data, feed } from "./client";
import {
  barsResponseSchema,
  mostActivesSchema,
  moversSchema,
  newsResponseSchema,
  snapshotsSchema,
  type Bar,
  type NewsArticle,
  type Snapshot,
} from "./schemas";

export type Timeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day";

const uniq = (xs: string[]) => [...new Set(xs.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();

/**
 * Multi-symbol snapshots: ONE upstream request covers the whole watchlist +
 * positions + index strip. (Docs: GET /v2/stocks/snapshots?symbols=…; the
 * response is an object keyed by symbol.)
 */
export async function getSnapshots(symbols: string[], opts: { fresh?: boolean } = {}): Promise<Record<string, Snapshot | null>> {
  const syms = uniq(symbols);
  if (syms.length === 0) return {};
  const out: Record<string, Snapshot | null> = {};
  // Keep URLs reasonable: chunk at 100 symbols.
  for (let i = 0; i < syms.length; i += 100) {
    const chunk = syms.slice(i, i + 100);
    const load = () => data("/v2/stocks/snapshots", { schema: snapshotsSchema, query: { symbols: chunk.join(","), feed: feed() } });
    const res = opts.fresh ? await load() : await cache.getOrLoad(`snap:${chunk.join(",")}`, TTL.snapshot, load);
    Object.assign(out, res);
  }
  return out;
}

/** Bars for one or many symbols, following pagination. */
export async function getBars(
  symbols: string[],
  timeframe: Timeframe,
  start: string,
  end?: string,
  opts: { limitPerSymbol?: number; ttlMs?: number } = {},
): Promise<Record<string, Bar[]>> {
  const syms = uniq(symbols);
  if (syms.length === 0) return {};
  const ttl = opts.ttlMs ?? (timeframe === "1Day" ? TTL.barsDaily : TTL.bars);
  const key = `bars:${timeframe}:${start}:${end ?? ""}:${syms.join(",")}`;
  return cache.getOrLoad(key, ttl, async () => {
    const out: Record<string, Bar[]> = {};
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await data("/v2/stocks/bars", {
        schema: barsResponseSchema,
        query: {
          symbols: syms.join(","),
          timeframe,
          start,
          end,
          feed: feed(),
          adjustment: "split",
          sort: "asc",
          limit: 10000,
          page_token: pageToken,
        },
      });
      for (const [s, bars] of Object.entries(res.bars ?? {})) (out[s] ??= []).push(...bars);
      pageToken = res.next_page_token ?? undefined;
      if (!pageToken) break;
    }
    if (opts.limitPerSymbol) {
      for (const s of Object.keys(out)) out[s] = out[s]!.slice(-opts.limitPerSymbol);
    }
    return out;
  });
}

export async function getNews(symbols: string[], limit = 20): Promise<NewsArticle[]> {
  const syms = uniq(symbols);
  const key = `news:${limit}:${syms.join(",")}`;
  return cache.getOrLoad(key, TTL.news, async () => {
    const res = await data("/v1beta1/news", {
      schema: newsResponseSchema,
      query: { symbols: syms.length ? syms.join(",") : undefined, limit: Math.min(50, limit), sort: "desc" },
    });
    return res.news;
  });
}

export function getMovers(top = 50) {
  return cache.getOrLoad(`movers:${top}`, TTL.screener, () =>
    data("/v1beta1/screener/stocks/movers", { schema: moversSchema, query: { top: Math.min(50, top) } }),
  );
}

export function getMostActives(top = 50, by: "volume" | "trades" = "volume") {
  return cache.getOrLoad(`actives:${by}:${top}`, TTL.screener, () =>
    data("/v1beta1/screener/stocks/most-actives", { schema: mostActivesSchema, query: { top: Math.min(100, top), by } }),
  );
}

export type { Bar, Snapshot, NewsArticle };
