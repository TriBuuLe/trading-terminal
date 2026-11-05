"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { alertKeys, useAlerts } from "@/hooks/alert-engine";
import { useConfig } from "@/hooks/queries";
import { useWantQuotes } from "@/hooks/price-feed";
import type { AlertDef } from "@/lib/alerts";
import { api } from "@/lib/api";
import { dateTime, price } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LivePrice, LoadingRows, Tag } from "../bits";

interface AlertEvent {
  id: number;
  alertId: number | null;
  symbol: string;
  kind: string;
  message: string;
  price: number | null;
  firedAt: string;
  seen: boolean;
}

const KIND_LABEL = { above: "Price above", below: "Price below", pct_move: "Daily move ≥ %", earnings: "Earnings within (days)" } as const;

function describe(a: AlertDef) {
  if (a.kind === "above") return `≥ ${price(a.threshold)}`;
  if (a.kind === "below") return `≤ ${price(a.threshold)}`;
  if (a.kind === "pct_move") return `±${a.threshold}% today`;
  return `earnings within ${a.threshold}d`;
}

function NotificationButton() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  if (perm === "unsupported") return <span className="text-[11px] text-muted-foreground">Browser notifications not supported</span>;
  if (perm === "granted") return <span className="text-[11px] text-up">Browser notifications on</span>;
  if (perm === "denied") return <span className="text-[11px] text-muted-foreground">Notifications blocked in browser settings (toasts still show)</span>;
  return (
    <Button size="xs" variant="outline" onClick={() => void Notification.requestPermission().then(setPerm)}>
      <Bell /> Enable browser notifications
    </Button>
  );
}

export function AlertsView() {
  const qc = useQueryClient();
  const symbol = useUi((s) => s.symbol);
  const alerts = useAlerts();
  const events = useQuery({ queryKey: alertKeys.events, queryFn: () => api<AlertEvent[]>("/api/alerts/events"), refetchInterval: 60_000 });
  const { data: cfg } = useConfig();
  const [sym, setSym] = useState(symbol);
  const [kind, setKind] = useState<AlertDef["kind"]>("above");
  const [threshold, setThreshold] = useState("");
  const [repeat, setRepeat] = useState(false);
  useWantQuotes((alerts.data ?? []).map((a) => a.symbol));

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: alertKeys.list }), qc.invalidateQueries({ queryKey: alertKeys.events })]);
  const create = useMutation({
    mutationFn: () => api("/api/alerts", { method: "POST", body: { symbol: sym.trim().toUpperCase(), kind, threshold: Number(threshold), repeat } }),
    onSuccess: async () => {
      toast.success("Alert created");
      setThreshold("");
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const act = (path: string, method: string, b?: unknown) =>
    api(path, { method, body: b })
      .then(refresh)
      .catch((e: Error) => toast.error(e.message));

  const field = "h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring";
  return (
    <div className="scrollbar-thin h-full space-y-3 overflow-auto p-3">
      <section className="rounded-md border border-border bg-background/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold">New alert</h3>
          <NotificationButton />
        </div>
        <form
          className="flex flex-wrap items-end gap-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (!threshold || Number.isNaN(Number(threshold))) return toast.error("Enter a number");
            create.mutate();
          }}
        >
          <input aria-label="Symbol" className={cn(field, "w-24 font-mono uppercase")} value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} />
          <select aria-label="Alert type" className={field} value={kind} onChange={(e) => setKind(e.target.value as AlertDef["kind"])}>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k} disabled={k === "earnings" && !cfg?.finnhubEnabled}>
                {l}
                {k === "earnings" && !cfg?.finnhubEnabled ? " (needs Finnhub key)" : ""}
              </option>
            ))}
          </select>
          <input aria-label="Threshold" className={cn(field, "num w-24")} inputMode="decimal" placeholder={kind === "pct_move" ? "5" : kind === "earnings" ? "7" : "price"} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          {kind !== "earnings" && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repeat (15-min cooldown)
            </label>
          )}
          <Button size="sm" type="submit" disabled={create.isPending}>
            Create
          </Button>
        </form>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Price alerts are checked in this browser against live quotes while the app is open (toast + browser notification). Earnings alerts are checked by the daily job and
          shown as a banner. Nothing fires while the app is closed (that needs an always-on server).
        </p>
      </section>

      <section className="rounded-md border border-border bg-background/40">
        <h3 className="border-b border-border px-3 py-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Your alerts</h3>
        {alerts.isPending ? (
          <LoadingRows rows={3} />
        ) : alerts.isError ? (
          <ErrorState error={alerts.error} />
        ) : alerts.data.length === 0 ? (
          <EmptyState title="No alerts yet" />
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {alerts.data.map((a) => (
                <tr key={a.id} className={cn("border-b border-border/50", !a.active && "text-muted-foreground")}>
                  <td className="px-3 py-1.5 font-mono font-semibold">{a.symbol}</td>
                  <td className="px-2">{describe(a)}</td>
                  <td className="px-2 text-right">{a.kind !== "earnings" && <LivePrice symbol={a.symbol} />}</td>
                  <td className="px-2">{a.repeat && <Tag>repeat</Tag>}</td>
                  <td className="num px-2 text-[11px] text-muted-foreground">{a.lastFiredAt ? `fired ${dateTime(a.lastFiredAt)}` : ""}</td>
                  <td className="px-2 text-right whitespace-nowrap">
                    <label className="mr-2 inline-flex items-center gap-1">
                      <input type="checkbox" checked={a.active} onChange={(e) => void act(`/api/alerts/${a.id}`, "PATCH", { active: e.target.checked })} /> active
                    </label>
                    <button aria-label="Delete alert" className="rounded p-1 hover:bg-secondary" onClick={() => void act(`/api/alerts/${a.id}`, "DELETE")}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-md border border-border bg-background/40">
        <h3 className="border-b border-border px-3 py-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Fired alerts log</h3>
        {events.isPending ? (
          <LoadingRows rows={3} />
        ) : events.isError ? (
          <ErrorState error={events.error} />
        ) : events.data.length === 0 ? (
          <EmptyState title="Nothing has fired yet" />
        ) : (
          <ul className="divide-y divide-border/50 text-xs">
            {events.data.map((e) => (
              <li key={e.id} className="flex gap-3 px-3 py-1.5">
                <span className="num shrink-0 text-muted-foreground">{dateTime(e.firedAt)}</span>
                <Tag tone={e.kind === "earnings" ? "warn" : "info"}>{e.kind.replace("_", " ")}</Tag>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
