"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { checkAlert, type AlertDef } from "@/lib/alerts";
import { api } from "@/lib/api";
import { usePrices } from "@/stores/prices";
import { useWantQuotes } from "./price-feed";

export const alertKeys = { list: ["alerts"] as const, events: ["alert-events"] as const };

export function useAlerts() {
  return useQuery({ queryKey: alertKeys.list, queryFn: () => api<AlertDef[]>("/api/alerts"), refetchInterval: 60_000 });
}

function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: title });
  } catch {
    // some browsers require a service worker for notifications; the toast still shows
  }
}

/**
 * Evaluates price alerts against the polled quotes while the dashboard is open.
 * (Alerts while the app is closed would need an always-on server; see README.)
 */
export function useAlertEngine() {
  const qc = useQueryClient();
  const alerts = useAlerts();
  const active = (alerts.data ?? []).filter((a) => a.active && a.kind !== "earnings");
  useWantQuotes(active.map((a) => a.symbol));
  const firing = useRef(new Set<number>());

  useEffect(() => {
    const check = (quotes: ReturnType<typeof usePrices.getState>["quotes"]) => {
      for (const a of active) {
        const msg = checkAlert(a, quotes[a.symbol]);
        if (!msg || firing.current.has(a.id)) continue;
        firing.current.add(a.id);
        // Server decides atomically whether this alert fires (dedupes across tabs).
        void api<{ fired: boolean }>(`/api/alerts/${a.id}/fire`, { method: "POST", body: { price: quotes[a.symbol]?.price ?? null, message: msg } })
          .then((r) => {
            if (r.fired) {
              toast.warning(msg, { duration: 15_000 });
              notify(`Alert: ${a.symbol}`, msg);
            }
            return Promise.all([qc.invalidateQueries({ queryKey: alertKeys.list }), qc.invalidateQueries({ queryKey: alertKeys.events })]);
          })
          .catch(() => {})
          .finally(() => setTimeout(() => firing.current.delete(a.id), 30_000));
      }
    };
    check(usePrices.getState().quotes);
    return usePrices.subscribe((s, prev) => {
      if (s.quotes !== prev.quotes) check(s.quotes);
    });
  }, [active, qc]);
}
