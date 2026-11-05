"use client";

import { useQuery } from "@tanstack/react-query";
import { GripVertical, MoreHorizontal, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useWantQuotes } from "@/hooks/price-feed";
import { useWatchlistMutation, useWatchlists } from "@/hooks/queries";
import { api } from "@/lib/api";
import { compact, pct, price, signClass } from "@/lib/format";
import type { Watchlist } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePrices } from "@/stores/prices";
import { useUi } from "@/stores/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, LivePrice, LoadingRows, Panel, SessionTag, Sparkline } from "./bits";
import { SymbolPicker } from "./symbol-search";

interface WatchStats {
  spark: number[];
  avgVolume20: number | null;
}

function Row({
  symbol,
  stats,
  onRemove,
  dragProps,
  dimmed,
}: {
  symbol: string;
  stats: WatchStats | undefined;
  onRemove: () => void;
  dragProps: React.HTMLAttributes<HTMLTableRowElement> & { draggable: boolean };
  dimmed: boolean;
}) {
  const q = usePrices((s) => s.quotes[symbol]);
  const selected = useUi((s) => s.symbol === symbol);
  const openTicker = useUi((s) => s.openTicker);
  const relVol = q?.volume != null && stats?.avgVolume20 ? q.volume / stats.avgVolume20 : null;
  return (
    <tr
      {...dragProps}
      onClick={() => openTicker(symbol)}
      className={cn("group cursor-pointer border-b border-border/50 hover:bg-accent/60", selected && "bg-accent/80", dimmed && "opacity-40")}
    >
      <td className="w-3 pl-1 text-muted-foreground/40 group-hover:text-muted-foreground">
        <GripVertical className="size-3 cursor-grab" />
      </td>
      <td className="py-1 pr-2">
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs font-semibold">{symbol}</span>
          <SessionTag symbol={symbol} />
        </div>
      </td>
      <td className="px-1 text-right">
        <LivePrice symbol={symbol} className="text-xs" />
      </td>
      <td className={cn("num px-1 text-right text-xs", signClass(q?.change))}>{q?.change != null ? `${q.change > 0 ? "+" : q.change < 0 ? "−" : ""}${price(Math.abs(q.change))}` : "—"}</td>
      <td className={cn("num px-1 text-right text-xs", signClass(q?.changePct))}>{pct(q?.changePct)}</td>
      <td className="num px-1 text-right text-[10px] leading-tight text-muted-foreground">
        <div>{price(q?.high)}</div>
        <div>{price(q?.low)}</div>
      </td>
      <td className="num px-1.5 text-right text-[11px]" title={`IEX volume today ${compact(q?.volume)} vs 20-day avg ${compact(stats?.avgVolume20)}`}>
        <span className={cn(relVol !== null && relVol >= 1.5 ? "text-amber-300" : "text-muted-foreground")}>{relVol !== null ? `${relVol.toFixed(1)}×` : "—"}</span>
      </td>
      <td className="px-1">
        <Sparkline values={stats?.spark ?? []} reference={q?.prevClose ?? null} />
      </td>
      <td className="w-5 pr-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${symbol}`}
          className="invisible rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground group-hover:visible"
        >
          <X className="size-3" />
        </button>
      </td>
    </tr>
  );
}

export function WatchlistPanel() {
  const lists = useWatchlists();
  const mutate = useWatchlistMutation();
  const [dragging, setDragging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const active: Watchlist | undefined = lists.data?.find((l) => l.isActive) ?? lists.data?.[0];
  const symbols = useMemo(() => active?.symbols ?? [], [active]);
  useWantQuotes(symbols);

  const stats = useQuery({
    queryKey: ["watchlist-stats", symbols.join(",")],
    queryFn: () => api<Record<string, WatchStats>>(`/api/watchlist-stats?symbols=${symbols.join(",")}`),
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
  });

  const run = (path: string, method: string, body?: unknown, ok?: string) =>
    mutate.mutate(
      { path, method, body },
      {
        onSuccess: () => ok && toast.success(ok),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    );

  const onDrop = (target: string) => {
    if (!active || !dragging || dragging === target) return;
    const next = symbols.filter((s) => s !== dragging);
    next.splice(next.indexOf(target), 0, dragging);
    run(`/api/watchlists/${active.id}/items`, "PUT", { symbols: next });
    setDragging(null);
  };

  const right = (
    <>
      <button onClick={() => setAdding((v) => !v)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Add symbol" title="Add symbol">
        <Plus className="size-3.5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Watchlist menu">
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {lists.data?.map((l) => (
            <DropdownMenuItem key={l.id} onSelect={() => run(`/api/watchlists/${l.id}`, "PATCH", { isActive: true })}>
              <span className={cn(l.id === active?.id && "font-semibold")}>{l.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{l.symbols.length}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              const name = window.prompt("New watchlist name");
              if (name?.trim()) run("/api/watchlists", "POST", { name: name.trim() }, `Created “${name.trim()}”`);
            }}
          >
            New watchlist…
          </DropdownMenuItem>
          {active && (
            <DropdownMenuItem
              onSelect={() => {
                const name = window.prompt("Rename watchlist", active.name);
                if (name?.trim()) run(`/api/watchlists/${active.id}`, "PATCH", { name: name.trim() });
              }}
            >
              Rename “{active.name}”…
            </DropdownMenuItem>
          )}
          {active && (lists.data?.length ?? 0) > 1 && (
            <DropdownMenuItem
              className="text-down"
              onSelect={() => {
                if (window.confirm(`Delete watchlist “${active.name}”?`)) run(`/api/watchlists/${active.id}`, "DELETE");
              }}
            >
              Delete “{active.name}”
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <Panel title={active ? `Watchlist · ${active.name}` : "Watchlist"} right={right} className="h-full">
      {adding && active && (
        <div className="border-b border-border p-2">
          <SymbolPicker
            autoFocus
            placeholder="Add symbol…"
            onPick={(s) => {
              run(`/api/watchlists/${active.id}/items`, "POST", { symbol: s }, `Added ${s}`);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {lists.isPending ? (
        <LoadingRows rows={8} />
      ) : lists.isError ? (
        <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />
      ) : symbols.length === 0 ? (
        <EmptyState title="This watchlist is empty" hint="Click + to add a symbol." />
      ) : (
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-panel text-[10px] tracking-wider text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th />
              <th className="py-1 text-left font-medium">Sym</th>
              <th className="px-1 text-right font-medium">Last</th>
              <th className="px-1 text-right font-medium">Chg</th>
              <th className="px-1 text-right font-medium">%</th>
              <th className="px-1 text-right font-medium" title="Day high / low">H/L</th>
              <th className="px-1.5 text-right font-medium" title="Today's volume vs 20-day average (IEX)">Vol</th>
              <th className="px-1 text-left font-medium">Day</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {symbols.map((s) => (
              <Row
                key={s}
                symbol={s}
                stats={stats.data?.[s]}
                onRemove={() => active && run(`/api/watchlists/${active.id}/items`, "DELETE", { symbol: s })}
                dragProps={{
                  draggable: true,
                  onDragStart: () => setDragging(s),
                  onDragOver: (e) => e.preventDefault(),
                  onDrop: () => onDrop(s),
                  onDragEnd: () => setDragging(null),
                }}
                dimmed={dragging === s}
              />
            ))}
          </tbody>
        </table>
      )}
      {stats.isError && <p className="px-3 py-1 text-[10px] text-down">Sparklines unavailable: {stats.error.message}</p>}
    </Panel>
  );
}
