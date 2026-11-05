import Decimal from "decimal.js";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { fills as fillsTable, journalEntries, orders as ordersTable } from "@/db/schema";
import { fifo, type Fill } from "@/lib/analytics";
import { getAccount } from "./alpaca/trading";
import { syncFills, syncOrders } from "./sync";
import { cache } from "./cache";

export interface JournalRow {
  id: number;
  createdAt: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: string;
  orderClass: string;
  qty: string | null;
  notional: string | null;
  why: string;
  tags: string[];
  status: string;
  rejectReason: string | null;
  filledQty: string | null;
  filledAvgPrice: string | null;
  /** Realized P&L of shares this order OPENED that have since been closed. */
  openedRealized: string | null;
  openedClosedQty: string | null;
  /** Realized P&L booked by this order when it CLOSED earlier lots. */
  closedRealized: string | null;
  outcome: "open" | "partly closed" | "closed" | "not filled" | "closing trade" | "rejected";
}

/** Journal entries with their fills and outcome (FIFO). */
export async function getJournal(limit = 300): Promise<{ rows: JournalRow[]; perTag: { tag: string; pnl: string; trades: number; wins: number }[] }> {
  await Promise.all([syncFills(), cache.getOrLoad("sync:orders", 30_000, syncOrders)]);
  const a = await getAccount();
  const entries = await db()
    .select({ j: journalEntries, o: ordersTable })
    .from(journalEntries)
    .leftJoin(ordersTable, eq(ordersTable.id, journalEntries.orderId))
    .orderBy(desc(journalEntries.createdAt))
    .limit(limit);
  const fillRows = await db().select().from(fillsTable).where(eq(fillsTable.accountNumber, a.account_number));
  const fills: Fill[] = fillRows.map((r) => ({ id: r.id, orderId: r.orderId, symbol: r.symbol, side: r.side, qty: r.qty, price: r.price, time: r.transactionTime.toISOString() }));
  const { matches } = fifo(fills);

  const opened = new Map<string, { pnl: Decimal; qty: Decimal }>();
  const closed = new Map<string, Decimal>();
  const closingQty = new Map<string, Decimal>();
  for (const m of matches) {
    const o = opened.get(m.openOrderId) ?? { pnl: new Decimal(0), qty: new Decimal(0) };
    o.pnl = o.pnl.plus(m.pnl);
    o.qty = o.qty.plus(m.qty);
    opened.set(m.openOrderId, o);
    closed.set(m.closeOrderId, (closed.get(m.closeOrderId) ?? new Decimal(0)).plus(m.pnl));
    closingQty.set(m.closeOrderId, (closingQty.get(m.closeOrderId) ?? new Decimal(0)).plus(m.qty));
  }
  const filledByOrder = new Map<string, Decimal>();
  for (const f of fills) filledByOrder.set(f.orderId, (filledByOrder.get(f.orderId) ?? new Decimal(0)).plus(f.qty));

  const rows: JournalRow[] = entries.map(({ j, o }) => {
    const oid = j.orderId ?? "";
    const op = opened.get(oid);
    const cl = closed.get(oid);
    const filled = filledByOrder.get(oid) ?? (o?.filledQty ? new Decimal(o.filledQty) : new Decimal(0));
    // Shares this order opened = filled minus shares it used to close earlier lots.
    const openedQty = filled.minus(closingQty.get(oid) ?? 0);
    const closedOfOpened = op?.qty ?? new Decimal(0);
    let outcome: JournalRow["outcome"];
    if (j.status === "rejected") outcome = "rejected";
    else if (filled.isZero()) outcome = "not filled";
    else if (openedQty.lte(0)) outcome = "closing trade";
    else if (closedOfOpened.isZero()) outcome = "open";
    else if (closedOfOpened.gte(openedQty)) outcome = "closed";
    else outcome = "partly closed";
    return {
      id: j.id,
      createdAt: j.createdAt.toISOString(),
      symbol: j.symbol,
      side: j.side,
      orderType: j.orderType,
      orderClass: j.orderClass,
      qty: j.qty,
      notional: j.notional,
      why: j.why,
      tags: j.tags,
      status: o?.status ?? j.status,
      rejectReason: j.rejectReason,
      filledQty: filled.isZero() ? null : filled.toString(),
      filledAvgPrice: o?.filledAvgPrice ?? null,
      openedRealized: op ? op.pnl.toFixed(2) : null,
      openedClosedQty: op ? op.qty.toString() : null,
      closedRealized: cl ? cl.toFixed(2) : null,
      outcome,
    };
  });

  // P&L per tag, attributed to the order that opened the position.
  const tagsByOrder = new Map(entries.filter((e) => e.j.orderId).map((e) => [e.j.orderId!, e.j.tags.length ? e.j.tags : ["untagged"]]));
  const perTag = new Map<string, { pnl: Decimal; closes: Set<string>; winCloses: Map<string, Decimal> }>();
  for (const m of matches) {
    for (const tag of tagsByOrder.get(m.openOrderId) ?? ["no journal"]) {
      const t = perTag.get(tag) ?? { pnl: new Decimal(0), closes: new Set<string>(), winCloses: new Map<string, Decimal>() };
      t.pnl = t.pnl.plus(m.pnl);
      t.closes.add(m.closeOrderId);
      t.winCloses.set(m.closeOrderId, (t.winCloses.get(m.closeOrderId) ?? new Decimal(0)).plus(m.pnl));
      perTag.set(tag, t);
    }
  }
  return {
    rows,
    perTag: [...perTag.entries()]
      .map(([tag, v]) => ({ tag, pnl: v.pnl.toFixed(2), trades: v.closes.size, wins: [...v.winCloses.values()].filter((x) => x.gt(0)).length }))
      .sort((x, y) => Number(y.pnl) - Number(x.pnl)),
  };
}
