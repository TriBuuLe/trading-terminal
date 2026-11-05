"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, ExternalLink, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { usePositions, useWatchlistMutation, useWatchlists } from "@/hooks/queries";
import { useWantQuotes } from "@/hooks/price-feed";
import { useNow } from "@/hooks/use-now";
import { api } from "@/lib/api";
import { compact, dateOnly, money, pct, price, qty, timeAgo } from "@/lib/format";
import { summarize, type OhlcvBar } from "@/lib/indicators";
import { cn } from "@/lib/utils";
import { usePrices } from "@/stores/prices";
import { useUi } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Change, EmptyState, ErrorState, LivePrice, LoadingRows, SessionTag, Tag } from "../bits";
import { PriceChart, type FillMark, type Overlays } from "../price-chart";

const RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y"] as const;
type Range = (typeof RANGES)[number];

interface BarsResponse {
  symbol: string;
  range: Range;
  timeframe: string;
  visibleFrom: string;
  bars: OhlcvBar[];
}

export interface NewsItem {
  id: number;
  headline: string;
  summary: string | null;
  source: string | null;
  url: string | null;
  symbols: string[];
  createdAt: string;
}

interface Fundamentals {
  enabled: boolean;
  name?: string | null;
  industry?: string | null;
  marketCapM?: number | null;
  peTTM?: number | null;
  beta?: number | null;
  hi52?: number | null;
  lo52?: number | null;
  grossMarginTTM?: number | null;
  operatingMarginTTM?: number | null;
  netMarginTTM?: number | null;
  weburl?: string | null;
  nextEarnings?: { date: string; hour: string | null; epsEstimate: number | null } | null;
  recommendations?: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[];
  missing?: string[];
}

function Row({ k, v, title }: { k: string; v: React.ReactNode; title?: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5" title={title}>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="num text-right">{v}</dd>
    </div>
  );
}

