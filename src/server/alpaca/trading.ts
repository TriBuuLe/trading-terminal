import { z } from "zod";
import { cache, TTL } from "../cache";
import { trading } from "./client";
import {
  accountSchema,
  assetSchema,
  assetsSchema,
  calendarSchema,
  clockSchema,
  fillActivitiesSchema,
  orderSchema,
  ordersSchema,
  portfolioHistorySchema,
  positionSchema,
  positionsSchema,
  type Account,
  type FillActivity,
  type Order,
  type Position,
} from "./schemas";

export async function getAccount(fresh = false): Promise<Account> {
  if (fresh) await cache.invalidate("acct:");
  return cache.getOrLoad("acct:account", TTL.account, () => trading("/v2/account", { schema: accountSchema }));
}

export function getClock() {
  return cache.getOrLoad("acct:clock", TTL.clock, () => trading("/v2/clock", { schema: clockSchema }));
}

export function getCalendar(start: string, end: string) {
  return cache.getOrLoad(`cal:${start}:${end}`, 6 * 60 * 60_000, () =>
    trading("/v2/calendar", { schema: calendarSchema, query: { start, end } }),
  );
}

export async function getPositions(fresh = false): Promise<Position[]> {
  if (fresh) await cache.invalidate("acct:positions");
  return cache.getOrLoad("acct:positions", TTL.positions, () => trading("/v2/positions", { schema: positionsSchema }));
}

export async function getPosition(symbol: string): Promise<Position | null> {
  const all = await getPositions();
  return all.find((p) => p.symbol === symbol) ?? null;
}

/** Close (liquidate) a position with a market order. */
export async function closePosition(symbol: string): Promise<Order> {
  const o = await trading(`/v2/positions/${encodeURIComponent(symbol)}`, { schema: orderSchema, method: "DELETE" });
  await cache.invalidate("acct:");
  return o;
}

export async function listOrders(opts: {
  status: "open" | "closed" | "all";
  limit?: number;
  after?: string;
  until?: string;
  symbols?: string[];
}): Promise<Order[]> {
  const query = {
    status: opts.status,
    limit: opts.limit ?? 100,
    nested: true,
    direction: "desc",
    after: opts.after,
    until: opts.until,
    symbols: opts.symbols?.join(","),
  };
  const key = `acct:orders:${JSON.stringify(query)}`;
  return cache.getOrLoad(key, TTL.orders, () => trading("/v2/orders", { schema: ordersSchema, query }));
}

export async function getOrder(id: string): Promise<Order> {
  return trading(`/v2/orders/${encodeURIComponent(id)}`, { schema: orderSchema, query: { nested: true } });
}

export interface AlpacaOrderPayload {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  time_in_force: "day" | "gtc";
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  extended_hours?: boolean;
  client_order_id: string;
  order_class?: "simple" | "bracket";
  take_profit?: { limit_price: string };
  stop_loss?: { stop_price: string; limit_price?: string };
}

/** Place an order. Never retried automatically (not idempotent from our side). */
export async function placeOrder(payload: AlpacaOrderPayload): Promise<Order> {
  const o = await trading("/v2/orders", { schema: orderSchema, method: "POST", body: payload, retries: 0 });
  await cache.invalidate("acct:");
  return o;
}

export async function cancelOrder(id: string): Promise<void> {
  // 204 No Content on success.
  await trading(`/v2/orders/${encodeURIComponent(id)}`, { schema: z.unknown(), method: "DELETE", retries: 0 });
  await cache.invalidate("acct:");
}

export interface ReplacePayload {
  qty?: string;
  time_in_force?: "day" | "gtc";
  limit_price?: string;
  stop_price?: string;
}

export async function replaceOrder(id: string, payload: ReplacePayload): Promise<Order> {
  const o = await trading(`/v2/orders/${encodeURIComponent(id)}`, {
    schema: orderSchema,
    method: "PATCH",
    body: payload,
    retries: 0,
  });
  await cache.invalidate("acct:");
  return o;
}

export async function getAssetLive(symbol: string) {
  return cache.getOrLoad(`asset:${symbol}`, TTL.assets, () =>
    trading(`/v2/assets/${encodeURIComponent(symbol)}`, { schema: assetSchema }),
  );
}

/** All active US equities (large: ~10k+). Used only by the daily asset sync. */
export function listAllAssets() {
  return trading("/v2/assets", { schema: assetsSchema, query: { status: "active", asset_class: "us_equity" } });
}

/** All FILL activities after `after` (ISO), oldest first, following pagination. */
export async function listFills(after?: string): Promise<FillActivity[]> {
  const out: FillActivity[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const batch = await trading("/v2/account/activities/FILL", {
      schema: fillActivitiesSchema,
      query: { direction: "asc", page_size: 100, after, page_token: pageToken },
    });
    out.push(...batch);
    if (batch.length < 100) break;
    // Docs: pass the id of the last activity from the previous page.
    pageToken = batch[batch.length - 1]!.id;
  }
  return out;
}

export function getPortfolioHistory(q: {
  period?: string;
  timeframe?: "1Min" | "5Min" | "15Min" | "1H" | "1D";
  start?: string;
  end?: string;
  intraday_reporting?: "market_hours" | "extended_hours" | "continuous";
  pnl_reset?: "per_day" | "no_reset";
}) {
  const key = `acct:ph:${JSON.stringify(q)}`;
  return cache.getOrLoad(key, q.timeframe === "1D" ? 5 * 60_000 : 30_000, () =>
    trading("/v2/account/portfolio/history", { schema: portfolioHistorySchema, query: q }),
  );
}

export type { Account, Order, Position, FillActivity };
export { positionSchema };
