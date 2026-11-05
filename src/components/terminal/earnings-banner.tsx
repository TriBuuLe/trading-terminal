"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, X } from "lucide-react";
import { alertKeys } from "@/hooks/alert-engine";
import { api } from "@/lib/api";

interface Ev {
  id: number;
  kind: string;
  message: string;
  seen: boolean;
}

/** Unseen earnings-soon events from the daily job, shown once on load until dismissed. */
export function EarningsBanner() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: alertKeys.events, queryFn: () => api<Ev[]>("/api/alerts/events"), refetchInterval: 60_000 });
  const unseen = (q.data ?? []).filter((e) => e.kind === "earnings" && !e.seen);
  if (!unseen.length) return null;
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
      <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex-1 space-y-0.5">
        {unseen.slice(0, 4).map((e) => (
          <p key={e.id}>{e.message}</p>
        ))}
        {unseen.length > 4 && <p>+{unseen.length - 4} more in Alerts</p>}
      </div>
      <button
        aria-label="Dismiss"
        className="rounded p-0.5 hover:bg-amber-500/20"
        onClick={() => void api("/api/alerts/events", { method: "PATCH", body: { ids: unseen.map((e) => e.id) } }).then(() => qc.invalidateQueries({ queryKey: alertKeys.events }))}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
