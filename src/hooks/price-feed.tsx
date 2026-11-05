"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { PollingPriceFeed, type PriceFeed } from "@/lib/price-feed";
import { usePrices } from "@/stores/prices";

const Ctx = createContext<PriceFeed | null>(null);

/** One price feed for the whole app; it polls the union of symbols components ask for. */
export function PriceFeedProvider({ pollMs, children }: { pollMs: number; children: ReactNode }) {
  const feedRef = useRef<PollingPriceFeed | null>(null);
  const wanted = usePrices((s) => s.wanted);
  const symbols = useMemo(() => Object.keys(wanted).sort(), [wanted]);

  useEffect(() => {
    const feed = new PollingPriceFeed(pollMs, {
      onQuotes: (quotes, meta) => usePrices.getState().apply(quotes, meta),
      onStatus: (status, info) => usePrices.getState().setStatus(status, info.lastSuccess, info.error),
    });
    feedRef.current = feed;
    feed.setSymbols(Object.keys(usePrices.getState().wanted));
    feed.start();
    return () => feed.stop();
  }, [pollMs]);

  useEffect(() => {
    feedRef.current?.setSymbols(symbols);
  }, [symbols]);

  const api = useMemo<PriceFeed>(
    () => ({
      setSymbols: (s) => feedRef.current?.setSymbols(s),
      start: () => feedRef.current?.start(),
      stop: () => feedRef.current?.stop(),
      refresh: () => feedRef.current?.refresh(),
    }),
    [],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePriceFeed(): PriceFeed | null {
  return useContext(Ctx);
}

/** Ask the feed to include these symbols while the component is mounted. */
export function useWantQuotes(symbols: string[]): void {
  const key = [...new Set(symbols)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    return usePrices.getState().want(key.split(","));
  }, [key]);
}
