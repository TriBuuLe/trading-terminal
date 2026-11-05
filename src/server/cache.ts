import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/db";
import { apiCache } from "@/db/schema";

/**
 * Postgres-backed TTL cache (an in-memory cache wouldn't survive between
 * serverless invocations). Expired rows are kept for a while so callers can
 * fall back to clearly-labeled stale data if the upstream is down; the daily
 * cron prunes old rows.
 *
 * The in-process `inflight` map only de-duplicates concurrent loads within one
 * warm instance; correctness never depends on it.
 */
export interface Cached<T> {
  value: T;
  storedAt: Date;
  stale: boolean;
}

export const TTL = {
  quote: 3_000,
  snapshot: 2_500,
  account: 3_000,
  positions: 3_000,
  orders: 3_000,
  clock: 15_000,
  screener: 60_000,
  news: 60_000,
  bars: 30_000,
  barsDaily: 10 * 60_000,
  assets: 6 * 60 * 60_000,
  fundamentals: 24 * 60 * 60_000,
} as const;

export class PgCache {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly getDb: () => DB = defaultDb) {}

  async get<T>(key: string): Promise<{ value: T; storedAt: Date } | undefined> {
    const rows = await this.getDb()
      .select({ value: apiCache.value, storedAt: apiCache.storedAt })
      .from(apiCache)
      .where(and(eq(apiCache.key, key), gt(apiCache.expiresAt, sql`now()`)))
      .limit(1);
    const r = rows[0];
    return r ? { value: r.value as T, storedAt: r.storedAt } : undefined;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const expiresAt = sql`now() + make_interval(secs => ${ttlMs / 1000}::float8)`;
    await this.getDb()
      .insert(apiCache)
      .values({ key, value: value as unknown, storedAt: sql`now()`, expiresAt })
      .onConflictDoUpdate({ target: apiCache.key, set: { value: value as unknown, storedAt: sql`now()`, expiresAt } });
  }

  /** Fresh value from cache or loader. Throws if the loader fails. */
  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    return (await this.getOrLoadMeta(key, ttlMs, load, { allowStale: false })).value;
  }

  /**
   * Like getOrLoad, but if the loader fails and a previous (expired) value
   * exists, returns it flagged `stale: true` with its timestamp.
   */
  async getOrLoadMeta<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
    opts: { allowStale?: boolean } = {},
  ): Promise<Cached<T>> {
    const hit = await this.get<T>(key);
    if (hit) return { ...hit, stale: false };

    let p = this.inflight.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load().then(async (v) => {
        await this.set(key, v, ttlMs);
        return v;
      });
      this.inflight.set(key, p);
      void p.catch(() => {}).finally(() => this.inflight.delete(key));
    }
    try {
      const value = await p;
      return { value, storedAt: new Date(), stale: false };
    } catch (e) {
      if (opts.allowStale !== false) {
        const rows = await this.getDb()
          .select({ value: apiCache.value, storedAt: apiCache.storedAt })
          .from(apiCache)
          .where(eq(apiCache.key, key))
          .limit(1);
        const r = rows[0];
        if (r) return { value: r.value as T, storedAt: r.storedAt, stale: true };
      }
      throw e;
    }
  }

  async invalidate(prefix: string): Promise<void> {
    await this.getDb()
      .delete(apiCache)
      .where(sql`${apiCache.key} like ${prefix.replace(/[%_]/g, "\\$&") + "%"}`);
  }

  /** Delete rows that expired more than `olderThanMs` ago (cron). */
  async prune(olderThanMs = 24 * 60 * 60_000): Promise<void> {
    await this.getDb()
      .delete(apiCache)
      .where(lt(apiCache.expiresAt, sql`now() - make_interval(secs => ${olderThanMs / 1000}::float8)`));
  }
}

declare global {
  var __paperTerminalCache: PgCache | undefined;
}

export const cache: PgCache = (globalThis.__paperTerminalCache ??= new PgCache());
