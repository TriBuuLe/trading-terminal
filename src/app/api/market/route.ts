import { route } from "@/server/api";
import { getMarketStatus } from "@/server/market-status";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await getMarketStatus()));
