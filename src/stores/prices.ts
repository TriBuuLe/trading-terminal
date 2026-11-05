import { create } from "zustand";
import type { MarketStatus } from "@/lib/market-session";
import type { FeedStatus } from "@/lib/price-feed";
import type { Quote } from "@/lib/types";

/** Live prices keyed by symbol; components select one symbol so ticks don't re-render the page. */
interface PriceState {
  quotes: Record<string, Quote>;
  /** Direction of the last price change, for the flash animation. */
  ticks: Record<string, { dir: "up" | "down"; at: number }>;
  market: MarketStatus | null;
  status: FeedStatus;
  lastSuccess: number | null;
  stale: boolean;
  storedAt: string | null;
  error: string | null;
  /** Symbols requested by mounted components (ref-counted). */
  wanted: Record<string, number>;
  apply(quotes: Record<string, Quote>, meta: { market: MarketStatus; stale: boolean; storedAt: string }): void;
  setStatus(status: FeedStatus, lastSuccess: number | null, error?: string): void;
  want(symbols: string[]): () => void;
}

export const usePrices = create<PriceState>((set, get) => ({
  quotes: {},
  ticks: {},
  market: null,
  status: "idle",
  lastSuccess: null,
  stale: false,
  storedAt: null,
  error: null,
  wanted: {},
  apply(quotes, meta) {
    const prev = get().quotes;
    const ticks = { ...get().ticks };
    const now = Date.now();
    for (const [s, q] of Object.entries(quotes)) {
      const p = prev[s]?.price;
      if (p != null && q.price != null && q.price !== p) ticks[s] = { dir: q.price > p ? "up" : "down", at: now };
    }
    set({ quotes: { ...prev, ...quotes }, ticks, market: meta.market, stale: meta.stale, storedAt: meta.storedAt });
  },
  setStatus(status, lastSuccess, error) {
    set({ status, lastSuccess, error: error ?? null });
  },
  want(symbols) {
    const w = { ...get().wanted };
    for (const s of symbols) w[s] = (w[s] ?? 0) + 1;
    set({ wanted: w });
    return () => {
      const cur = { ...get().wanted };
      for (const s of symbols) {
        cur[s] = (cur[s] ?? 1) - 1;
        if (cur[s]! <= 0) delete cur[s];
      }
      set({ wanted: cur });
    };
  },
}));

export const useQuote = (symbol: string | null | undefined): Quote | undefined =>
  usePrices((s) => (symbol ? s.quotes[symbol] : undefined));
