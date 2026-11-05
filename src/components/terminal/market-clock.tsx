"use client";

import { useEffect, useState } from "react";
import { useMarket } from "@/hooks/queries";
import { formatCountdown } from "@/lib/time";
import { cn } from "@/lib/utils";

const LABEL = { open: "Market open", pre: "Pre-market", after: "After-hours", closed: "Market closed" } as const;
const DOT = { open: "bg-up", pre: "bg-amber-400", after: "bg-amber-400", closed: "bg-muted-foreground" } as const;

export function MarketClock() {
  const { data, isError } = useMarket();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (isError) return <span className="text-xs text-down">Clock unavailable</span>;
  if (!data) return <span className="text-xs text-muted-foreground">…</span>;
  const ms = new Date(data.nextEventAt).getTime() - now;
  const verb = data.nextEvent === "close" ? "closes in" : "opens in";
  return (
    <div className="flex items-center gap-2 whitespace-nowrap" title={`Next ${data.nextEvent}: ${new Date(data.nextEventAt).toLocaleString()}`}>
      <span className={cn("size-2 rounded-full", DOT[data.session], data.session === "open" && "animate-pulse")} />
      <div className="flex flex-col leading-tight">
        <span className="text-xs font-medium">{LABEL[data.session]}</span>
        <span className="num text-[10px] text-muted-foreground">
          {verb} {formatCountdown(ms)}
        </span>
      </div>
    </div>
  );
}
