import { route } from "@/server/api";
import { getBars } from "@/server/alpaca/market";
import { getCalendar } from "@/server/alpaca/trading";
import { addDaysIso, etParts, etToDate } from "@/lib/time";
import { symbolsParam } from "@/server/req";

export const dynamic = "force-dynamic";

export interface WatchStats {
  /** Intraday closes (5-min bars) for the most recent session. */
  spark: number[];
  /** 20-day average daily volume (IEX feed). */
  avgVolume20: number | null;
}

/** Sparklines + average volume for many symbols in two upstream calls. */
export const GET = route(async (req) => {
  const symbols = symbolsParam(req, "symbols", 100);
  if (!symbols.length) return Response.json({});
  const now = new Date();
  const today = etParts(now).date;
  // Most recent session that has started: today once regular hours begin, else the previous trading day.
  const cal = await getCalendar(addDaysIso(today, -10), today);
  const { minutes } = etParts(now);
  const started = cal.filter((d) => d.date < today || (d.date === today && minutes >= 9 * 60 + 30));
  const session = started[started.length - 1];
  const sessionStart = session ? etToDate(session.date, session.open).toISOString() : addDaysIso(today, -1);

  const [intraday, daily] = await Promise.all([
    getBars(symbols, "5Min", sessionStart, undefined, { ttlMs: 60_000 }),
    getBars(symbols, "1Day", addDaysIso(today, -40), undefined, { limitPerSymbol: 21 }),
  ]);
  const out: Record<string, WatchStats> = {};
  for (const s of symbols) {
    // Exclude today's (partial) daily bar from the average.
    const d = (daily[s] ?? []).filter((b) => etParts(new Date(b.t)).date < today).slice(-20);
    out[s] = {
      spark: (intraday[s] ?? []).map((b) => b.c),
      avgVolume20: d.length ? d.reduce((a, b) => a + b.v, 0) / d.length : null,
    };
  }
  return Response.json(out);
});
