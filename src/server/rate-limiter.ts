import { sql } from "drizzle-orm";
import type { DB } from "@/db";

/**
 * Token-bucket rate limiter whose state lives in Postgres, so every serverless
 * instance (and every browser tab) shares one budget per upstream service.
 *
 * One SQL statement per attempt: it locks the bucket row, refills tokens for
 * the elapsed time, takes one token if available (and the service isn't in a
 * 429 back-off window), and bumps the per-minute usage counter. Concurrent
 * callers serialize on the row lock, so the budget can't be overspent.
 */
export interface Limiter {
  readonly name: string;
  acquire(): Promise<void>;
  /** Back off: no one may call this service for `ms` (after an upstream 429). */
  block(ms: number): Promise<void>;
}

export class RateLimitedError extends Error {
  constructor(name: string, waitMs: number) {
    super(`Rate limit budget for ${name} exhausted; try again in ${Math.ceil(waitMs / 1000)}s`);
    this.name = "RateLimitedError";
  }
}

/** Pure refill math, shared by tests. */
export function refill(tokens: number, elapsedMs: number, capacity: number, perMinute: number): number {
  return Math.min(capacity, tokens + Math.max(0, elapsedMs) * (perMinute / 60_000));
}

/** How long until one token is available. */
export function waitForToken(available: number, perMinute: number): number {
  if (available >= 1) return 0;
  return Math.ceil(((1 - available) * 60_000) / perMinute);
}

interface AttemptRow extends Record<string, unknown> {
  granted: boolean;
  avail: number;
  blocked_ms: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PgTokenBucket implements Limiter {
  private ensured = false;

  constructor(
    private readonly db: () => DB,
    readonly name: string,
    readonly capacity: number,
    readonly perMinute: number,
    /** Give up after waiting this long, so a request can't hang a function. */
    private readonly maxWaitMs = 15_000,
  ) {}

  private async ensure(): Promise<void> {
    if (this.ensured) return;
    await this.db().execute(sql`
      insert into rate_limits (name, tokens, updated_at)
      values (${this.name}, ${this.capacity}, clock_timestamp())
      on conflict (name) do nothing`);
    this.ensured = true;
  }

  /** One atomic attempt. Exposed for tests. */
  async attempt(): Promise<{ granted: boolean; waitMs: number }> {
    await this.ensure();
    const perSec = this.perMinute / 60;
    const rows = await this.db().execute<AttemptRow>(sql`
      with cur as (
        select name,
          least(${this.capacity}::float8,
                tokens + greatest(0, extract(epoch from (clock_timestamp() - updated_at))) * ${perSec}::float8) as avail,
          (blocked_until is null or blocked_until <= clock_timestamp()) as open,
          blocked_until
        from rate_limits where name = ${this.name}
        for update
      ),
      upd as (
        update rate_limits r
        set tokens = case when cur.open and cur.avail >= 1 then cur.avail - 1 else cur.avail end,
            updated_at = clock_timestamp()
        from cur where r.name = cur.name
        returning r.name
      ),
      usage as (
        insert into api_usage (service, minute, count, throttled)
        select ${this.name}, date_trunc('minute', clock_timestamp()),
               case when cur.open and cur.avail >= 1 then 1 else 0 end,
               case when cur.open and cur.avail >= 1 then 0 else 1 end
        from cur
        on conflict (service, minute) do update
          set count = api_usage.count + excluded.count,
              throttled = api_usage.throttled + excluded.throttled
        returning service
      )
      select (cur.open and cur.avail >= 1) as granted,
             cur.avail::float8 as avail,
             case when cur.open then null
                  else (extract(epoch from (cur.blocked_until - clock_timestamp())) * 1000)::float8 end as blocked_ms
      from cur, upd, usage`);
    const row = rows[0];
    if (!row) {
      // Row vanished (e.g. table truncated in tests); recreate next time.
      this.ensured = false;
      return { granted: false, waitMs: 50 };
    }
    if (row.granted) return { granted: true, waitMs: 0 };
    const waitMs = row.blocked_ms !== null ? Number(row.blocked_ms) : waitForToken(Number(row.avail), this.perMinute);
    return { granted: false, waitMs: Math.max(10, waitMs) };
  }

  async acquire(): Promise<void> {
    const deadline = Date.now() + this.maxWaitMs;
    for (;;) {
      const r = await this.attempt();
      if (r.granted) return;
      if (Date.now() + r.waitMs > deadline) throw new RateLimitedError(this.name, r.waitMs);
      // Small jitter so waiting callers don't all retry on the same tick.
      await sleep(r.waitMs + Math.random() * 25);
    }
  }

  async block(ms: number): Promise<void> {
    await this.ensure();
    await this.db().execute(sql`
      update rate_limits
      set blocked_until = greatest(coalesce(blocked_until, clock_timestamp()),
                                   clock_timestamp() + make_interval(secs => ${ms / 1000}::float8))
      where name = ${this.name}`);
  }
}
