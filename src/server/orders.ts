import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, journalEntries, orders as ordersTable } from "@/db/schema";
import { explainRejection, validateOrder, type AssetInfo, type OrderRequest } from "@/lib/orders";
import { UpstreamError } from "./http";
import { getSnapshots } from "./alpaca/market";
import {
  getAccount,
  getAssetLive,
  getPosition,
  listAllAssets,
  placeOrder,
  type AlpacaOrderPayload,
  type Order,
} from "./alpaca/trading";

export class OrderRejectedError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
    readonly status = 422,
  ) {
    super(message);
    this.name = "OrderRejectedError";
  }
}

/** Asset info from our synced table, falling back to a live lookup. */
export async function getAssetInfo(symbol: string): Promise<(AssetInfo & { name: string; exchange: string }) | null> {
  const s = symbol.toUpperCase();
  const rows = await db().select().from(assets).where(eq(assets.symbol, s)).limit(1);
  if (rows[0]) return rows[0];
  try {
    const a = await getAssetLive(s);
    if (a.class !== "us_equity") return null;
    const row = {
      symbol: a.symbol,
      name: a.name,
      exchange: a.exchange,
      tradable: a.tradable,
      fractionable: a.fractionable ?? false,
      shortable: a.shortable ?? false,
      easyToBorrow: a.easy_to_borrow ?? false,
    };
    await db().insert(assets).values(row).onConflictDoNothing();
    return row;
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404) return null;
    throw e;
  }
}

