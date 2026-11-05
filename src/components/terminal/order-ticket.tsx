"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount, usePositions, useRefreshTrading } from "@/hooks/queries";
import { usePriceFeed, useWantQuotes } from "@/hooks/price-feed";
import { api, ApiError } from "@/lib/api";
import { money, pct, price, qty as fmtQty } from "@/lib/format";
import { ORDER_TAGS, orderRequestSchema, previewOrder, validateOrder, type AssetInfo, type OrderRequest } from "@/lib/orders";
import type { OrderRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePrices } from "@/stores/prices";
import { useUi } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel, Tag, LivePrice, Change } from "./bits";

type OrderType = OrderRequest["type"];

interface Form {
  side: "buy" | "sell";
  type: OrderType;
  sizeBy: "shares" | "dollars";
  qty: string;
  notional: string;
  limitPrice: string;
  stopPrice: string;
  tif: "day" | "gtc";
  extendedHours: boolean;
  bracket: boolean;
  takeProfit: string;
  stopLoss: string;
  stopLossLimit: string;
  why: string;
  tags: string[];
}

const EMPTY: Form = {
  side: "buy",
  type: "market",
  sizeBy: "shares",
  qty: "",
  notional: "",
  limitPrice: "",
  stopPrice: "",
  tif: "day",
  extendedHours: false,
  bracket: false,
  takeProfit: "",
  stopLoss: "",
  stopLossLimit: "",
  why: "",
  tags: [],
};

function toRequest(symbol: string, f: Form): OrderRequest {
  return {
    symbol,
    side: f.side,
    type: f.type,
    sizeBy: f.sizeBy,
    qty: f.sizeBy === "shares" && f.qty ? f.qty.trim() : undefined,
    notional: f.sizeBy === "dollars" && f.notional ? f.notional.trim() : undefined,
    limitPrice: (f.type === "limit" || f.type === "stop_limit") && f.limitPrice ? f.limitPrice.trim() : undefined,
    stopPrice: (f.type === "stop" || f.type === "stop_limit") && f.stopPrice ? f.stopPrice.trim() : undefined,
    tif: f.tif,
    extendedHours: f.extendedHours,
    bracket: f.bracket
      ? { takeProfit: f.takeProfit.trim(), stopLoss: f.stopLoss.trim(), stopLossLimit: f.stopLossLimit.trim() || undefined }
      : undefined,
    why: f.why.trim(),
    tags: f.tags,
    source: "ticket",
  };
}

const fieldBase = "h-7 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring";
const field = `${fieldBase} num`;

function Seg<T extends string>({ value, options, onChange, className }: { value: T; options: { v: T; label: string; cls?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("grid rounded-md border border-border bg-background p-0.5", className)} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn("rounded px-2 py-1 text-xs font-medium text-muted-foreground", value === o.v && (o.cls ?? "bg-secondary text-foreground"))}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{children}</label>;
}