function Box({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-background/40 p-2.5", className)}>
      <h3 className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Analyst trend as a stacked bar per month with a legend (5 ordered categories). */
function AnalystTrend({ recs }: { recs: NonNullable<Fundamentals["recommendations"]> }) {
  // Ordered diverging scale: strong buy (cool) → strong sell (warm), neutral gray midpoint.
  const segs = [
    { k: "strongBuy", label: "Strong buy", color: "#1c5cab" },
    { k: "buy", label: "Buy", color: "#5598e7" },
    { k: "hold", label: "Hold", color: "#5b5e66" },
    { k: "sell", label: "Sell", color: "#e66767" },
    { k: "strongSell", label: "Strong sell", color: "#b33a3a" },
  ] as const;
  return (
    <div className="space-y-1.5 text-[11px]">
      {recs.map((r) => {
        const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell || 1;
        return (
          <div key={r.period} className="flex items-center gap-2">
            <span className="num w-16 shrink-0 text-muted-foreground">{r.period.slice(0, 7)}</span>
            <div className="flex h-3 flex-1 gap-[2px] overflow-hidden rounded">
              {segs.map((s) =>
                r[s.k] > 0 ? (
                  <div key={s.k} style={{ width: `${(r[s.k] / total) * 100}%`, background: s.color }} title={`${s.label}: ${r[s.k]}`} />
                ) : null,
              )}
            </div>
            <span className="num w-6 text-right text-muted-foreground">{total}</span>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 pt-0.5 text-[10px] text-muted-foreground">
        {segs.map((s) => (
          <span key={s.k} className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function NewsList({ items }: { items: NewsItem[] }) {
  const openTicker = useUi((s) => s.openTicker);
  return (
    <ul className="divide-y divide-border/60">
      {items.map((n) => (
        <li key={n.id} className="py-2">
          <a href={n.url ?? undefined} target="_blank" rel="noopener noreferrer" className="group block">
            <p className="text-xs leading-snug font-medium group-hover:underline">
              {n.headline}
              {n.url && <ExternalLink className="ml-1 inline size-3 text-muted-foreground" />}
            </p>
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            <span>{timeAgo(n.createdAt)}</span>
            {n.source && <span>· {n.source}</span>}
            {n.symbols.slice(0, 6).map((s) => (
              <button key={s} onClick={() => openTicker(s)} className="rounded bg-muted px-1 font-mono text-[10px] text-foreground hover:bg-accent">
                {s}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TickerView() {
  const symbol = useUi((s) => s.symbol);
  const prefill = useUi((s) => s.prefillTicket);
  const setView = useUi((s) => s.setView);
  const q = usePrices((s) => s.quotes[symbol]);
  const [range, setRange] = useState<Range>("6M");
  const [ov, setOv] = useState<Overlays>({ sma20: true, sma50: true, sma200: true, vwap: true, rsi: true, volume: true });
  useWantQuotes([symbol]);

  const positions = usePositions();
  const pos = positions.data?.find((p) => p.symbol === symbol) ?? null;
  const lists = useWatchlists();
  const wl = useWatchlistMutation();
  const active = lists.data?.find((l) => l.isActive);

  const bars = useQuery({
    queryKey: ["bars", symbol, range],
    queryFn: () => api<BarsResponse>(`/api/bars?symbol=${symbol}&range=${range}`),
    refetchInterval: range === "1D" ? 60_000 : false,
  });
  const yearly = useQuery({
    queryKey: ["bars", symbol, "1Y"],
    queryFn: () => api<BarsResponse>(`/api/bars?symbol=${symbol}&range=1Y`),
    staleTime: 10 * 60_000,
  });
  const fills = useQuery({ queryKey: ["fills", symbol], queryFn: () => api<FillMark[]>(`/api/fills?symbol=${symbol}`), refetchInterval: 30_000 });
  const fund = useQuery({ queryKey: ["fundamentals", symbol], queryFn: () => api<Fundamentals>(`/api/fundamentals/${symbol}`), staleTime: 60 * 60_000 });
  const news = useQuery({ queryKey: ["news", symbol], queryFn: () => api<NewsItem[]>(`/api/news?symbols=${symbol}&limit=15`), refetchInterval: 120_000 });

  const now = useNow();
  const stats = useMemo(() => (yearly.data ? summarize(yearly.data.bars) : null), [yearly.data]);
  const daily = bars.data ? bars.data.timeframe === "1Day" : true;
  const f = fund.data;
  const earnSoon = f?.nextEarnings ? (new Date(`${f.nextEarnings.date}T12:00:00Z`).getTime() - now) / 86400_000 <= 7 : false;
  const fillMarks = useMemo(() => fills.data ?? [], [fills.data]);

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col overflow-auto">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xl font-semibold">{symbol}</span>
          <SessionTag symbol={symbol} />
        </div>
        <LivePrice symbol={symbol} className="text-xl" />
        <Change value={q?.change ?? null} percent={q?.changePct ?? null} kind="price" className="text-sm" />
        {pos && (
          <span className="num text-xs text-muted-foreground">
            Position: <span className="text-foreground">{qty(pos.qty)}</span> @ {price(pos.avgEntry)} · <Change value={pos.unrealizedPL} percent={pos.unrealizedPLPct} />
          </span>
        )}
        {earnSoon && f?.nextEarnings && (
          <Tag tone="warn" className="normal-case">
            Earnings {dateOnly(f.nextEarnings.date)}
            {f.nextEarnings.hour === "bmo" ? " (before open)" : f.nextEarnings.hour === "amc" ? " (after close)" : ""}
          </Tag>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" className="bg-up text-white hover:bg-up/90" onClick={() => prefill({ symbol, side: "buy" })}>
            Buy <kbd className="ml-1 font-mono text-[10px] opacity-70">b</kbd>
          </Button>
          <Button size="sm" className="bg-down text-white hover:bg-down/90" onClick={() => prefill({ symbol, side: "sell" })}>
            Sell <kbd className="ml-1 font-mono text-[10px] opacity-70">s</kbd>
          </Button>
          {active && !active.symbols.includes(symbol) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                wl.mutate(
                  { path: `/api/watchlists/${active.id}/items`, method: "POST", body: { symbol } },
                  { onSuccess: () => toast.success(`Added ${symbol} to ${active.name}`), onError: (e) => toast.error(e.message) },
                )
              }
            >
              <Plus /> Watch
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setView("alerts")} title="Create a price alert">
            <Bell /> Alert
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 py-1.5 text-xs">
        {RANGES.map((r) => (
          <button key={r} onClick={() => setRange(r)} className={cn("rounded px-2 py-0.5", range === r ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}>
            {r}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        {(
          [
            ["sma20", "SMA20", "#3987e5"],
            ["sma50", "SMA50", "#c98500"],
            ["sma200", "SMA200", "#9085e9"],
            ["vwap", "VWAP", "#d55181"],
            ["rsi", "RSI14", "#3987e5"],
            ["volume", "Volume", "#5b5e66"],
          ] as const
        ).map(([k, label, color]) => (
          <label key={k} className={cn("flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent", k === "vwap" && daily && "opacity-40")} title={k === "vwap" && daily ? "VWAP is intraday only" : undefined}>
            <input type="checkbox" className="size-3" checked={ov[k]} onChange={(e) => setOv((o) => ({ ...o, [k]: e.target.checked }))} />
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} />
            {label}
          </label>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">{bars.data ? `${bars.data.timeframe} bars · IEX` : ""}</span>
      </div>

      <div className="h-[460px] min-h-[320px] shrink-0 px-1">
        {bars.isPending ? (
          <LoadingRows rows={10} />
        ) : bars.isError ? (
          <ErrorState error={bars.error} onRetry={() => void bars.refetch()} />
        ) : bars.data.bars.length === 0 ? (
          <EmptyState title="No bars for this range" hint="IEX may have no trades in this window (thinly traded stock, or before the session started)." />
        ) : (
          <PriceChart bars={bars.data.bars} daily={daily} visibleFrom={bars.data.visibleFrom} overlays={ov} fills={fillMarks} avgEntry={pos ? Number(pos.avgEntry) : null} />
        )}
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-2 p-3 xl:grid-cols-3">
        <Box title="Key stats">
          {yearly.isError ? (
            <ErrorState error={yearly.error} compact />
          ) : !stats ? (
            <LoadingRows rows={5} className="p-0" />
          ) : (
            <dl className="text-[11px]">
              <Row k="Day range" v={`${price(q?.low)} – ${price(q?.high)}`} />
              <Row k="52-wk range" v={`${price(stats.lo52)} – ${price(stats.hi52)}`} title="From IEX daily bars" />
              <Row k="% from 52-wk high" v={pct(stats.pctFromHi52)} />
              <Row k="SMA 20 / 50 / 200" v={`${price(stats.sma20)} / ${price(stats.sma50)} / ${price(stats.sma200)}`} />
              <Row k="RSI(14)" v={stats.rsi14 !== null ? stats.rsi14.toFixed(1) : "—"} />
              <Row k="Avg vol (20d, IEX)" v={compact(stats.avgVol20)} />
              <Row k="Rel. volume" v={stats.relVol !== null ? `${stats.relVol.toFixed(2)}×` : "—"} />
              {f?.enabled && (
                <>
                  <Row k="Market cap" v={f.marketCapM ? money(f.marketCapM * 1e6, { compact: true }) : "—"} />
                  <Row k="P/E (TTM)" v={f.peTTM?.toFixed(1) ?? "—"} />
                  <Row k="Beta" v={f.beta?.toFixed(2) ?? "—"} />
                  <Row k="Gross / op / net margin" v={[f.grossMarginTTM, f.operatingMarginTTM, f.netMarginTTM].map((m) => (m == null ? "—" : `${m.toFixed(1)}%`)).join(" / ")} />
                  {f.industry && <Row k="Industry" v={<span className="font-sans">{f.industry}</span>} />}
                </>
              )}
            </dl>
          )}
          {f && !f.enabled && <p className="mt-1.5 text-[10px] text-muted-foreground">Add a FINNHUB_API_KEY for P/E, market cap, margins, earnings and analyst data.</p>}
        </Box>

        {f?.enabled ? (
          <Box title="Earnings & analysts">
            <dl className="mb-2 text-[11px]">
              <Row
                k="Next earnings"
                v={
                  f.nextEarnings ? (
                    <span className={cn(earnSoon && "text-amber-300")}>
                      {dateOnly(f.nextEarnings.date)}
                      {earnSoon && " · within 7 days"}
                    </span>
                  ) : (
                    "none in next 90d"
                  )
                }
              />
              {f.nextEarnings?.epsEstimate != null && <Row k="EPS estimate" v={f.nextEarnings.epsEstimate.toFixed(2)} />}
            </dl>
            {f.recommendations && f.recommendations.length > 0 ? <AnalystTrend recs={f.recommendations} /> : <p className="text-[11px] text-muted-foreground">No analyst data.</p>}
            {(f.missing?.length ?? 0) > 0 && <p className="mt-1 text-[10px] text-amber-300">Partial data: {f.missing!.join("; ")}</p>}
          </Box>
        ) : null}

        <Box title={`News · ${symbol}`} className={cn(!f?.enabled && "xl:col-span-2")}>
          {news.isPending ? (
            <LoadingRows rows={4} className="p-0" />
          ) : news.isError ? (
            <ErrorState error={news.error} compact onRetry={() => void news.refetch()} />
          ) : news.data.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No recent headlines.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <NewsList items={news.data} />
            </div>
          )}
        </Box>
      </div>
    </div>
  );
}
