"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { parseOrderText } from "@/lib/palette-parse";
import type { AssetHit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi, type View } from "@/stores/ui";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";

function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useAssetSearch(q: string) {
  const dq = useDebounced(q.trim());
  return useQuery({
    queryKey: ["asset-search", dq.toUpperCase()],
    queryFn: ({ signal }) => api<AssetHit[]>(`/api/assets/search?q=${encodeURIComponent(dq)}`, { signal }),
    enabled: dq.length > 0 && !/^(buy|sell|b|s)\s/i.test(dq),
    staleTime: 5 * 60_000,
  });
}

/** Small inline symbol picker (used by "add to watchlist", alerts, etc.). */
export function SymbolPicker({
  onPick,
  onCancel,
  placeholder = "Symbol…",
  autoFocus,
}: {
  onPick: (symbol: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const res = useAssetSearch(q);
  const hits = res.data ?? [];
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIdx((i) => Math.min(i + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const h = hits[idx];
            if (h) onPick(h.symbol);
          } else if (e.key === "Escape") onCancel?.();
        }}
        className="h-7 w-full rounded-md border border-input bg-background px-2 font-mono text-xs uppercase outline-none placeholder:font-sans placeholder:normal-case focus:border-ring"
      />
      {q && (
        <div className="absolute inset-x-0 top-8 z-30 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {res.isFetching && hits.length === 0 && <div className="p-2 text-xs text-muted-foreground">Searching…</div>}
          {res.isError && <div className="p-2 text-xs text-down">{res.error.message}</div>}
          {!res.isFetching && res.isSuccess && hits.length === 0 && <div className="p-2 text-xs text-muted-foreground">No tradable US stock matches “{q}”.</div>}
          {hits.map((h, i) => (
            <button
              key={h.symbol}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(h.symbol);
              }}
              className={cn("flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs hover:bg-accent", i === idx && "bg-accent")}
            >
              <span className="w-14 shrink-0 font-mono font-semibold">{h.symbol}</span>
              <span className="truncate text-muted-foreground">{h.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{h.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const VIEWS: { view: View; label: string; key?: string }[] = [
  { view: "dashboard", label: "Dashboard: positions & orders", key: "g d" },
  { view: "portfolio", label: "Portfolio: equity vs SPY, stats, would-this-work", key: "g p" },
  { view: "movers", label: "Movers: gainers, losers, most active", key: "g m" },
  { view: "news", label: "News feed", key: "g n" },
  { view: "alerts", label: "Alerts", key: "g a" },
  { view: "journal", label: "Trade journal", key: "g j" },
  { view: "settings", label: "Settings" },
];

/** ⌘K palette: ticker search, navigation, and quick orders ("buy 10 AAPL limit 180"). */
export function CommandPalette() {
  const open = useUi((s) => s.searchOpen || s.paletteOpen);
  const setOpen = (o: boolean) => {
    if (!o) setQ("");
    useUi.getState().setSearchOpen(o);
    useUi.getState().setPaletteOpen(o);
  };
  const [q, setQ] = useState("");
  const res = useAssetSearch(q);
  const parsed = parseOrderText(q);
  const { openTicker, setView, prefillTicket } = useUi.getState();

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search tickers, navigate, or type an order">
      <CommandInput value={q} onValueChange={setQ} placeholder='Ticker, command, or order (e.g. "buy 10 AAPL limit 180")' />
      <CommandList>
        <CommandEmpty>{res.isFetching ? "Searching…" : "No results."}</CommandEmpty>
        {parsed && (
          <CommandGroup heading="Order (opens a filled ticket to review)">
            <CommandItem
              value={`order ${q}`}
              onSelect={() => {
                prefillTicket(parsed);
                openTicker(parsed.symbol);
                setOpen(false);
              }}
            >
              <span className={cn("font-semibold uppercase", parsed.side === "buy" ? "text-up" : "text-down")}>{parsed.side}</span>
              <span className="font-mono">
                {parsed.sizeBy === "dollars" ? `$${parsed.notional}` : parsed.qty} {parsed.symbol}
              </span>
              <span className="text-muted-foreground">
                {parsed.type.replace("_", "-")}
                {parsed.stopPrice ? ` stop ${parsed.stopPrice}` : ""}
                {parsed.limitPrice ? ` limit ${parsed.limitPrice}` : ""}
              </span>
              <CommandShortcut>↵ review</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}
        {(res.data?.length ?? 0) > 0 && (
          <CommandGroup heading="Tickers">
            {res.data!.map((h) => (
              <CommandItem
                key={h.symbol}
                value={`ticker ${h.symbol} ${h.name}`}
                onSelect={() => {
                  openTicker(h.symbol);
                  setOpen(false);
                }}
              >
                <span className="w-16 font-mono font-semibold">{h.symbol}</span>
                <span className="truncate text-muted-foreground">{h.name}</span>
                <CommandShortcut>{h.exchange}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!parsed && (
          <CommandGroup heading="Go to">
            {VIEWS.map((v) => (
              <CommandItem
                key={v.view}
                value={`view ${v.label}`}
                onSelect={() => {
                  setView(v.view);
                  setOpen(false);
                }}
              >
                {v.label}
                {v.key && <CommandShortcut>{v.key}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