/** Refresh the local asset table from Alpaca (daily cron, or on first search). */
export async function syncAssets(): Promise<number> {
  const list = (await listAllAssets()).filter((a) => a.class === "us_equity");
  const rows = list.map((a) => ({
    symbol: a.symbol,
    name: a.name,
    exchange: a.exchange,
    tradable: a.tradable,
    fractionable: a.fractionable ?? false,
    shortable: a.shortable ?? false,
    easyToBorrow: a.easy_to_borrow ?? false,
    updatedAt: new Date(),
  }));
  for (let i = 0; i < rows.length; i += 1000) {
    await db()
      .insert(assets)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: assets.symbol,
        set: {
          name: sql`excluded.name`,
          exchange: sql`excluded.exchange`,
          tradable: sql`excluded.tradable`,
          fractionable: sql`excluded.fractionable`,
          shortable: sql`excluded.shortable`,
          easyToBorrow: sql`excluded.easy_to_borrow`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return rows.length;
}

export function toPayload(o: OrderRequest, clientOrderId: string): AlpacaOrderPayload {
  const p: AlpacaOrderPayload = {
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    time_in_force: o.tif,
    client_order_id: clientOrderId,
  };
  if (o.sizeBy === "shares") p.qty = o.qty;
  else p.notional = o.notional;
  if (o.limitPrice) p.limit_price = o.limitPrice;
  if (o.stopPrice) p.stop_price = o.stopPrice;
  if (o.extendedHours) p.extended_hours = true;
  if (o.bracket) {
    p.order_class = "bracket";
    p.take_profit = { limit_price: o.bracket.takeProfit };
    p.stop_loss = { stop_price: o.bracket.stopLoss, ...(o.bracket.stopLossLimit ? { limit_price: o.bracket.stopLossLimit } : {}) };
  }
  return p;
}

/** Validate, record the journal entry + quote at submit, then send to Alpaca (paper). */
export async function submitOrder(o: OrderRequest): Promise<{ order: Order; journalId: number }> {
  const [asset, position] = await Promise.all([getAssetInfo(o.symbol), getPosition(o.symbol)]);
  const problems = validateOrder(o, asset, { positionQty: position?.qty ?? null });
  if (problems.length) throw new OrderRejectedError(problems[0]!, problems, 422);

  // Quote at submit time (fresh, not cached) for measured slippage.
  const [snap, account] = await Promise.all([
    getSnapshots([o.symbol], { fresh: true }).then((r) => r[o.symbol] ?? null),
    getAccount(),
  ]);
  const clientOrderId = `pt-${randomUUID()}`;
  const [journal] = await db()
    .insert(journalEntries)
    .values({
      clientOrderId,
      accountNumber: account.account_number,
      symbol: o.symbol,
      side: o.side,
      orderType: o.type,
      orderClass: o.bracket ? "bracket" : "simple",
      timeInForce: o.tif,
      qty: o.sizeBy === "shares" ? o.qty : null,
      notional: o.sizeBy === "dollars" ? o.notional : null,
      limitPrice: o.limitPrice ?? null,
      stopPrice: o.stopPrice ?? null,
      takeProfit: o.bracket?.takeProfit ?? null,
      stopLoss: o.bracket?.stopLoss ?? null,
      why: o.why,
      tags: o.tags,
      // 0 means "no quote" on IEX; store as missing so it can't skew slippage.
      quoteBid: snap?.latestQuote?.bp ? snap.latestQuote.bp : null,
      quoteAsk: snap?.latestQuote?.ap ? snap.latestQuote.ap : null,
      quoteLast: snap?.latestTrade?.p ? snap.latestTrade.p : null,
      quoteAt: snap?.latestQuote?.t ? new Date(snap.latestQuote.t) : null,
      status: "submitting",
      source: o.source,
    })
    .returning({ id: journalEntries.id });

  try {
    const order = await placeOrder(toPayload(o, clientOrderId));
    await db()
      .update(journalEntries)
      .set({ orderId: order.id, status: order.status })
      .where(eq(journalEntries.id, journal!.id));
    await upsertOrders([order], account.account_number);
    return { order, journalId: journal!.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof UpstreamError ? e.status : undefined;
    const friendly = explainRejection(msg, status);
    await db()
      .update(journalEntries)
      .set({ status: "rejected", rejectReason: msg })
      .where(eq(journalEntries.id, journal!.id));
    throw new OrderRejectedError(friendly, [msg], status && status >= 400 && status < 500 ? status : 502);
  }
}

/** Keep our own copy of orders (and bracket legs) so history survives account resets. */
export async function upsertOrders(list: Order[], accountNumber: string): Promise<void> {
  const rows: (typeof ordersTable.$inferInsert)[] = [];
  const add = (o: Order, parentId: string | null) => {
    rows.push({
      id: o.id,
      accountNumber,
      clientOrderId: o.client_order_id,
      parentId,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      orderClass: o.order_class ?? null,
      timeInForce: o.time_in_force,
      qty: o.qty ?? null,
      notional: o.notional ?? null,
      filledQty: o.filled_qty,
      filledAvgPrice: o.filled_avg_price ?? null,
      limitPrice: o.limit_price ?? null,
      stopPrice: o.stop_price ?? null,
      status: o.status,
      submittedAt: o.submitted_at ? new Date(o.submitted_at) : null,
      filledAt: o.filled_at ? new Date(o.filled_at) : null,
      canceledAt: o.canceled_at ? new Date(o.canceled_at) : null,
      raw: o,
      syncedAt: new Date(),
    });
    for (const leg of o.legs ?? []) add(leg, o.id);
  };
  for (const o of list) add(o, null);
  if (!rows.length) return;
  await db()
    .insert(ordersTable)
    .values(rows)
    .onConflictDoUpdate({
      target: ordersTable.id,
      set: {
        filledQty: sql`excluded.filled_qty`,
        filledAvgPrice: sql`excluded.filled_avg_price`,
        limitPrice: sql`excluded.limit_price`,
        stopPrice: sql`excluded.stop_price`,
        qty: sql`excluded.qty`,
        status: sql`excluded.status`,
        filledAt: sql`excluded.filled_at`,
        canceledAt: sql`excluded.canceled_at`,
        raw: sql`excluded.raw`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}
