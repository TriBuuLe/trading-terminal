"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { dateTime, money, price, qty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { Change, EmptyState, ErrorState, LoadingRows, Tag } from "../bits";

interface JournalRow {
  id: number;
  createdAt: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: string;
  orderClass: string;
  qty: string | null;
  notional: string | null;
  why: string;
  tags: string[];
  status: string;
  rejectReason: string | null;
  filledQty: string | null;
  filledAvgPrice: string | null;
  openedRealized: string | null;
  openedClosedQty: string | null;
  closedRealized: string | null;
  outcome: string;
}
interface Journal {
  rows: JournalRow[];
  perTag: { tag: string; pnl: string; trades: number; wins: number }[];
}

const OUTCOME_TONE: Record<string, "up" | "down" | "warn" | "muted" | "info"> = {
  closed: "info",
  "partly closed": "warn",
  open: "muted",
  "closing trade": "muted",
  "not filled": "muted",
  rejected: "down",
};

export function JournalView() {
  const q = useQuery({ queryKey: ["journal"], queryFn: () => api<Journal>("/api/journal"), refetchInterval: 60_000 });
  const [tag, setTag] = useState<string | null>(null);
  const openTicker = useUi((s) => s.openTicker);
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => !tag || r.tags.includes(tag) || (tag === "untagged" && r.tags.length === 0)), [q.data, tag]);

  if (q.isPending) return <LoadingRows rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="scrollbar-thin h-full space-y-3 overflow-auto p-3">
      <section className="rounded-md border border-border bg-background/40 p-3">
        <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Which strategies make money? (realized P&L by tag of the opening order)</h3>
        {q.data.perTag.length === 0 ? (
          <p className="text-xs text-muted-foreground">No closed trades yet. Tag your orders in the ticket; once you close them, P&L per strategy shows here.</p>
        ) : (
          <table className="w-full max-w-xl text-xs">
            <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
              <tr>
                <th className="py-1 text-left font-medium">Tag</th>
                <th className="text-right font-medium">Closed trades</th>
                <th className="text-right font-medium">Win rate</th>
                <th className="text-right font-medium">Realized P&L</th>
              </tr>
            </thead>
            <tbody>
              {q.data.perTag.map((t) => (
                <tr key={t.tag} className={cn("cursor-pointer border-t border-border/50 hover:bg-accent/40", tag === t.tag && "bg-accent/60")} onClick={() => setTag(tag === t.tag ? null : t.tag)}>
                  <td className="py-1">
                    <Tag>{t.tag}</Tag>
                  </td>
                  <td className="num text-right">{t.trades}</td>
                  <td className="num text-right">{t.trades ? `${Math.round((t.wins / t.trades) * 100)}%` : "—"}</td>
                  <td className="text-right">
                    <Change value={t.pnl} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground">Small samples are noise: a strategy needs dozens of closed trades before its win rate means anything.</p>
      </section>

      <section className="rounded-md border border-border bg-background/40">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Trade journal {tag && <>· filtered by “{tag}”</>}</h3>
          {tag && (
            <button className="text-[11px] text-series-1 hover:underline" onClick={() => setTag(null)}>
              Clear filter
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No journal entries" hint="Every order you place from the ticket is logged here with its “why”." />
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] tracking-wider text-muted-foreground uppercase">
              <tr className="border-b border-border text-left">
                <th className="px-3 py-1 font-medium">When</th>
                <th className="px-2 font-medium">Order</th>
                <th className="px-2 font-medium">Why</th>
                <th className="px-2 font-medium">Fill</th>
                <th className="px-2 font-medium">Outcome</th>
                <th className="px-3 text-right font-medium">Realized</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const realized = r.openedRealized ?? r.closedRealized;
                return (
                  <tr key={r.id} className="border-b border-border/50 align-top hover:bg-accent/30">
                    <td className="num px-3 py-1.5 whitespace-nowrap text-muted-foreground">{dateTime(r.createdAt)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span className={cn("font-medium uppercase", r.side === "buy" ? "text-up" : "text-down")}>{r.side}</span>{" "}
                      <span className="num">{r.notional ? money(r.notional) : qty(r.qty)}</span>{" "}
                      <button className="font-mono font-semibold hover:underline" onClick={() => openTicker(r.symbol)}>
                        {r.symbol}
                      </button>
                      <div className="text-[10px] text-muted-foreground">
                        {r.orderType.replace("_", "-")}
                        {r.orderClass === "bracket" && " · bracket"}
                      </div>
                    </td>
                    <td className="max-w-md px-2 py-1.5">
                      <p>{r.why}</p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <button key={t} onClick={() => setTag(t)}>
                            <Tag>{t}</Tag>
                          </button>
                        ))}
                      </div>
                      {r.rejectReason && <p className="mt-0.5 text-[10px] text-down">{r.rejectReason}</p>}
                    </td>
                    <td className="num px-2 py-1.5 whitespace-nowrap">{r.filledQty ? `${qty(r.filledQty)} @ ${price(r.filledAvgPrice)}` : <span className="text-muted-foreground">{r.status}</span>}</td>
                    <td className="px-2 py-1.5">
                      <Tag tone={OUTCOME_TONE[r.outcome] ?? "muted"}>{r.outcome}</Tag>
                    </td>
                    <td className="px-3 py-1.5 text-right">{realized ? <Change value={realized} /> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
