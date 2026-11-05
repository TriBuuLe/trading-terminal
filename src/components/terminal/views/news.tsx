"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { usePositions, useWatchlists } from "@/hooks/queries";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingRows } from "../bits";
import { NewsList, type NewsItem } from "./ticker";

/** Combined headlines for watchlist + positions, newest first. */
export function NewsView() {
  const lists = useWatchlists();
  const positions = usePositions();
  const [filter, setFilter] = useState<string | null>(null);
  const symbols = useMemo(() => {
    const s = new Set<string>();
    positions.data?.forEach((p) => s.add(p.symbol));
    lists.data?.find((l) => l.isActive)?.symbols.forEach((x) => s.add(x));
    return [...s].sort();
  }, [lists.data, positions.data]);
  const held = new Set(positions.data?.map((p) => p.symbol));

  const q = useQuery({
    queryKey: ["news-feed", symbols.join(",")],
    queryFn: () => api<NewsItem[]>(`/api/news?symbols=${symbols.join(",")}&limit=50`),
    enabled: symbols.length > 0,
    refetchInterval: 120_000,
  });
  const items = (q.data ?? []).filter((n) => !filter || n.symbols.includes(filter));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5 text-xs">
        <button onClick={() => setFilter(null)} className={cn("rounded px-2 py-0.5", !filter ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}>
          All
        </button>
        {symbols.map((s) => (
          <button key={s} onClick={() => setFilter(s === filter ? null : s)} className={cn("rounded px-1.5 py-0.5 font-mono", filter === s ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}>
            {s}
            {held.has(s) && <span className="ml-0.5 text-up">•</span>}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">• = you hold it · Alpaca News</span>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto px-3">
        {symbols.length === 0 ? (
          <EmptyState title="No symbols to follow" hint="Add symbols to your watchlist or open a position." />
        ) : q.isPending ? (
          <LoadingRows rows={10} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="No recent headlines" />
        ) : (
          <NewsList items={items} />
        )}
      </div>
    </div>
  );
}
