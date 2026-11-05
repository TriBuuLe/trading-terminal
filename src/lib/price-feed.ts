import type { MarketStatus } from "./market-session";
import type { Quote, QuotesResponse } from "./types";

/**
 * Where live prices come from. v1 = batched REST polling (works on serverless).
 * A WebSocket relay can implement this same interface later without touching UI code.
 */
export interface PriceFeed {
  /** Replace the set of symbols being watched. */
  setSymbols(symbols: string[]): void;
  start(): void;
  stop(): void;
  /** Force an immediate refresh (e.g. after placing an order). */
  refresh(): void;
}

export type FeedStatus = "live" | "retrying" | "down" | "paused" | "idle";

export interface FeedEvents {
  onQuotes(quotes: Record<string, Quote>, meta: { market: MarketStatus; stale: boolean; storedAt: string; fetchedAt: string }): void;
  onStatus(status: FeedStatus, info: { lastSuccess: number | null; nextInMs: number | null; error?: string }): void;
}

/** Poll interval by session: fast in regular hours, slow in extended, none when closed. */
export function intervalFor(session: MarketStatus["session"] | null, baseMs: number): number | null {
  switch (session) {
    case "open":
      return baseMs;
    case "pre":
    case "after":
      return 30_000;
    case "closed":
      return null; // one fetch on start/focus shows the last price; then stop
    default:
      return baseMs;
  }
}

export class PollingPriceFeed implements PriceFeed {
  private symbols: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inflight: AbortController | null = null;
  private failures = 0;
  private lastSuccess: number | null = null;
  private session: MarketStatus["session"] | null = null;
  private readonly onVisibility = () => {
    if (document.hidden) this.pause();
    else if (this.running) this.tick(0);
  };

  constructor(
    private readonly baseMs: number,
    private readonly events: FeedEvents,
    private readonly fetcher: (symbols: string[], signal: AbortSignal) => Promise<QuotesResponse> = defaultFetcher,
  ) {}

  setSymbols(symbols: string[]): void {
    const next = [...new Set(symbols)].sort();
    const changed = next.join(",") !== this.symbols.join(",");
    this.symbols = next;
    if (changed && this.running) this.tick(0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.tick(0);
  }

  stop(): void {
    this.running = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.clear();
    this.events.onStatus("idle", { lastSuccess: this.lastSuccess, nextInMs: null });
  }

  refresh(): void {
    if (this.running) this.tick(0);
  }

  private pause(): void {
    this.clear();
    this.events.onStatus("paused", { lastSuccess: this.lastSuccess, nextInMs: null });
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inflight?.abort();
    this.inflight = null;
  }

  private tick(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (!this.running || document.hidden) return;
    if (this.symbols.length === 0) return;
    this.inflight?.abort();
    const ctrl = new AbortController();
    this.inflight = ctrl;
    try {
      const res = await this.fetcher(this.symbols, ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.failures = 0;
      this.lastSuccess = Date.now();
      this.session = res.market.session;
      this.events.onQuotes(res.quotes, { market: res.market, stale: res.stale, storedAt: res.storedAt, fetchedAt: res.fetchedAt });
      const next = intervalFor(this.session, this.baseMs);
      this.events.onStatus(res.stale ? "retrying" : next === null ? "paused" : "live", {
        lastSuccess: this.lastSuccess,
        nextInMs: next,
      });
      if (next !== null) this.tick(next);
      else this.scheduleAt(res.market.nextEventAt);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.failures++;
      // Exponential back-off with jitter (also covers 429/503 from our limiter).
      const backoff = Math.min(60_000, this.baseMs * 2 ** this.failures) * (0.8 + Math.random() * 0.4);
      this.events.onStatus(this.failures >= 4 ? "down" : "retrying", {
        lastSuccess: this.lastSuccess,
        nextInMs: backoff,
        error: e instanceof Error ? e.message : String(e),
      });
      this.tick(backoff);
    }
  }

  /** Market closed: wake up when the next session (pre-market or open) begins. */
  private scheduleAt(iso: string): void {
    const ms = new Date(iso).getTime() - Date.now();
    // Pre-market starts 5.5h before the open; check at the earlier of the two, at most every 30 min.
    const wake = Math.max(60_000, Math.min(30 * 60_000, ms - 5.5 * 3600_000 > 0 ? ms - 5.5 * 3600_000 : ms));
    this.tick(wake);
  }
}

async function defaultFetcher(symbols: string[], signal: AbortSignal): Promise<QuotesResponse> {
  const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, { signal, cache: "no-store" });
  if (res.status === 401) {
    // Full reload on purpose: the login page is server-rendered and sets auth cookies.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
    throw new Error("Signed out");
  }
  if (!res.ok) throw new Error(`quotes HTTP ${res.status}`);
  return (await res.json()) as QuotesResponse;
}
