"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/hooks/queries";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePrices } from "@/stores/prices";

const STATUS = {
  live: { dot: "bg-up", label: "Live" },
  retrying: { dot: "bg-amber-400", label: "Retrying" },
  down: { dot: "bg-down", label: "Data down" },
  paused: { dot: "bg-muted-foreground", label: "Paused" },
  idle: { dot: "bg-muted-foreground", label: "Idle" },
} as const;

export function StatusBar() {
  const status = usePrices((s) => s.status);
  const lastSuccess = usePrices((s) => s.lastSuccess);
  const stale = usePrices((s) => s.stale);
  const storedAt = usePrices((s) => s.storedAt);
  const error = usePrices((s) => s.error);
  const market = usePrices((s) => s.market);
  const { data: cfg } = useConfig();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const st = STATUS[status];
  const pausedReason =
    status === "paused" ? (typeof document !== "undefined" && document.hidden ? "tab hidden" : market?.session === "closed" ? "market closed: showing last prices" : "") : "";

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-panel px-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5" title={error ?? undefined}>
        <span className={cn("size-1.5 rounded-full", st.dot)} />
        {st.label}
        {pausedReason && <span>({pausedReason})</span>}
      </span>
      <span className="num">updated {lastSuccess ? timeAgo(new Date(lastSuccess).toISOString()) : "—"}</span>
      {stale && storedAt && <span className="text-amber-300">STALE: showing data from {new Date(storedAt).toLocaleTimeString()}</span>}
      {error && status !== "live" && <span className="truncate text-down">{error}</span>}
      <span className="ml-auto">Data: {cfg?.dataFeed === "sip" ? "SIP consolidated" : "IEX real-time (free tier)"}</span>
      <span>Polling every {cfg ? cfg.quotePollMs / 1000 : 3}s in market hours</span>
      <span className="text-amber-300/80">Paper trading · no real money</span>
    </footer>
  );
}
