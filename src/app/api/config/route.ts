import { auth } from "@/auth";
import type { AppConfig } from "@/lib/types";
import { route } from "@/server/api";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/** Non-secret runtime config for the browser. */
export const GET = route(async () => {
  const e = env();
  const session = await auth();
  const cfg: AppConfig = {
    demoMode: e.DEMO_MODE,
    quotePollMs: e.QUOTE_POLL_MS,
    dataFeed: e.ALPACA_DATA_FEED,
    finnhubEnabled: Boolean(e.FINNHUB_API_KEY),
    slippageBps: e.SLIPPAGE_BPS,
    commissionPerTrade: e.COMMISSION_PER_TRADE,
    login: session?.login ?? (e.DEMO_MODE ? "demo" : null),
  };
  return Response.json(cfg);
});
