"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useMarket, useWatchlistMutation, useWatchlists } from "@/hooks/queries";
import { api } from "@/lib/api";
import { compact, pct, price, signClass, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { EmptyState, ErrorState, LoadingRows, Tag } from "../bits";

interface MoverRow {
  symbol: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  screenerVolume: number | null;
  exchange: string | null;
  name: string | null;
  tradable: boolean;
}
interface Movers {
  lastUpdated: string;
  gainers: MoverRow[];
  losers: MoverRow[];
  mostActive: MoverRow[];
}

const DERIVATIVE = /\b(warrants?|rights?|units?|contingent value)\b/i;

/** Why a row is risky (empty = no flags). Volume is IEX-only, so "tiny" is relative to that feed. */
export function riskFlags(r: MoverRow, minVolume: number): string[] {
  const f: string[] = [];
  if (r.price !== null && r.price < 5) f.push("under $5");
  if ((r.volume ?? 0) < Math.max(minVolume, 10_000)) f.push("tiny volume");
  if (r.name && DERIVATIVE.test(r.name)) f.push("warrant/right/unit");
  if (!r.exchange || r.exchange === "OTC" || !r.tradable) f.push("OTC / not tradable");
  return f;
}

function Table({ rows, minVolume }: { rows: MoverRow[]; minVolume: number }) {
  const openTicker = useUi((s) => s.openTicker);
  const lists = useWatchlists();
  const wl = useWatchlistMutation();
  const active = lists.data?.find((l) => l.isActive);
  if (rows.length === 0) return <EmptyState title="Nothing passes the filters" hint="Loosen min price / volume, or include OTC." />;
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-panel text-[10px] tracking-wider text-muted-foreground uppercase">
        <tr className="border-b border-border">
          <th className="px-2 py-1 text-left font-medium">Symbol</th>
          <th className="px-2 text-right font-medium">Price</th>
          <th className="px-2 text-right font-medium">Chg %</th>
          <th className="px-2 text-right font-medium" title="Today's IEX volume">Vol (IEX)</th>
          <th className="px-2 text-left font-medium">Risk</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const flags = riskFlags(r, minVolume);
          return (
            <tr key={r.symbol} className="cursor-pointer border-b border-border/50 hover:bg-accent/40" onClick={() => openTicker(r.symbol)}>
              <td className="px-2 py-1">
                <div className="font-mono font-semibold">{r.symbol}</div>
                <div className="max-w-52 truncate text-[10px] text-muted-foreground">{r.name ?? "not in Alpaca's tradable list"}</div>
              </td>
              <td className="num px-2 text-right">{price(r.price)}</td>
              <td className={cn("num px-2 text-right", signClass(r.changePct))}>{pct(r.changePct)}</td>
              <td className="num px-2 text-right">{compact(r.volume)}</td>
              <td className="px-2">
                {flags.length ? (
                  <span className="flex flex-wrap gap-1" title={flags.join(", ")}>
                    <AlertTriangle className="size-3 text-amber-300" />
                    {flags.map((f) => (
                      <Tag key={f} tone="warn" className="normal-case">
                        {f}
                      </Tag>
                    ))}
                  </span>
                ) : null}
              </td>
              <td className="px-2 text-right">
                {active && !active.symbols.includes(r.symbol) && r.tradable && (
                  <button
                    title={`Add to ${active.name}`}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      wl.mutate(
                        { path: `/api/watchlists/${active.id}/items`, method: "POST", body: { symbol: r.symbol } },
                        { onSuccess: () => toast.success(`Added ${r.symbol}`), onError: (er) => toast.error(er.message) },
                      );
                    }}
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MoversView() {
  const market = useMarket();
  const open = market.data?.session === "open";
  const q = useQuery({ queryKey: ["movers"], queryFn: () => api<Movers>("/api/movers"), refetchInterval: open ? 60_000 : false });
  const [tab, setTab] = useState<"gainers" | "losers" | "mostActive">("gainers");
  const [minPrice, setMinPrice] = useState(5);
  const [minVolume, setMinVolume] = useState(50_000);
  const [excludeOtc, setExcludeOtc] = useState(true);
  const [hideRisky, setHideRisky] = useState(false);

  const rows = useMemo(() => {
    const list = q.data?.[tab] ?? [];
    return list.filter(
      (r) =>
        (r.price ?? 0) >= minPrice &&
        (r.volume ?? 0) >= minVolume &&
        (!excludeOtc || (r.tradable && r.exchange && r.exchange !== "OTC")) &&
        (!hideRisky || riskFlags(r, minVolume).length === 0),
    );
  }, [q.data, tab, minPrice, minVolume, excludeOtc, hideRisky]);

  const num = "h-6 w-20 rounded border border-input bg-background px-1.5 text-xs num outline-none focus:border-ring";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-1.5 text-xs">
        {(
          [
            ["gainers", "Top gainers"],
            ["losers", "Top losers"],
            ["mostActive", "Most active"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded px-2 py-0.5", tab === k ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}>
            {l}
          </button>
        ))}
        <span className="h-4 w-px bg-border" />
        <label className="flex items-center gap-1">
          Min price $<input className={num} type="number" min={0} step={1} value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value) || 0)} />
        </label>
        <label className="flex items-center gap-1" title="IEX volume (a few % of total US volume)">
          Min vol <input className={num} type="number" min={0} step={10000} value={minVolume} onChange={(e) => setMinVolume(Number(e.target.value) || 0)} />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={excludeOtc} onChange={(e) => setExcludeOtc(e.target.checked)} /> Exclude OTC
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={hideRisky} onChange={(e) => setHideRisky(e.target.checked)} /> Hide high-risk
        </label>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {q.data ? `Alpaca screener · updated ${timeAgo(q.data.lastUpdated)}` : ""}
          {!open && " · refresh paused (market not open)"}
        </span>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        {q.isPending ? <LoadingRows rows={10} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <Table rows={rows} minVolume={minVolume} />}
      </div>
      <p className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        Big % movers are often illiquid penny stocks, warrants or rights: spreads are wide and paper fills there are especially unrealistic.
      </p>
    </div>
  );
}
