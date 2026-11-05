"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { dateOnly, money, pct, signClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { Change, EmptyState, ErrorState, LoadingRows } from "../bits";

const RANGES = ["1D", "1W", "1M", "3M", "YTD", "ALL"] as const;
type Range = (typeof RANGES)[number];

interface History {
  range: Range;
  intraday: boolean;
  points: { t: number; equity: number; spy: number | null }[];
  stats: {
    startEquity: number | null;
    endEquity: number | null;
    returnPct: number | null;
    spyReturnPct: number | null;
    excessPct: number | null;
    maxDrawdownPct: number | null;
    sharpe: number | null;
    days: number;
  };
  note: string | null;
}

export interface Performance {
  start: { balance: string; date: string; source: string };
  since: string | null;
  equity: string;
  equityPL: string;
  raw: { realized: string; unrealized: string; total: string };
  realistic: { realized: string; unrealized: string; commissions: string; total: string; gap: string; slippageBps: number; commissionPerTrade: number };
  missingPrices: string[];
  realizedBySymbol: Record<string, string>;
  trades: {
    count: number;
    wins: number;
    losses: number;
    winRate: number | null;
    avgWin: string | null;
    avgLoss: string | null;
    profitFactor: number | string | null;
    recent: { closeOrderId: string; symbol: string; qty: string; pnl: string; closeTime: string }[];
  };
  perTag: { tag: string; pnl: string; trades: number }[];
  slippage: {
    orders: number;
    immediateOrders: number;
    avgBps: number | null;
    medianBps: number | null;
    avgBpsAll: number | null;
    recent: { symbol: string; side: string; arrival: number; basis: string; fill: number; bps: number; delayedFill: boolean; filledAt: string | null }[];
  };
  vsSpy: { myPct: number; spyPct: number | null; spyValue: string | null; verdict: string | null };
  sampleWarning: string | null;
  fillCount: number;
}

interface Allocation {
  byPosition: { name: string; value: number; side: string }[];
  cash: number;
  equity: number;
  bySector: { name: string; value: number }[] | null;
  sectorsEnabled: boolean;
  sectorErrors: string[];
}

// Categorical slots in fixed order (validated on the dark panel surface); 8 max, rest → "Other".
const CAT = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OTHER = "#5b5e66";
const YOU = "#3987e5";
const SPY = "#d95926";

