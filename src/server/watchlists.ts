import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { watchlistItems, watchlists } from "@/db/schema";
import type { Watchlist } from "@/lib/types";

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD"];

export async function listWatchlists(): Promise<Watchlist[]> {
  let lists = await db().select().from(watchlists).orderBy(asc(watchlists.position), asc(watchlists.id));
  if (lists.length === 0) {
    // First run: one starter list (real symbols; prices come from Alpaca).
    const [wl] = await db().insert(watchlists).values({ name: "Main", position: 0, isActive: true }).returning();
    await db()
      .insert(watchlistItems)
      .values(DEFAULT_SYMBOLS.map((symbol, i) => ({ watchlistId: wl!.id, symbol, position: i })));
    lists = [wl!];
  }
  const items = await db()
    .select()
    .from(watchlistItems)
    .where(inArray(watchlistItems.watchlistId, lists.map((l) => l.id)))
    .orderBy(asc(watchlistItems.position), asc(watchlistItems.id));
  const active = lists.some((l) => l.isActive) ? null : lists[0]!.id;
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    isActive: l.isActive || l.id === active,
    symbols: items.filter((i) => i.watchlistId === l.id).map((i) => i.symbol),
  }));
}

export async function createWatchlist(name: string): Promise<void> {
  const [{ max }] = (await db().select({ max: sql<number>`coalesce(max(${watchlists.position}), -1)::int` }).from(watchlists)) as [{ max: number }];
  await db().transaction(async (tx) => {
    await tx.update(watchlists).set({ isActive: false });
    await tx.insert(watchlists).values({ name, position: max + 1, isActive: true });
  });
}

export async function updateWatchlist(id: number, patch: { name?: string; isActive?: boolean }): Promise<void> {
  await db().transaction(async (tx) => {
    if (patch.isActive) await tx.update(watchlists).set({ isActive: false });
    await tx.update(watchlists).set(patch).where(eq(watchlists.id, id));
  });
}

export async function deleteWatchlist(id: number): Promise<void> {
  await db().delete(watchlists).where(eq(watchlists.id, id));
}

export async function addSymbol(watchlistId: number, symbol: string): Promise<void> {
  const [{ max }] = (await db()
    .select({ max: sql<number>`coalesce(max(${watchlistItems.position}), -1)::int` })
    .from(watchlistItems)
    .where(eq(watchlistItems.watchlistId, watchlistId))) as [{ max: number }];
  await db()
    .insert(watchlistItems)
    .values({ watchlistId, symbol, position: max + 1 })
    .onConflictDoNothing();
}

export async function removeSymbol(watchlistId: number, symbol: string): Promise<void> {
  await db()
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.watchlistId, watchlistId), eq(watchlistItems.symbol, symbol)));
}

export async function reorderSymbols(watchlistId: number, symbols: string[]): Promise<void> {
  await db().transaction(async (tx) => {
    for (const [i, symbol] of symbols.entries()) {
      await tx
        .update(watchlistItems)
        .set({ position: i })
        .where(and(eq(watchlistItems.watchlistId, watchlistId), eq(watchlistItems.symbol, symbol)));
    }
  });
}
