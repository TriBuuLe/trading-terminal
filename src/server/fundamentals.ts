import { z } from "zod";
import { addDaysIso, etParts } from "@/lib/time";
import { cache, TTL } from "./cache";
import { finnhub } from "./finnhub";

// Shapes from Finnhub's OpenAPI spec (definitions CompanyProfile2, EarningRelease,
// RecommendationTrend, BasicFinancials). Everything optional: free-tier coverage varies.
const profileSchema = z.looseObject({
  name: z.string().optional(),
  ticker: z.string().optional(),
  exchange: z.string().optional(),
  finnhubIndustry: z.string().optional(),
  marketCapitalization: z.number().optional(), // millions USD
  shareOutstanding: z.number().optional(),
  ipo: z.string().optional(),
  weburl: z.string().optional(),
  logo: z.string().optional(),
  country: z.string().optional(),
});
// BasicFinancials.metric is a free-form map; the spec doesn't enumerate keys.
const metricSchema = z.looseObject({
  metric: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
});
const earningsSchema = z.looseObject({
  earningsCalendar: z
    .array(
      z.looseObject({
        symbol: z.string(),
        date: z.string(),
        hour: z.string().optional().nullable(),
        quarter: z.number().optional().nullable(),
        year: z.number().optional().nullable(),
        epsEstimate: z.number().optional().nullable(),
        epsActual: z.number().optional().nullable(),
        revenueEstimate: z.number().optional().nullable(),
        revenueActual: z.number().optional().nullable(),
      }),
    )
    .default([]),
});
const recSchema = z.array(
  z.looseObject({
    period: z.string(),
    strongBuy: z.number(),
    buy: z.number(),
    hold: z.number(),
    sell: z.number(),
    strongSell: z.number(),
  }),
);

export interface Fundamentals {
  symbol: string;
  name: string | null;
  industry: string | null;
  marketCapM: number | null;
  peTTM: number | null;
  beta: number | null;
  hi52: number | null;
  lo52: number | null;
  grossMarginTTM: number | null;
  operatingMarginTTM: number | null;
  netMarginTTM: number | null;
  avgVolume10dM: number | null;
  weburl: string | null;
  nextEarnings: { date: string; hour: string | null; epsEstimate: number | null } | null;
  recommendations: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[];
  missing: string[];
}

const num = (m: Record<string, unknown> | undefined, ...keys: string[]): number | null => {
  for (const k of keys) {
    const v = m?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
};

/** Next earnings within `days` for one symbol (or null). */
export async function nextEarnings(symbol: string, days = 90) {
  const today = etParts(new Date()).date;
  const r = await cache.getOrLoad(`fh:earn:${symbol}:${today}`, 6 * 60 * 60_000, () =>
    finnhub("/calendar/earnings", earningsSchema, { symbol, from: today, to: addDaysIso(today, days) }),
  );
  const next = r.earningsCalendar.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  return next ? { date: next.date, hour: next.hour ?? null, epsEstimate: next.epsEstimate ?? null } : null;
}

export async function getFundamentals(symbol: string): Promise<Fundamentals> {
  const s = symbol.toUpperCase();
  const missing: string[] = [];
  const safe = async <T>(label: string, p: Promise<T>): Promise<T | null> => {
    try {
      return await p;
    } catch (e) {
      missing.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const [profile, metric, earn, recs] = await Promise.all([
    safe("profile", cache.getOrLoad(`fh:profile:${s}`, TTL.fundamentals, () => finnhub("/stock/profile2", profileSchema, { symbol: s }))),
    safe("metrics", cache.getOrLoad(`fh:metric:${s}`, TTL.fundamentals, () => finnhub("/stock/metric", metricSchema, { symbol: s, metric: "all" }))),
    safe("earnings", nextEarnings(s)),
    safe("recommendations", cache.getOrLoad(`fh:rec:${s}`, TTL.fundamentals, () => finnhub("/stock/recommendation", recSchema, { symbol: s }))),
  ]);
  const m = metric?.metric;
  return {
    symbol: s,
    name: profile?.name ?? null,
    industry: profile?.finnhubIndustry ?? null,
    marketCapM: profile?.marketCapitalization ?? num(m, "marketCapitalization"),
    peTTM: num(m, "peTTM", "peBasicExclExtraTTM", "peExclExtraTTM"),
    beta: num(m, "beta"),
    hi52: num(m, "52WeekHigh"),
    lo52: num(m, "52WeekLow"),
    grossMarginTTM: num(m, "grossMarginTTM"),
    operatingMarginTTM: num(m, "operatingMarginTTM"),
    netMarginTTM: num(m, "netProfitMarginTTM"),
    avgVolume10dM: num(m, "10DayAverageTradingVolume"),
    weburl: profile?.weburl ?? null,
    nextEarnings: earn ?? null,
    recommendations: (recs ?? []).slice(0, 4),
    missing,
  };
}
