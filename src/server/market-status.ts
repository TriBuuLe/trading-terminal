import { classifySession, type MarketStatus } from "@/lib/market-session";
import { etParts } from "@/lib/time";
import { getCalendar, getClock } from "./alpaca/trading";

export async function getMarketStatus(): Promise<MarketStatus> {
  const now = new Date();
  const today = etParts(now).date;
  const [clock, cal] = await Promise.all([getClock(), getCalendar(today, today)]);
  const day = cal.find((d) => d.date === today) ?? null;
  return classifySession(now, clock, day);
}
