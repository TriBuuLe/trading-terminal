import { z } from "zod";
import { addDaysIso, etParts, etToDate } from "@/lib/time";
import { route } from "@/server/api";
import { getBars, type Timeframe } from "@/server/alpaca/market";
import { getCalendar } from "@/server/alpaca/trading";
import { searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

const RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y"] as const;
const q = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.\-/]{0,9}$/),
  range: z.enum(RANGES).default("6M"),
});

const CONFIG: Record<(typeof RANGES)[number], { tf: Timeframe; days: number; warmupDays: number }> = {
  "1D": { tf: "1Min", days: 1, warmupDays: 0 },
  "5D": { tf: "5Min", days: 5, warmupDays: 2 },
  "1M": { tf: "1Hour", days: 31, warmupDays: 20 },
  "3M": { tf: "1Day", days: 92, warmupDays: 300 }, // warm-up so SMA200 is defined on screen
  "6M": { tf: "1Day", days: 183, warmupDays: 300 },
  "1Y": { tf: "1Day", days: 366, warmupDays: 300 },
  "5Y": { tf: "1Day", days: 5 * 366, warmupDays: 300 },
};

/** OHLCV bars for the chart. Includes warm-up history; `visibleFrom` marks where the range starts. */
export const GET = route(async (req) => {
  const { symbol, range } = q.parse(Object.fromEntries(searchParams(req)));
  const cfg = CONFIG[range];
  const today = etParts(new Date()).date;
  let visibleFrom: string;
  if (range === "1D" || range === "5D") {
    const cal = await getCalendar(addDaysIso(today, -14), today);
    const mins = etParts(new Date()).minutes;
    const started = cal.filter((d) => d.date < today || mins >= 4 * 60);
    const sessions = started.slice(-cfg.days);
    const first = sessions[0];
    // Include pre/after-hours (session_open 04:00) so extended prints are visible.
    visibleFrom = first ? etToDate(first.date, first.session_open ?? "0400").toISOString() : addDaysIso(today, -cfg.days);
  } else {
    visibleFrom = `${addDaysIso(today, -cfg.days)}T00:00:00Z`;
  }
  const start = cfg.warmupDays ? `${addDaysIso(visibleFrom.slice(0, 10), -Math.ceil(cfg.warmupDays * 1.45))}T00:00:00Z` : visibleFrom;
  const bars = await getBars([symbol], cfg.tf, start, undefined, { ttlMs: cfg.tf === "1Min" ? 20_000 : undefined });
  return Response.json({ symbol, range, timeframe: cfg.tf, visibleFrom, bars: bars[symbol] ?? [] });
});
