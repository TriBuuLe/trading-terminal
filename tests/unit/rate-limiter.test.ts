import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgTokenBucket, RateLimitedError, refill, waitForToken } from "@/server/rate-limiter";
import { PgCache } from "@/server/cache";
import { testDb } from "../helpers/db";

const t = testDb();
afterAll(() => t.close());
beforeEach(() => t.truncate("rate_limits", "api_usage", "api_cache"));

describe("token bucket math", () => {
  it("refills linearly and caps at capacity", () => {
    expect(refill(0, 60_000, 10, 60)).toBe(10);
    expect(refill(0, 1_000, 10, 60)).toBeCloseTo(1);
    expect(refill(5, 500, 10, 60)).toBeCloseTo(5.5);
    expect(refill(9.5, 10_000, 10, 60)).toBe(10);
    expect(refill(3, -100, 10, 60)).toBe(3); // clock skew never removes tokens
  });

  it("computes wait until the next token", () => {
    expect(waitForToken(1.2, 60)).toBe(0);
    expect(waitForToken(0, 60)).toBe(1000);
    expect(waitForToken(0.5, 200)).toBe(150);
  });
});

describe("PgTokenBucket (shared via Postgres)", () => {
  it("grants up to capacity, then refuses", async () => {
    const b = new PgTokenBucket(() => t.db, "t1", 3, 6); // refill 1 token / 10s
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await b.attempt()).granted);
    expect(results).toEqual([true, true, true, false]);
  });

  it("can't be overspent by concurrent callers on separate connections", async () => {
    const other = testDb(); // a second pool = a second "serverless instance"
    try {
      const a = new PgTokenBucket(() => t.db, "t2", 10, 1); // ~no refill during the test
      const b = new PgTokenBucket(() => other.db, "t2", 10, 1);
      const attempts = await Promise.all(
        Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).attempt()),
      );
      expect(attempts.filter((r) => r.granted).length).toBe(10);
    } finally {
      await other.close();
    }
  });

  it("records per-minute usage and throttles", async () => {
    const b = new PgTokenBucket(() => t.db, "t3", 2, 6);
    await b.attempt();
    await b.attempt();
    await b.attempt();
    const rows = await t.db.execute<{ count: number; throttled: number }>(
      sql`select count, throttled from api_usage where service = 't3'`,
    );
    expect(rows[0]).toEqual({ count: 2, throttled: 1 });
  });

  it("acquire waits for refill instead of failing", async () => {
    const b = new PgTokenBucket(() => t.db, "t4", 1, 600); // 1 token / 100ms
    await b.acquire();
    const t0 = Date.now();
    await b.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
  });

  it("acquire gives up past maxWait", async () => {
    const b = new PgTokenBucket(() => t.db, "t5", 1, 1, 200); // next token in 60s
    await b.acquire();
    await expect(b.acquire()).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("block() (after a 429) stops everyone until it expires", async () => {
    const b = new PgTokenBucket(() => t.db, "t6", 5, 600);
    await b.block(300);
    const r = await b.attempt();
    expect(r.granted).toBe(false);
    expect(r.waitMs).toBeGreaterThan(150);
    await new Promise((res) => setTimeout(res, 320));
    expect((await b.attempt()).granted).toBe(true);
  });
});

describe("PgCache", () => {
  it("returns cached values until TTL, then reloads", async () => {
    const c = new PgCache(() => t.db);
    let calls = 0;
    const load = async () => ({ n: ++calls });
    expect(await c.getOrLoad("k", 200, load)).toEqual({ n: 1 });
    expect(await c.getOrLoad("k", 200, load)).toEqual({ n: 1 });
    await new Promise((r) => setTimeout(r, 250));
    expect(await c.getOrLoad("k", 200, load)).toEqual({ n: 2 });
  });

  it("de-duplicates concurrent loads", async () => {
    const c = new PgCache(() => t.db);
    let calls = 0;
    const load = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return calls;
    };
    await Promise.all([c.getOrLoad("d", 1000, load), c.getOrLoad("d", 1000, load)]);
    expect(calls).toBe(1);
  });

  it("falls back to labeled stale data when the loader fails", async () => {
    const c = new PgCache(() => t.db);
    await c.getOrLoad("s", 50, async () => "old");
    await new Promise((r) => setTimeout(r, 80));
    const r = await c.getOrLoadMeta("s", 50, async () => Promise.reject(new Error("down")));
    expect(r.value).toBe("old");
    expect(r.stale).toBe(true);
    await expect(c.getOrLoad("s", 50, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });
});