export function OrderTicket() {
  const symbol = useUi((s) => s.symbol);
  const prefill = useUi((s) => s.ticket);
  const q = usePrices((s) => s.quotes[symbol]);
  const market = usePrices((s) => s.market);
  const account = useAccount();
  const positions = usePositions();
  const refresh = useRefreshTrading();
  const feed = usePriceFeed();
  useWantQuotes([symbol]);

  const [f, setF] = useState<Form>(EMPTY);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<{ msg: string; problems: string[] } | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // Reset when the symbol changes; apply prefills from palette / position "Close…" / shortcuts.
  // (State adjusted during render, React's recommended alternative to an effect.)
  const [seen, setSeen] = useState<{ symbol: string; nonce: number | null }>({ symbol, nonce: null });
  if (prefill && prefill.nonce !== seen.nonce) {
    setSeen({ symbol, nonce: prefill.nonce });
    setServerError(null);
    setF({
      ...EMPTY,
      side: prefill.side ?? "buy",
      type: prefill.type ?? "market",
      sizeBy: prefill.sizeBy ?? "shares",
      qty: prefill.qty ?? "",
      notional: prefill.notional ?? "",
      limitPrice: prefill.limitPrice ?? "",
      stopPrice: prefill.stopPrice ?? "",
      tif: prefill.tif ?? "day",
      why: prefill.why ?? "",
      tags: prefill.tags ?? [],
    });
  } else if (symbol !== seen.symbol) {
    setSeen({ symbol, nonce: seen.nonce });
    setServerError(null);
    setF((x) => ({ ...EMPTY, side: x.side }));
  }
  useEffect(() => {
    if (prefill) qtyRef.current?.focus();
  }, [prefill]);

  const asset = useQuery({
    queryKey: ["asset", symbol],
    queryFn: () => api<AssetInfo & { name: string; exchange: string }>(`/api/assets/${symbol}`),
    staleTime: 60 * 60_000,
    retry: false,
  });

  const position = positions.data?.find((p) => p.symbol === symbol) ?? null;
  const req = useMemo(() => toRequest(symbol, f), [symbol, f]);
  const parsed = orderRequestSchema.safeParse(req);
  const problems = useMemo(() => {
    if (!parsed.success) return parsed.error.issues.map((i) => i.message);
    return validateOrder(parsed.data, asset.data ?? null, { positionQty: position?.qty ?? null });
  }, [parsed, asset.data, position]);
  const sizeEntered = f.sizeBy === "shares" ? f.qty : f.notional;

  const refPrice = f.side === "buy" ? (q?.ask ?? q?.price ?? null) : (q?.bid ?? q?.price ?? null);
  const pv = previewOrder({
    order: req,
    refPrice,
    equity: account.data?.equity ?? null,
    buyingPower: account.data?.buyingPower ?? null,
  });

  // Warnings that don't block, but that a real trader would want to see.
  const warnings: string[] = [];
  const spreadPct = q?.bid && q?.ask ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100 : null;
  if (f.type === "market" && spreadPct !== null && spreadPct > 0.5)
    warnings.push(`Wide bid/ask spread (${spreadPct.toFixed(2)}%). A real market order could fill far from the last price; consider a limit.`);
  if (f.type === "market" && q && (q.bid === null || q.ask === null)) warnings.push("No live bid/ask on the IEX feed right now; the estimate uses the last trade.");
  if (market && market.session !== "open" && !f.extendedHours)
    warnings.push(
      market.session === "closed" || f.type === "market"
        ? "Market is closed: this order will queue and execute at the next open (gaps can fill far from today's price)."
        : "Outside regular hours: without extended hours, this order waits for the open.",
    );
  if (pv.pctOfEquity && pv.pctOfEquity.gt(25)) warnings.push(`This is ${pv.pctOfEquity.toFixed(1)}% of your equity in one order: concentrated.`);
  if (account.data && Number(account.data.equity) < 25_000 && account.data.daytradeCount >= 3)
    warnings.push(`You've made ${account.data.daytradeCount} day trades in 5 days with under $25k equity: another same-day round trip will be blocked (PDT rule).`);
  if (f.side === "sell" && (!position || Number(position.qty) <= 0)) warnings.push("You don't hold this stock: this is a SHORT sale.");
  if (pv.buyingPowerAfter && pv.buyingPowerAfter.lt(0)) warnings.push("Estimated cost exceeds buying power; Alpaca will likely reject it.");

  const canReview = Boolean(sizeEntered) && problems.length === 0 && parsed.success;

  const submit = async () => {
    if (!parsed.success) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const r = await api<{ order: OrderRow }>("/api/orders", { method: "POST", body: parsed.data });
      toast.success(`Paper order sent: ${r.order.side} ${r.order.notional ? money(r.order.notional) : fmtQty(r.order.qty)} ${r.order.symbol} (${r.order.status})`);
      setConfirming(false);
      setF((x) => ({ ...EMPTY, side: x.side }));
      await refresh();
      feed?.refresh();
    } catch (e) {
      const err = e instanceof ApiError ? { msg: e.message, problems: e.problems } : { msg: String(e), problems: [] };
      setServerError(err);
      setConfirming(false);
      toast.error(err.msg);
    } finally {
      setSubmitting(false);
    }
  };

  const isLimit = f.type === "limit" || f.type === "stop_limit";
  const isStop = f.type === "stop" || f.type === "stop_limit";

  return (
    <Panel
      title="Order ticket"
      right={asset.data && <span className="truncate text-[10px] text-muted-foreground">{asset.data.exchange}{asset.data.fractionable ? " · fractional" : ""}</span>}
      className="h-full"
      bodyClassName="p-3"
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-lg font-semibold">{symbol}</div>
          <div className="truncate text-[11px] text-muted-foreground">{asset.isError ? <span className="text-down">{(asset.error as Error).message}</span> : (asset.data?.name ?? "…")}</div>
        </div>
        <div className="text-right">
          <LivePrice symbol={symbol} className="text-lg" />
          <div className="text-[11px]">
            <Change value={q?.change ?? null} percent={q?.changePct ?? null} kind="price" />
          </div>
        </div>
      </div>
      <div className="num mb-3 grid grid-cols-2 gap-2 rounded-md bg-background px-2 py-1 text-[11px]">
        <span>
          <span className="text-muted-foreground">Bid </span>
          {price(q?.bid)}
        </span>
        <span className="text-right">
          <span className="text-muted-foreground">Ask </span>
          {price(q?.ask)}
        </span>
      </div>

      <div className="space-y-3">
        <Seg
          value={f.side}
          onChange={(v) => set("side", v)}
          options={[
            { v: "buy", label: "Buy", cls: "bg-up text-white" },
            { v: "sell", label: "Sell", cls: "bg-down text-white" },
          ]}
        />

        <div>
          <L>Order type</L>
          <Seg
            value={f.type}
            onChange={(v) => setF((x) => ({ ...x, type: v, sizeBy: v !== "market" ? "shares" : x.sizeBy, extendedHours: v === "limit" ? x.extendedHours : false }))}
            options={[
              { v: "market", label: "Market" },
              { v: "limit", label: "Limit" },
              { v: "stop", label: "Stop" },
              { v: "stop_limit", label: "Stop-lmt" },
            ]}
          />
        </div>

        <div>
          <div className="flex items-end justify-between">
            <L>{f.sizeBy === "shares" ? "Shares" : "Dollar amount"}</L>
            <button
              type="button"
              disabled={f.type !== "market"}
              title={f.type !== "market" ? "Dollar-amount orders must be market orders (Alpaca rule)" : "Switch between shares and dollars"}
              onClick={() => set("sizeBy", f.sizeBy === "shares" ? "dollars" : "shares")}
              className="mb-1 text-[10px] text-series-1 hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              {f.sizeBy === "shares" ? "by $ amount" : "by shares"}
            </button>
          </div>
          <input
            ref={qtyRef}
            inputMode="decimal"
            aria-label={f.sizeBy === "shares" ? "Shares" : "Dollar amount"}
            className={field}
            placeholder={f.sizeBy === "shares" ? (asset.data?.fractionable ? "e.g. 10 or 0.5" : "e.g. 10") : "e.g. 500"}
            value={f.sizeBy === "shares" ? f.qty : f.notional}
            onChange={(e) => set(f.sizeBy === "shares" ? "qty" : "notional", e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>

        {(isLimit || isStop) && (
          <div className="grid grid-cols-2 gap-2">
            {isStop && (
              <div className={cn(!isLimit && "col-span-2")}>
                <L>Stop price</L>
                <input inputMode="decimal" aria-label="Stop price" className={field} value={f.stopPrice} onChange={(e) => set("stopPrice", e.target.value.replace(/[^0-9.]/g, ""))} placeholder={price(q?.price)} />
              </div>
            )}
            {isLimit && (
              <div className={cn(!isStop && "col-span-2")}>
                <L>Limit price</L>
                <input inputMode="decimal" aria-label="Limit price" className={field} value={f.limitPrice} onChange={(e) => set("limitPrice", e.target.value.replace(/[^0-9.]/g, ""))} placeholder={price(q?.price)} />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <L>Time in force</L>
            <Seg value={f.tif} onChange={(v) => set("tif", v)} options={[{ v: "day", label: "Day" }, { v: "gtc", label: "GTC" }]} />
          </div>
          <div className="flex flex-col justify-end gap-1 pb-0.5 text-xs">
            <label className={cn("flex items-center gap-1.5", f.type !== "limit" && "opacity-40")} title="Extended hours: limit orders only">
              <input type="checkbox" disabled={f.type !== "limit" || f.bracket} checked={f.extendedHours} onChange={(e) => set("extendedHours", e.target.checked)} />
              Extended hours
            </label>
            <label className={cn("flex items-center gap-1.5", f.type !== "market" && f.type !== "limit" && "opacity-40")}>
              <input type="checkbox" disabled={f.type !== "market" && f.type !== "limit"} checked={f.bracket} onChange={(e) => setF((x) => ({ ...x, bracket: e.target.checked, extendedHours: false, sizeBy: "shares" }))} />
              Bracket (TP + SL)
            </label>
          </div>
        </div>

        {f.bracket && (
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-2">
            <div>
              <L>Take-profit</L>
              <input inputMode="decimal" aria-label="Take-profit price" className={field} value={f.takeProfit} onChange={(e) => set("takeProfit", e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div>
              <L>Stop-loss</L>
              <input inputMode="decimal" aria-label="Stop-loss price" className={field} value={f.stopLoss} onChange={(e) => set("stopLoss", e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            <div className="col-span-2">
              <L>Stop-loss limit (optional)</L>
              <input inputMode="decimal" aria-label="Stop-loss limit price" className={field} value={f.stopLossLimit} onChange={(e) => set("stopLossLimit", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="blank = stop (market) exit" />
            </div>
          </div>
        )}

        <div>
          <L>Why are you making this trade? (required)</L>
          <input
            aria-label="Why"
            className={fieldBase}
            maxLength={300}
            value={f.why}
            onChange={(e) => set("why", e.target.value)}
            placeholder="e.g. Broke out above 200-day on 2× volume"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {ORDER_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("tags", f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t])}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px]",
                  f.tags.includes(t) ? "border-series-1 bg-series-1/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <dl className="num grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-background p-2 text-[11px]">
          <dt className="text-muted-foreground">Est. price</dt>
          <dd className="text-right">{pv.estPrice ? price(pv.estPrice.toNumber()) : "—"}</dd>
          <dt className="text-muted-foreground">{f.sizeBy === "dollars" ? "Est. shares" : "Est. cost"}</dt>
          <dd className="text-right">{f.sizeBy === "dollars" ? (pv.estShares ? fmtQty(pv.estShares.toString()) : "—") : pv.estCost ? money(pv.estCost.toFixed(2)) : "—"}</dd>
          <dt className="text-muted-foreground">% of equity</dt>
          <dd className="text-right">{pv.pctOfEquity ? pct(pv.pctOfEquity.toNumber(), { sign: false }) : "—"}</dd>
          <dt className="text-muted-foreground">Buying power after</dt>
          <dd className={cn("text-right", pv.buyingPowerAfter?.lt(0) && "text-down")}>{pv.buyingPowerAfter ? money(pv.buyingPowerAfter.toFixed(2)) : "—"}</dd>
          {f.bracket && (
            <>
              <dt className="text-muted-foreground">Risk to stop</dt>
              <dd className="text-right text-down">
                {pv.riskToStop ? `${money(pv.riskToStop.toFixed(2))} (${pct(pv.riskPctOfEquity?.toNumber() ?? null, { sign: false })} eq)` : "—"}
              </dd>
              <dt className="text-muted-foreground">Reward to target</dt>
              <dd className="text-right text-up">
                {pv.rewardToTarget ? `${money(pv.rewardToTarget.toFixed(2))}${pv.riskToStop?.gt(0) ? ` · ${pv.rewardToTarget.div(pv.riskToStop).toFixed(1)}R` : ""}` : "—"}
              </dd>
            </>
          )}
          {position && (
            <>
              <dt className="text-muted-foreground">Current position</dt>
              <dd className="text-right">
                {fmtQty(position.qty)} @ {price(position.avgEntry)}
              </dd>
            </>
          )}
        </dl>

        {sizeEntered && problems.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-down">
            {problems.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="space-y-1 text-[11px] text-amber-300">
            {warnings.map((w) => (
              <li key={w} className="flex gap-1">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        )}
        {serverError && (
          <div role="alert" className="rounded-md border border-down/40 bg-down-muted p-2 text-[11px] text-down">
            <p className="font-medium">{serverError.msg}</p>
            {serverError.problems.length > 1 && <p className="mt-1 opacity-80">{serverError.problems.slice(1).join(" · ")}</p>}
          </div>
        )}

        <Button
          className={cn("w-full", f.side === "buy" ? "bg-up text-white hover:bg-up/90" : "bg-down text-white hover:bg-down/90")}
          disabled={!canReview}
          onClick={() => setConfirming(true)}
          title={!sizeEntered ? "Enter a size" : problems[0]}
        >
          Review {f.side} order
        </Button>
        <p className="text-center text-[10px] text-muted-foreground">Paper order to Alpaca (simulated fills, no real money).</p>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Confirm paper order: <span className={f.side === "buy" ? "text-up" : "text-down"}>{f.side.toUpperCase()}</span> {symbol}
            </DialogTitle>
            <DialogDescription>Sent to your Alpaca paper account. The quote right now is saved so slippage can be measured against the fill.</DialogDescription>
          </DialogHeader>
          <dl className="num grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Size</dt>
            <dd>{f.sizeBy === "dollars" ? money(f.notional) : `${fmtQty(f.qty)} shares`}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd>
              {f.type.replace("_", "-")}
              {isStop && ` · stop ${price(f.stopPrice)}`}
              {isLimit && ` · limit ${price(f.limitPrice)}`}
            </dd>
            {f.bracket && (
              <>
                <dt className="text-muted-foreground">Bracket</dt>
                <dd>
                  TP {price(f.takeProfit)} · SL {price(f.stopLoss)}
                  {f.stopLossLimit && ` (lmt ${price(f.stopLossLimit)})`}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Time in force</dt>
            <dd className="uppercase">
              {f.tif}
              {f.extendedHours && " · ext hours"}
            </dd>
            <dt className="text-muted-foreground">Est. cost</dt>
            <dd>
              {pv.estCost ? money(pv.estCost.toFixed(2)) : "—"} {pv.pctOfEquity && <span className="text-muted-foreground">({pct(pv.pctOfEquity.toNumber(), { sign: false })} of equity)</span>}
            </dd>
            <dt className="text-muted-foreground">Why</dt>
            <dd className="font-sans">
              {f.why}
              {f.tags.map((t) => (
                <Tag key={t} className="ml-1">
                  {t}
                </Tag>
              ))}
            </dd>
          </dl>
          {warnings.length > 0 && (
            <ul className="space-y-1 text-[11px] text-amber-300">
              {warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button
              autoFocus
              disabled={submitting}
              onClick={() => void submit()}
              className={cn(f.side === "buy" ? "bg-up text-white hover:bg-up/90" : "bg-down text-white hover:bg-down/90")}
            >
              {submitting ? "Sending…" : `Submit ${f.side} order`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
