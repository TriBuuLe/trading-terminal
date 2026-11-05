import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "./env";
import { trading, data, feed } from "./alpaca/client";
import { accountSchema, latestQuotesSchema } from "./alpaca/schemas";
import { finnhub } from "./finnhub";
import { ALPACA_PAPER_TRADING_URL } from "./paper-guard";

export type CheckStatus = "ok" | "error" | "skipped" | "demo";
export interface Check {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

async function timed(fn: () => Promise<string | undefined>): Promise<Check> {
  const t0 = performance.now();
  try {
    const detail = await fn();
    return { status: "ok", latencyMs: Math.round(performance.now() - t0), detail };
  } catch (e) {
    return {
      status: "error",
      latencyMs: Math.round(performance.now() - t0),
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Upstream calls per service over the last 60s (from the shared counter). */
async function usageLastMinute(): Promise<Record<string, { count: number; throttled: number }>> {
  const rows = await db().execute<{ service: string; count: number; throttled: number }>(sql`
    select service, sum(count)::int as count, sum(throttled)::int as throttled
    from api_usage where minute >= date_trunc('minute', now() - interval '1 minute')
    group by service`);
  return Object.fromEntries(rows.map((r) => [r.service, { count: r.count, throttled: r.throttled }]));
}

export async function runHealthChecks() {
  const e = env();
  const demo = e.DEMO_MODE;

  const [database, alpacaTrading, alpacaData, finnhubCheck] = await Promise.all([
    timed(async () => {
      const rows = await db().execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      return `postgres OK, migrations applied: ${rows[0]?.n ?? 0}`;
    }),
    demo
      ? Promise.resolve<Check>({ status: "demo", detail: "DEMO_MODE=true: not calling Alpaca" })
      : timed(async () => {
          const a = await trading("/v2/account", { schema: accountSchema });
          return `paper account ${a.account_number} (${a.status}), equity $${a.equity} via ${ALPACA_PAPER_TRADING_URL}`;
        }),
    demo
      ? Promise.resolve<Check>({ status: "demo", detail: "DEMO_MODE=true: not calling Alpaca" })
      : timed(async () => {
          const q = await data("/v2/stocks/quotes/latest", {
            schema: latestQuotesSchema,
            query: { symbols: "SPY", feed: feed() },
          });
          const spy = q.quotes.SPY;
          return `feed=${feed()}, SPY bid ${spy?.bp} / ask ${spy?.ap} @ ${spy?.t}`;
        }),
    !e.FINNHUB_API_KEY
      ? Promise.resolve<Check>({ status: "skipped", detail: "FINNHUB_API_KEY not set; fundamentals panels hidden" })
      : timed(async () => {
          const q = await finnhub("/quote", z.looseObject({ c: z.number() }), { symbol: "AAPL" });
          return `AAPL last ${q.c}`;
        }),
  ]);

  const checks = { database, alpacaTrading, alpacaData, finnhub: finnhubCheck };
  const ok = Object.values(checks).every((c) => c.status !== "error");
  return {
    ok,
    demoMode: demo,
    tradingBaseUrl: ALPACA_PAPER_TRADING_URL,
    dataFeed: e.ALPACA_DATA_FEED,
    quotePollMs: e.QUOTE_POLL_MS,
    upstreamRequestsLastMinute: await usageLastMinute(),
    checks,
    checkedAt: new Date().toISOString(),
  };
}
