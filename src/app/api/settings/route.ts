import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { route } from "@/server/api";
import { getAccountStart, setSetting, type AccountStart } from "@/server/account";
import { getAccount } from "@/server/alpaca/trading";
import { env } from "@/server/env";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

async function usage() {
  return db().execute<{ service: string; minute: string; count: number; throttled: number }>(sql`
    select service, minute, count, throttled from api_usage
    where minute >= now() - interval '15 minutes' order by minute desc, service`);
}

export const GET = route(async () => {
  const e = env();
  const a = await getAccount();
  const start = await getAccountStart(a.account_number, a.equity);
  return Response.json({
    accountNumber: a.account_number,
    start,
    slippageBps: e.SLIPPAGE_BPS,
    commissionPerTrade: e.COMMISSION_PER_TRADE,
    quotePollMs: e.QUOTE_POLL_MS,
    dataFeed: e.ALPACA_DATA_FEED,
    finnhubEnabled: Boolean(e.FINNHUB_API_KEY),
    budgets: { "alpaca-data": 180, "alpaca-trading": 180, finnhub: 55 },
    usage: await usage(),
  });
});

const putSchema = z.object({
  startBalance: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "dollars, e.g. 10000 or 10000.00"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const PUT = route(async (req) => {
  const b = await body(req, putSchema);
  const a = await getAccount();
  const start: AccountStart = { accountNumber: a.account_number, balance: b.startBalance, date: b.startDate, source: "manual" };
  await setSetting("account_start", start);
  return Response.json({ start });
});
