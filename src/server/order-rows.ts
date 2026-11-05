import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import type { OrderRow } from "@/lib/types";
import type { Order } from "./alpaca/trading";

function toRow(o: Order, notes: Map<string, { why: string; tags: string[] }>): OrderRow {
  const n = notes.get(o.client_order_id);
  return {
    id: o.id,
    clientOrderId: o.client_order_id,
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    orderClass: o.order_class ?? null,
    tif: o.time_in_force,
    qty: o.qty ?? null,
    notional: o.notional ?? null,
    filledQty: o.filled_qty,
    filledAvgPrice: o.filled_avg_price ?? null,
    limitPrice: o.limit_price ?? null,
    stopPrice: o.stop_price ?? null,
    status: o.status,
    submittedAt: o.submitted_at ?? null,
    filledAt: o.filled_at ?? null,
    canceledAt: o.canceled_at ?? null,
    extendedHours: o.extended_hours ?? false,
    legs: (o.legs ?? []).map((l) => toRow(l, notes)),
    why: n?.why ?? null,
    tags: n?.tags ?? [],
  };
}

/** Attach journal "why"/tags to Alpaca orders. */
export async function toOrderRows(orders: Order[]): Promise<OrderRow[]> {
  const ids = orders.map((o) => o.client_order_id);
  const notes = new Map<string, { why: string; tags: string[] }>();
  if (ids.length) {
    const rows = await db()
      .select({ c: journalEntries.clientOrderId, why: journalEntries.why, tags: journalEntries.tags })
      .from(journalEntries)
      .where(inArray(journalEntries.clientOrderId, ids));
    for (const r of rows) notes.set(r.c, { why: r.why, tags: r.tags });
  }
  return orders.map((o) => toRow(o, notes));
}
