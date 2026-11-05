import { db } from "@/db";
import { PgTokenBucket, type Limiter } from "./rate-limiter";

/**
 * Upstream limits (verified against provider docs, Nov 2026):
 *  - Alpaca Market Data, Basic plan: 200 historical REST calls/min.
 *  - Alpaca Trading API: 200 requests/min per account.
 *  - Finnhub free tier: 60 calls/min.
 * Budgets sit a little under the hard limits for headroom. Burst capacity is
 * small so one page load can't drain the whole minute.
 *
 * Note: buckets live in the database, so a local dev DB and the production
 * (Neon) DB each have their own budget. Running both at once against the same
 * Alpaca keys could exceed the limit; the 429 back-off handles that case.
 */
declare global {
  var __paperTerminalLimiters: { alpacaData: Limiter; alpacaTrading: Limiter; finnhub: Limiter } | undefined;
}

export const limiters = (globalThis.__paperTerminalLimiters ??= {
  alpacaData: new PgTokenBucket(db, "alpaca-data", 20, 180),
  alpacaTrading: new PgTokenBucket(db, "alpaca-trading", 20, 180),
  finnhub: new PgTokenBucket(db, "finnhub", 10, 55),
});
