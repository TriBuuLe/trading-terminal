"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { dateOnly, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, LoadingRows } from "../bits";

interface Settings {
  accountNumber: string;
  start: { balance: string; date: string; source: "auto" | "manual" };
  slippageBps: number;
  commissionPerTrade: number;
  quotePollMs: number;
  dataFeed: string;
  finnhubEnabled: boolean;
  budgets: Record<string, number>;
  usage: { service: string; minute: string; count: number; throttled: number }[];
}

function StartForm({ s }: { s: Settings }) {
  const qc = useQueryClient();
  const [bal, setBal] = useState(s.start.balance);
  const [date, setDate] = useState(s.start.date);
  const save = useMutation({
    mutationFn: () => api("/api/settings", { method: "PUT", body: { startBalance: bal.trim(), startDate: date } }),
    onSuccess: async () => {
      toast.success("Starting balance saved");
      await qc.invalidateQueries();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="sb" className="text-xs">
          Starting balance ($)
        </Label>
        <Input id="sb" className="num h-8 w-36" value={bal} onChange={(e) => setBal(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="sd" className="text-xs">
          Start date
        </Label>
        <Input id="sd" type="date" className="num h-8 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Button size="sm" type="submit" disabled={save.isPending}>
        Save
      </Button>
    </form>
  );
}

export function SettingsView() {
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/api/settings"), refetchInterval: 15_000 });
  if (q.isPending) return <LoadingRows rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const perService = new Map<string, { count: number; throttled: number }>();
  const thisMinute = s.usage[0]?.minute;
  for (const u of s.usage.filter((x) => x.minute === thisMinute)) perService.set(u.service, { count: u.count, throttled: u.throttled });

  return (
    <div className="scrollbar-thin h-full max-w-3xl space-y-4 overflow-auto p-4 text-sm">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Account start (for all-time P&L and the SPY benchmark)</h3>
        <p className="text-xs text-muted-foreground">
          Paper account <span className="num">{s.accountNumber}</span> · currently {money(s.start.balance)} since {dateOnly(s.start.date)} ({s.start.source === "auto" ? "detected from Alpaca" : "set by you"}).
        </p>
        <StartForm key={`${s.start.balance}-${s.start.date}`} s={s} />
        <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] p-3 text-xs">
          <p className="font-medium text-amber-300">Make the test honest: trade the amount you&apos;d really use.</p>
          <p className="mt-1 text-muted-foreground">
            Alpaca paper accounts start at $100,000. If you&apos;d really invest, say, $5,000, reset the paper account to that balance in the Alpaca dashboard (Paper account → Reset), then
            set the same balance and date here. A reset creates a new paper account, so generate new API keys afterwards. Your old orders and fills stay in this app&apos;s
            history.
          </p>
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold">Realism assumptions</h3>
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          <li>
            Slippage: <span className="num text-foreground">{s.slippageBps} bps</span> per side (SLIPPAGE_BPS in .env.local)
          </li>
          <li>
            Commission: <span className="num text-foreground">{money(s.commissionPerTrade)}</span> per trade (COMMISSION_PER_TRADE)
          </li>
          <li>
            Data feed: <span className="text-foreground">{s.dataFeed === "iex" ? "IEX real-time (free tier)" : "SIP"}</span>. IEX is a few % of US volume, so prices can differ slightly from
            the consolidated tape and volumes look small.
          </li>
          <li>Fundamentals (Finnhub): {s.finnhubEnabled ? "enabled" : "not configured (set FINNHUB_API_KEY)"}</li>
        </ul>
      </section>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold">Upstream request budget (this minute)</h3>
        <table className="w-full max-w-md text-xs">
          <tbody>
            {Object.entries(s.budgets).map(([svc, budget]) => {
              const u = perService.get(svc);
              const used = u?.count ?? 0;
              return (
                <tr key={svc} className="border-b border-border/50">
                  <td className="py-1">{svc}</td>
                  <td className="w-40 py-1">
                    <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                      <div className="h-full bg-series-1" style={{ width: `${Math.min(100, (used / budget) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="num py-1 text-right">
                    {used} / {budget}
                    {u?.throttled ? <span className="text-amber-300"> · {u.throttled} queued</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[10px] text-muted-foreground">Limits: Alpaca 200/min (data and trading), Finnhub 60/min. A shared Postgres token bucket keeps every tab and server instance under them.</p>
      </section>
    </div>
  );
}