function Tile({ label, children, sub, className }: { label: string; children: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-md border border-border bg-background/40 px-3 py-2", className)}>
      <div className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</div>
      <div className="num mt-0.5 truncate text-lg leading-tight">{children}</div>
      {sub && <div className="num mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function fmtTime(t: number, intraday: boolean) {
  const d = new Date(t * 1000);
  return intraday
    ? d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
}

function EquityChart({ h }: { h: History }) {
  if (h.points.length < 2) {
    return (
      <EmptyState
        title="Not enough history to draw a curve yet"
        hint={h.note ?? "The equity curve fills in as trading days pass. Your SPY comparison starts at your first trade."}
      />
    );
  }
  const data = h.points.map((p) => ({ ...p, label: fmtTime(p.t, h.intraday) }));
  const last = data[data.length - 1]!;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 px-1 pb-1 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: YOU }} /> Your equity
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: SPY, backgroundImage: "repeating-linear-gradient(90deg, transparent 0 3px, #16171a 3px 5px)" }} /> SPY buy &amp; hold
          (same starting $)
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 92, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="#1f2125" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#8b8d93", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#2a2c31" }} minTickGap={40} />
            <YAxis
              tick={{ fill: "#8b8d93", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={64}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => money(v, { whole: true })}
            />
            <Tooltip
              contentStyle={{ background: "#1c1d21", border: "1px solid #2a2c31", borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: "#8b8d93" }}
              formatter={(v, name) => [money(Number(v)), name === "equity" ? "You" : "SPY buy & hold"]}
            />
            <Line type="monotone" dataKey="equity" stroke={YOU} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="spy" stroke={SPY} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="num flex justify-end gap-4 px-1 pt-1 text-[11px] text-muted-foreground">
        <span>
          You <span className="text-foreground">{money(last.equity)}</span>
        </span>
        {last.spy !== null && (
          <span>
            SPY <span className="text-foreground">{money(last.spy)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Donut({ title, slices, empty }: { title: string; slices: { name: string; value: number }[]; empty: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const top = slices.slice(0, CAT.length);
  const rest = slices.slice(CAT.length).reduce((a, s) => a + s.value, 0);
  const data = rest > 0 ? [...top, { name: "Other", value: rest }] : top;
  return (
    <div className="min-w-0 rounded-md border border-border bg-background/40 p-3">
      <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {total <= 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="size-32 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="100%" stroke="#16171a" strokeWidth={2} isAnimationActive={false}>
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={d.name === "Other" || d.name === "Cash" ? OTHER : CAT[i % CAT.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#1c1d21", border: "1px solid #2a2c31", borderRadius: 6, fontSize: 11 }}
                  formatter={(v, n) => [`${money(Number(v))} (${((Number(v) / total) * 100).toFixed(1)}%)`, n]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 flex-1 space-y-0.5 text-[11px]">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center gap-1.5">
                <span className="inline-block size-2 shrink-0 rounded-sm" style={{ background: d.name === "Other" || d.name === "Cash" ? OTHER : CAT[i % CAT.length] }} />
                <span className="truncate">{d.name}</span>
                <span className="num ml-auto text-muted-foreground">{((d.value / total) * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function WouldItWork({ perf }: { perf: Performance }) {
  const r = perf.realistic;
  const setView = useUi((s) => s.setView);
  return (
    <section className="rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <Info className="size-3.5 text-amber-300" /> Would this work for real?
      </h3>
      {perf.sampleWarning && (
        <p className="mb-2 flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          <AlertTriangle className="size-3.5 shrink-0" />
          {perf.sampleWarning}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        <Tile label="Paper P&L (FIFO)" sub={`realized ${money(perf.raw.realized, { sign: true })} · open ${money(perf.raw.unrealized, { sign: true })}`}>
          <span className={signClass(perf.raw.total)}>{money(perf.raw.total, { sign: true })}</span>
        </Tile>
        <Tile label="Realistic P&L" sub={`${r.slippageBps} bps/side slippage · $${r.commissionPerTrade}/trade`}>
          <span className={signClass(r.total)}>{money(r.total, { sign: true })}</span>
        </Tile>
        <Tile label="Paper optimism (gap)" sub="what perfect paper fills add">
          {money(r.gap)}
        </Tile>
        <Tile
          label="Measured slippage"
          sub={perf.slippage.immediateOrders ? `median ${perf.slippage.medianBps?.toFixed(1)} bps · ${perf.slippage.immediateOrders} market orders` : "no filled market orders yet"}
        >
          {perf.slippage.avgBps !== null ? `${perf.slippage.avgBps > 0 ? "+" : ""}${perf.slippage.avgBps.toFixed(1)} bps` : "—"}
        </Tile>
      </div>
      <p className="mt-2 text-sm">{perf.vsSpy.verdict}</p>
      {perf.vsSpy.spyValue && (
        <p className="num mt-0.5 text-[11px] text-muted-foreground">
          Same {money(perf.start.balance)} in SPY since {dateOnly(perf.since)} would be worth {money(perf.vsSpy.spyValue)}; you have {money(perf.equity)}.
        </p>
      )}
      {perf.missingPrices.length > 0 && <p className="mt-1 text-[11px] text-down">No current price for {perf.missingPrices.join(", ")}: their open P&L is excluded.</p>}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Paper fills assume you always get the quoted price. Realistic P&L charges {r.slippageBps} bps against you on every fill (set SLIPPAGE_BPS) and exit costs on open positions.
        Measured slippage compares the quote saved when you clicked submit with Alpaca&apos;s actual fill (market orders filled within 5 min).{" "}
        <button className="text-series-1 hover:underline" onClick={() => setView("settings")}>
          Starting balance &amp; date settings
        </button>
      </p>
    </section>
  );
}

export function PortfolioView() {
  const [range, setRange] = useState<Range>("ALL");
  const hist = useQuery({ queryKey: ["history", range], queryFn: () => api<History>(`/api/portfolio/history?range=${range}`), refetchInterval: range === "1D" ? 60_000 : 300_000 });
  const perf = useQuery({ queryKey: ["performance"], queryFn: () => api<Performance>("/api/portfolio/performance"), refetchInterval: 60_000 });
  const alloc = useQuery({ queryKey: ["allocation"], queryFn: () => api<Allocation>("/api/portfolio/allocation"), refetchInterval: 60_000 });
  const openTicker = useUi((s) => s.openTicker);
  const s = hist.data?.stats;
  const p = perf.data;

  return (
    <div className="@container scrollbar-thin h-full space-y-3 overflow-auto p-3">
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4 @5xl:grid-cols-8">
        <Tile label={`Return (${range})`}>
          <span className={signClass(s?.returnPct)}>{pct(s?.returnPct)}</span>
        </Tile>
        <Tile label={`SPY (${range})`}>
          <span className={signClass(s?.spyReturnPct)}>{pct(s?.spyReturnPct)}</span>
        </Tile>
        <Tile label="Vs SPY">
          <span className={signClass(s?.excessPct)}>{s?.excessPct != null ? `${s.excessPct >= 0 ? "+" : "−"}${Math.abs(s.excessPct).toFixed(2)} pts` : "—"}</span>
        </Tile>
        <Tile label="Max drawdown">{s?.maxDrawdownPct != null ? (s.maxDrawdownPct > 0 ? `−${s.maxDrawdownPct.toFixed(2)}%` : "0.00%") : "—"}</Tile>
        <Tile label="Sharpe (ann.)" sub={s && s.days < 20 ? `${s.days} daily returns: too few` : undefined}>
          {s?.sharpe != null ? s.sharpe.toFixed(2) : "—"}
        </Tile>
        <Tile label="Win rate" sub={p ? `${p.trades.wins}W / ${p.trades.losses}L` : undefined}>
          {p?.trades.winRate != null ? `${(p.trades.winRate * 100).toFixed(0)}%` : "—"}
        </Tile>
        <Tile label="Avg win / loss" sub={p?.trades.profitFactor != null ? `profit factor ${typeof p.trades.profitFactor === "number" ? p.trades.profitFactor.toFixed(2) : p.trades.profitFactor}` : undefined}>
          <span className="text-sm">
            <span className="text-up">{money(p?.trades.avgWin ?? null)}</span> / <span className="text-down">{money(p?.trades.avgLoss ?? null)}</span>
          </span>
        </Tile>
        <Tile label="Closed trades" sub={p ? `${p.fillCount} fills` : undefined}>
          {p?.trades.count ?? "—"}
        </Tile>
      </div>

      <section className="rounded-md border border-border bg-background/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold">Equity vs SPY buy &amp; hold</h3>
          <div className="flex gap-0.5 text-xs">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} className={cn("rounded px-2 py-0.5", r === range ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="h-72">{hist.isPending ? <LoadingRows rows={8} /> : hist.isError ? <ErrorState error={hist.error} onRetry={() => void hist.refetch()} /> : <EquityChart h={hist.data} />}</div>
      </section>

      {perf.isPending ? <LoadingRows rows={4} /> : perf.isError ? <ErrorState error={perf.error} onRetry={() => void perf.refetch()} /> : <WouldItWork perf={perf.data} />}

      <div className="grid gap-3 @3xl:grid-cols-2">
        {alloc.isPending ? (
          <LoadingRows rows={4} />
        ) : alloc.isError ? (
          <ErrorState error={alloc.error} />
        ) : (
          <>
            <Donut
              title="Allocation by position"
              slices={[...alloc.data.byPosition, ...(alloc.data.cash > 0 ? [{ name: "Cash", value: alloc.data.cash }] : [])]}
              empty="No positions or cash."
            />
            {alloc.data.sectorsEnabled ? (
              <Donut title="Allocation by sector (Finnhub)" slices={alloc.data.bySector ?? []} empty="No positions yet." />
            ) : (
              <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                <h3 className="mb-2 text-[10px] font-semibold tracking-wider uppercase">Allocation by sector</h3>
                Add a FINNHUB_API_KEY to group positions by sector.
              </div>
            )}
          </>
        )}
      </div>

      {p && (
        <div className="grid gap-3 @3xl:grid-cols-2">
          <section className="rounded-md border border-border bg-background/40 p-3">
            <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Realized P&L by symbol (FIFO)</h3>
            {Object.keys(p.realizedBySymbol).length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing closed yet.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(p.realizedBySymbol)
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .map(([sym, v]) => (
                      <tr key={sym} className="border-b border-border/50">
                        <td className="py-1">
                          <button className="font-mono font-semibold hover:underline" onClick={() => openTicker(sym)}>
                            {sym}
                          </button>
                        </td>
                        <td className="py-1 text-right">
                          <Change value={v} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="rounded-md border border-border bg-background/40 p-3">
            <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Recent closed trades</h3>
            {p.trades.recent.length === 0 ? (
              <p className="text-xs text-muted-foreground">No closed trades yet. A trade counts once you sell (or cover) shares you opened.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {p.trades.recent.slice(0, 12).map((t) => (
                    <tr key={t.closeOrderId} className="border-b border-border/50">
                      <td className="num py-1 text-muted-foreground">{dateOnly(t.closeTime)}</td>
                      <td className="py-1 font-mono font-semibold">{t.symbol}</td>
                      <td className="num py-1 text-right text-muted-foreground">{t.qty} sh</td>
                      <td className="py-1 text-right">
                        <Change value={t.pnl} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
