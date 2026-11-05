"use client";

import { Pencil, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useOrders, usePositions, useRefreshTrading } from "@/hooks/queries";
import { useWantQuotes } from "@/hooks/price-feed";
import { api, ApiError } from "@/lib/api";
import { dateTime, money, pct, price, qty, signClass } from "@/lib/format";
import type { OrderRow, PositionRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Change, EmptyState, ErrorState, LivePrice, LoadingRows, Tag } from "./bits";

const th = "px-2 py-1 font-medium whitespace-nowrap";
const td = "px-2 py-1 whitespace-nowrap";

export function PositionsTable({ compact }: { compact?: boolean }) {
  const q = usePositions();
  const openTicker = useUi((s) => s.openTicker);
  const prefill = useUi((s) => s.prefillTicket);
  useWantQuotes(q.data?.map((p) => p.symbol) ?? []);

  if (q.isPending) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0)
    return <EmptyState title="No open positions" hint="Search a ticker (press /) and use the order ticket on the right to place a paper trade." />;

  const totals = q.data.reduce(
    (a, p) => ({ mv: a.mv + Number(p.marketValue ?? 0), upl: a.upl + Number(p.unrealizedPL ?? 0), today: a.today + Number(p.todayPL ?? 0) }),
    { mv: 0, upl: 0, today: 0 },
  );

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-panel text-[10px] tracking-wider text-muted-foreground uppercase">
        <tr className="border-b border-border text-right">
          <th className={cn(th, "text-left")}>Symbol</th>
          <th className={th}>Qty</th>
          <th className={th}>Avg entry</th>
          <th className={th}>Last</th>
          <th className={th}>Mkt value</th>
          <th className={th}>Unrealized P&L</th>
          <th className={th}>Today</th>
          {!compact && <th className={th}>% port</th>}
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {q.data.map((p: PositionRow) => (
          <tr key={p.symbol} className="cursor-pointer border-b border-border/50 text-right hover:bg-accent/50" onClick={() => openTicker(p.symbol)}>
            <td className={cn(td, "text-left")}>
              <span className="font-mono font-semibold">{p.symbol}</span>
              {p.side === "short" && <Tag tone="down" className="ml-1">short</Tag>}
            </td>
            <td className={cn(td, "num")}>{qty(p.qty)}</td>
            <td className={cn(td, "num")}>{price(p.avgEntry)}</td>
            <td className={td}>
              <LivePrice symbol={p.symbol} />
            </td>
            <td className={cn(td, "num")}>{money(p.marketValue)}</td>
            <td className={td}>
              <Change value={p.unrealizedPL} percent={p.unrealizedPLPct} />
            </td>
            <td className={td}>
              <Change value={p.todayPL} />
            </td>
            {!compact && <td className={cn(td, "num text-muted-foreground")}>{pct(p.pctOfPortfolio, { sign: false, digits: 1 })}</td>}
            <td className={td}>
              <Button
                size="xs"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  prefill({ symbol: p.symbol, side: p.side === "long" ? "sell" : "buy", type: "market", sizeBy: "shares", qty: String(Math.abs(Number(p.qty))) });
                }}
              >
                Close…
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="text-right text-muted-foreground">
          <td className={cn(td, "text-left text-[10px] tracking-wider uppercase")}>Total</td>
          <td colSpan={3} />
          <td className={cn(td, "num text-foreground")}>{money(totals.mv)}</td>
          <td className={cn(td, "num", signClass(totals.upl))}>{money(totals.upl, { sign: true })}</td>
          <td className={cn(td, "num", signClass(totals.today))}>{money(totals.today, { sign: true })}</td>
          <td colSpan={compact ? 1 : 2} />
        </tr>
      </tfoot>
    </table>
  );
}

function statusTone(s: string): "up" | "down" | "warn" | "muted" | "info" {
  if (s === "filled") return "up";
  if (s === "rejected" || s === "expired") return "down";
  if (s === "canceled" || s === "replaced") return "muted";
  if (s === "partially_filled") return "warn";
  return "info";
}

function describe(o: OrderRow): string {
  const parts = [o.type.replace("_", "-")];
  if (o.stopPrice) parts.push(`stop ${price(o.stopPrice)}`);
  if (o.limitPrice) parts.push(`lmt ${price(o.limitPrice)}`);
  return parts.join(" ");
}

