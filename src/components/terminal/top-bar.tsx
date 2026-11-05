"use client";

import { LogOut, Search, Settings } from "lucide-react";
import { signOutAction } from "@/app/actions";
import { useAccount, useConfig } from "@/hooks/queries";
import { useWantQuotes } from "@/hooks/price-feed";
import { money, pct, price, signClass, arrow } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePrices } from "@/stores/prices";
import { useUi } from "@/stores/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MarketClock } from "./market-clock";
import { Stat } from "./bits";

export const INDEX_SYMBOLS = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "DIA", label: "Dow 30" },
  { symbol: "IWM", label: "Russell 2000" },
  { symbol: "VIXY", label: "Volatility (VIX ETF proxy)" },
];

function IndexChip({ symbol, label }: { symbol: string; label: string }) {
  const q = usePrices((s) => s.quotes[symbol]);
  const openTicker = useUi((s) => s.openTicker);
  return (
    <button
      onClick={() => openTicker(symbol)}
      title={`${label}: click for chart`}
      className="flex flex-col items-start rounded px-1.5 py-0.5 leading-tight hover:bg-accent"
    >
      <span className="text-[10px] font-medium text-muted-foreground">{symbol}</span>
      <span className="num text-xs">
        {price(q?.price)}{" "}
        <span className={signClass(q?.changePct)}>
          {arrow(q?.changePct)}
          {pct(q?.changePct)}
        </span>
      </span>
    </button>
  );
}

export function TopBar() {
  const { data: a, isError, error } = useAccount();
  const { data: cfg } = useConfig();
  const setSearchOpen = useUi((s) => s.setSearchOpen);
  const setView = useUi((s) => s.setView);
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  useWantQuotes(INDEX_SYMBOLS.map((i) => i.symbol));

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-panel px-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold tracking-tight">FOLIO</span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300" title="Paper trading only: no real money">
          PAPER
        </span>
      </div>
      <div className="flex rounded-md border border-border bg-background p-0.5 text-xs" role="tablist" aria-label="Mode">
        {(["planner", "terminal"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn("rounded px-2.5 py-0.5 capitalize", mode === m ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {m === "planner" ? "Planner" : "Terminal"}
          </button>
        ))}
      </div>
      <div className="h-7 w-px bg-border" />
      <MarketClock />
      <div className="h-7 w-px bg-border" />

      {isError ? (
        <span className="text-xs text-down" title={error instanceof Error ? error.message : ""}>
          Account unavailable
        </span>
      ) : (
        <div className="flex items-center gap-5">
          <Stat label="Equity">{a ? money(a.equity) : "…"}</Stat>
          <Stat label="Day P&L">
            {a ? (
              <span className={signClass(a.dayPL)}>
                {money(a.dayPL, { sign: true })} <span className="text-[11px]">({pct(a.dayPLPct)})</span>
              </span>
            ) : (
              "…"
            )}
          </Stat>
          <Stat label="All-time P&L">
            {a ? (
              <span className={signClass(a.allTimePL)} title={`Since ${a.startDate}, starting balance ${money(a.startBalance)}`}>
                {money(a.allTimePL, { sign: true })} <span className="text-[11px]">({pct(a.allTimePLPct)})</span>
              </span>
            ) : (
              "…"
            )}
          </Stat>
          <Stat label="Buying power">{a ? money(a.buyingPower) : "…"}</Stat>
        </div>
      )}

      <div className="h-7 w-px bg-border" />
      <nav aria-label="Indexes" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        {INDEX_SYMBOLS.map((i) => (
          <IndexChip key={i.symbol} {...i} />
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setSearchOpen(true)}
          className="flex h-7 w-52 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:border-ring/60"
        >
          <Search className="size-3.5" />
          <span>Search ticker…</span>
          <kbd className="ml-auto rounded border border-border px-1 font-mono text-[10px]">/</kbd>
          <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className={cn("flex size-7 items-center justify-center rounded-md hover:bg-accent")} aria-label="Account menu">
            <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold uppercase">
              {(cfg?.login ?? "?").slice(0, 2)}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs">
              Signed in as {cfg?.login ?? "…"}
              <div className="num font-normal text-muted-foreground">Paper acct {a?.accountNumber ?? "…"}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setView("settings")}>
              <Settings className="size-3.5" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOutAction()}>
              <LogOut className="size-3.5" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
