import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { intervalFor, PollingPriceFeed, type FeedStatus } from "@/lib/price-feed";
import type { MarketStatus } from "@/lib/market-session";
import type { QuotesResponse } from "@/lib/types";

// Minimal document stub (vitest runs in node).
const listeners: Record<string, Array<() => void>> = {};
const doc = {
  hidden: false,
  addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
  removeEventListener: (t: string, f: () => void) => (listeners[t] = (listeners[t] ?? []).filter((x) => x !== f)),
};
const setHidden = (h: boolean) => {
  doc.hidden = h;
  (listeners.visibilitychange ?? []).forEach((f) => f());
};

const market = (session: MarketStatus["session"]): MarketStatus => ({
  session,
  nextEvent: "open",
  nextEventAt: new Date(Date.now() + 10 * 3600_000).toISOString(),
  isTradingDay: true,
  serverTime: new Date().toISOString(),
});
const resp = (session: MarketStatus["session"]): QuotesResponse => ({
  quotes: {},
  market: market(session),
  fetchedAt: new Date().toISOString(),
  stale: false,
  storedAt: new Date().toISOString(),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", doc);
  doc.hidden = false;
  for (const k of Object.keys(listeners)) delete listeners[k];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeFeed(session: MarketStatus["session"] | (() => never)) {
  const statuses: FeedStatus[] = [];
  const fetcher = vi.fn(async (_symbols: string[], _signal: AbortSignal) => {
    if (typeof session === "function") return session();
    return resp(session);
  });
  const feed = new PollingPriceFeed(3000, { onQuotes: () => {}, onStatus: (s) => statuses.push(s) }, fetcher);
  return { feed, fetcher, statuses };
}

describe("intervalFor", () => {
  it("3s in regular hours, 30s extended, none when closed", () => {
    expect(intervalFor("open", 3000)).toBe(3000);
    expect(intervalFor("pre", 3000)).toBe(30_000);
    expect(intervalFor("after", 3000)).toBe(30_000);
    expect(intervalFor("closed", 3000)).toBeNull();
  });
});

describe("PollingPriceFeed", () => {
  it("polls about every 3s while the market is open (20/min budget)", async () => {
    const { feed, fetcher } = makeFeed("open");
    feed.setSymbols(["AAPL", "SPY"]);
    feed.start();
    await vi.advanceTimersByTimeAsync(60_000);
    // 1 immediate + one per 3s ≈ 21 calls/min: one batched upstream call each.
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(20);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(21);
    expect((fetcher.mock.calls[0] as unknown[])[0]).toEqual(["AAPL", "SPY"]);
    feed.stop();
  });

  it("stops polling while the tab is hidden and resumes on focus", async () => {
    const { feed, fetcher, statuses } = makeFeed("open");
    feed.setSymbols(["AAPL"]);
    feed.start();
    await vi.advanceTimersByTimeAsync(10);
    const before = fetcher.mock.calls.length;
    setHidden(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher.mock.calls.length).toBe(before);
    expect(statuses.at(-1)).toBe("paused");
    setHidden(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetcher.mock.calls.length).toBe(before + 1);
    feed.stop();
  });

  it("fetches once then stops when the market is closed", async () => {
    const { feed, fetcher, statuses } = makeFeed("closed");
    feed.setSymbols(["AAPL"]);
    feed.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetcher.mock.calls.length).toBe(1);
    expect(statuses.at(-1)).toBe("paused");
    feed.stop();
  });

  it("backs off exponentially on errors (e.g. 429/503) and reports down", async () => {
    const { feed, fetcher, statuses } = makeFeed(() => {
      throw new Error("quotes HTTP 503");
    });
    feed.setSymbols(["AAPL"]);
    feed.start();
    await vi.advanceTimersByTimeAsync(60_000);
    // 3s*2, *4, *8, *16 (≈ 6+12+24+48s) → only ~4 attempts in a minute, not 20.
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(5);
    expect(statuses).toContain("retrying");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(statuses.at(-1)).toBe("down");
    feed.stop();
  });
});
