"use client";

import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { arrow, pct, price, signClass, money } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrices } from "@/stores/prices";

export function Panel({
  title,
  right,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col bg-panel", className)}>
      {(title || right) && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <h2 className="truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
          <div className="flex items-center gap-1">{right}</div>
        </header>
      )}
      <div className={cn("scrollbar-thin min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </section>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-1.5 p-6 text-center">
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 p-4 text-center", compact ? "" : "min-h-28")}>
      <div className="flex items-center gap-1.5 text-down">
        <AlertTriangle className="size-4" />
        <span className="text-sm font-medium">Couldn&apos;t load</span>
      </div>
      <p className="max-w-md text-xs break-words text-muted-foreground">{msg}</p>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1 text-xs text-series-1 hover:underline">
          <RotateCw className="size-3" /> Retry
        </button>
      )}
    </div>
  );
}

/** Signed change with arrow, so direction never depends on color alone. */
export function Change({ value, percent, className, kind = "money" }: { value?: number | string | null; percent?: number | string | null; className?: string; kind?: "money" | "price" }) {
  const ref = value ?? percent;
  return (
    <span className={cn("num whitespace-nowrap", signClass(ref), className)}>
      <span className="mr-0.5 text-[0.7em]">{arrow(ref)}</span>
      {value !== undefined && (kind === "money" ? money(value, { sign: true }) : signedPrice(value))}
      {value !== undefined && percent !== undefined && " "}
      {percent !== undefined && (value !== undefined ? `(${pct(percent)})` : pct(percent))}
    </span>
  );
}

function signedPrice(v: number | string | null): string {
  if (v === null) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${price(Math.abs(n))}`;
}

/** Live last price that flashes green/red when it changes (re-keyed so the CSS animation restarts). */
export function LivePrice({ symbol, className }: { symbol: string; className?: string }) {
  const q = usePrices((s) => s.quotes[symbol]);
  const tick = usePrices((s) => s.ticks[symbol]);
  return (
    <span key={tick?.at ?? 0} className={cn("num rounded-sm px-0.5", tick && (tick.dir === "up" ? "flash-up" : "flash-down"), className)}>
      {price(q?.price)}
    </span>
  );
}

export function SessionTag({ symbol }: { symbol: string }) {
  const q = usePrices((s) => s.quotes[symbol]);
  const market = usePrices((s) => s.market);
  if (!q?.tradeSession || !market) return null;
  // When the market is fully closed the top bar says so; rows only flag extended-hours prints.
  if (market.session === "closed") return null;
  if (q.tradeSession === "pre") return <Tag tone="warn">pre</Tag>;
  if (q.tradeSession === "after") return <Tag tone="warn">after</Tag>;
  return null;
}

export function Tag({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "warn" | "up" | "down" | "info"; className?: string }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    warn: "bg-amber-500/15 text-amber-300",
    up: "bg-up-muted text-up",
    down: "bg-down-muted text-down",
    info: "bg-series-1/15 text-series-1",
  } as const;
  return <span className={cn("inline-flex items-center rounded px-1 py-px text-[10px] leading-tight font-medium uppercase", tones[tone], className)}>{children}</span>;
}

export function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col leading-tight", className)}>
      <span className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</span>
      <span className="num truncate text-[13px]">{children}</span>
    </div>
  );
}

export function Sparkline({ values, width = 72, height = 20, reference }: { values: number[]; width?: number; height?: number; reference?: number | null }) {
  if (values.length < 2) return <span className="inline-block text-[10px] text-muted-foreground">—</span>;
  const all = reference != null ? [...values, reference] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const base = reference ?? values[0]!;
  const up = values[values.length - 1]! >= base;
  return (
    <svg width={width} height={height} className="block" aria-hidden="true">
      {reference != null && <line x1={0} x2={width} y1={y(reference)} y2={y(reference)} stroke="currentColor" className="text-border" strokeDasharray="2 2" strokeWidth={1} />}
      <path d={d} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" stroke={up ? "var(--up)" : "var(--down)"} />
    </svg>
  );
}
