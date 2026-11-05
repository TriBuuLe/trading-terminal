"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MarketStatus } from "@/lib/market-session";
import type { AccountSummary, AppConfig, OrderRow, PositionRow, Watchlist } from "@/lib/types";

export const qk = {
  config: ["config"] as const,
  account: ["account"] as const,
  market: ["market"] as const,
  positions: ["positions"] as const,
  orders: (status: "open" | "closed") => ["orders", status] as const,
  watchlists: ["watchlists"] as const,
};

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: () => api<AppConfig>("/api/config"), staleTime: Infinity });
}

/** Account + positions + open orders refresh every 5s (≈36 Alpaca calls/min total, well under budget). */
export function useAccount() {
  return useQuery({ queryKey: qk.account, queryFn: () => api<AccountSummary>("/api/account"), refetchInterval: 5_000 });
}

export function useMarket() {
  return useQuery({ queryKey: qk.market, queryFn: () => api<MarketStatus>("/api/market"), refetchInterval: 30_000 });
}

export function usePositions() {
  return useQuery({ queryKey: qk.positions, queryFn: () => api<PositionRow[]>("/api/positions"), refetchInterval: 5_000 });
}

export function useOrders(status: "open" | "closed") {
  return useQuery({
    queryKey: qk.orders(status),
    queryFn: () => api<OrderRow[]>(`/api/orders?status=${status}&limit=${status === "open" ? 100 : 200}`),
    refetchInterval: status === "open" ? 5_000 : 30_000,
  });
}

export function useWatchlists() {
  return useQuery({ queryKey: qk.watchlists, queryFn: () => api<Watchlist[]>("/api/watchlists") });
}

/** Invalidate everything an order can change. */
export function useRefreshTrading() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.account }),
      qc.invalidateQueries({ queryKey: qk.positions }),
      qc.invalidateQueries({ queryKey: ["orders"] }),
    ]);
}

export function useWatchlistMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { path: string; method: string; body?: unknown }) => api<Watchlist[]>(args.path, { method: args.method, body: args.body }),
    onSuccess: (lists) => qc.setQueryData(qk.watchlists, lists),
  });
}