function ModifyDialog({ order, onClose }: { order: OrderRow; onClose: () => void }) {
  const [q, setQ] = useState(order.qty ?? "");
  const [lp, setLp] = useState(order.limitPrice ?? "");
  const [sp, setSp] = useState(order.stopPrice ?? "");
  const [busy, setBusy] = useState(false);
  const refresh = useRefreshTrading();
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: {
          qty: q && q !== order.qty ? q : undefined,
          limitPrice: lp && lp !== order.limitPrice ? lp : undefined,
          stopPrice: sp && sp !== order.stopPrice ? sp : undefined,
        },
      });
      toast.success("Order modified (Alpaca replaced it with a new order id)");
      await refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Modify {order.side} {order.symbol}
          </DialogTitle>
          <DialogDescription>Change quantity or prices. Alpaca cancels and replaces the order.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {order.qty && !order.notional && (
            <div className="grid gap-1">
              <Label htmlFor="mq">Quantity</Label>
              <Input id="mq" className="num" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {order.limitPrice && (
            <div className="grid gap-1">
              <Label htmlFor="ml">Limit price</Label>
              <Input id="ml" className="num" value={lp} onChange={(e) => setLp(e.target.value)} />
            </div>
          )}
          {order.stopPrice && (
            <div className="grid gap-1">
              <Label htmlFor="ms">Stop price</Label>
              <Input id="ms" className="num" value={sp} onChange={(e) => setSp(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrdersTable({ status }: { status: "open" | "closed" }) {
  const q = useOrders(status);
  const refresh = useRefreshTrading();
  const openTicker = useUi((s) => s.openTicker);
  const [editing, setEditing] = useState<OrderRow | null>(null);

  const cancel = async (o: OrderRow) => {
    try {
      await api(`/api/orders/${o.id}`, { method: "DELETE" });
      toast.success(`Cancel requested: ${o.side} ${o.symbol}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  if (q.isPending) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0)
    return <EmptyState title={status === "open" ? "No open orders" : "No order history yet"} hint={status === "open" ? "Working limit/stop orders and queued orders show up here." : undefined} />;

  const rows = q.data.flatMap((o) => [{ o, leg: false }, ...o.legs.map((l) => ({ o: l, leg: true }))]);
  return (
    <>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-panel text-[10px] tracking-wider text-muted-foreground uppercase">
          <tr className="border-b border-border text-left">
            <th className={th}>Time</th>
            <th className={th}>Symbol</th>
            <th className={th}>Side</th>
            <th className={th}>Type</th>
            <th className={cn(th, "text-right")}>Qty</th>
            <th className={cn(th, "text-right")}>Filled @</th>
            <th className={th}>TIF</th>
            <th className={th}>Status</th>
            <th className={th}>Why</th>
            {status === "open" && <th className={th} />}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ o, leg }) => {
            const replaceable = status === "open" && !leg && !o.notional && ["new", "partially_filled", "held"].includes(o.status);
            const cancelable = status === "open" && !["pending_cancel", "pending_replace"].includes(o.status);
            return (
              <tr key={o.id} className={cn("border-b border-border/50 hover:bg-accent/40", leg && "text-muted-foreground")}>
                <td className={cn(td, "num text-muted-foreground")}>{dateTime(o.filledAt ?? o.submittedAt)}</td>
                <td className={td}>
                  <button className="font-mono font-semibold hover:underline" onClick={() => openTicker(o.symbol)}>
                    {leg ? "↳ " : ""}
                    {o.symbol}
                  </button>
                </td>
                <td className={cn(td, "font-medium uppercase", o.side === "buy" ? "text-up" : "text-down")}>{o.side}</td>
                <td className={td}>
                  {describe(o)}
                  {o.orderClass === "bracket" && !leg && <Tag className="ml-1">bracket</Tag>}
                  {o.extendedHours && <Tag className="ml-1">ext</Tag>}
                </td>
                <td className={cn(td, "num text-right")}>
                  {o.notional ? money(o.notional) : qty(o.qty)}
                  {Number(o.filledQty) > 0 && o.status !== "filled" && <span className="text-muted-foreground"> ({qty(o.filledQty)} filled)</span>}
                </td>
                <td className={cn(td, "num text-right")}>{o.filledAvgPrice ? price(o.filledAvgPrice) : "—"}</td>
                <td className={cn(td, "uppercase")}>{o.tif}</td>
                <td className={td}>
                  <Tag tone={statusTone(o.status)}>{o.status.replace("_", " ")}</Tag>
                </td>
                <td className={cn(td, "max-w-56 truncate text-muted-foreground")} title={o.why ?? undefined}>
                  {o.why ?? (leg ? "" : "—")}
                  {o.tags.map((t) => (
                    <Tag key={t} className="ml-1">
                      {t}
                    </Tag>
                  ))}
                </td>
                {status === "open" && (
                  <td className={cn(td, "text-right")}>
                    <span
                      title={
                        replaceable
                          ? "Modify"
                          : o.status === "accepted"
                            ? "Queued for the next open: Alpaca can't modify it until then (cancel and re-place instead)"
                            : "Can't modify this order"
                      }
                    >
                      <Button size="icon-xs" variant="ghost" disabled={!replaceable} onClick={() => setEditing(o)} aria-label="Modify order">
                        <Pencil />
                      </Button>
                    </span>
                    <Button size="icon-xs" variant="ghost" disabled={!cancelable} onClick={() => void cancel(o)} aria-label="Cancel order" title="Cancel">
                      <X />
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && <ModifyDialog order={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function DashboardView() {
  const [tab, setTab] = useState<"positions" | "open" | "history">("positions");
  const open = useOrders("open");
  const pos = usePositions();
  const tabs = [
    { id: "positions", label: `Positions${pos.data ? ` (${pos.data.length})` : ""}` },
    { id: "open", label: `Open orders${open.data ? ` (${open.data.length})` : ""}` },
    { id: "history", label: "Order history" },
  ] as const;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-end gap-1 border-b border-border px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "border-b-2 px-2 pb-1.5 text-xs",
              tab === t.id ? "border-series-1 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        {tab === "positions" && <PositionsTable />}
        {tab === "open" && <OrdersTable status="open" />}
        {tab === "history" && <OrdersTable status="closed" />}
      </div>
    </div>
  );
}
