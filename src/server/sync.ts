import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { fills } from "@/db/schema";
import { cache } from "./cache";
import { getAccount, listFills, listOrders } from "./alpaca/trading";
import { upsertOrders } from "./orders";

/**
 * Copy new FILL activities from Alpaca into Postgres (idempotent: keyed by
 * activity id). Throttled through the cache so page loads don't hammer Alpaca.
 */
export async function syncFills(opts: { force?: boolean } = {}): Promise<number> {
  const run = async () => {
    const a = await getAccount();
    const last = await db()
      .select({ t: fills.transactionTime })
      .from(fills)
      .where(eq(fills.accountNumber, a.account_number))
      .orderBy(desc(fills.transactionTime))
      .limit(1);
    // Re-read a small overlap window; the upsert makes duplicates harmless.
    const after = last[0] ? new Date(last[0].t.getTime() - 60 * 60_000).toISOString() : undefined;
    const list = await listFills(after);
    if (list.length) {
      await db()
        .insert(fills)
        .values(
          list.map((f) => ({
            id: f.id,
            accountNumber: a.account_number,
            orderId: f.order_id,
            symbol: f.symbol,
            side: f.side,
            qty: f.qty,
            price: f.price,
            type: f.type,
            transactionTime: new Date(f.transaction_time),
            raw: f,
          })),
        )
        .onConflictDoNothing();
    }
    return list.length;
  };
  if (opts.force) return run();
  return cache.getOrLoad("sync:fills", 20_000, run);
}

/** Copy recent orders (all statuses) into Postgres. */
export async function syncOrders(): Promise<number> {
  const a = await getAccount();
  const orders = await listOrders({ status: "all", limit: 500 });
  await upsertOrders(orders, a.account_number);
  return orders.length;
}

export async function fillsForSymbol(symbol: string) {
  await syncFills();
  const a = await getAccount();
  return db()
    .select()
    .from(fills)
    .where(and(eq(fills.symbol, symbol), eq(fills.accountNumber, a.account_number)))
    .orderBy(fills.transactionTime);
}

export async function allFills() {
  await syncFills();
  return db().select().from(fills).orderBy(fills.transactionTime, sql`${fills.id}`);
}
