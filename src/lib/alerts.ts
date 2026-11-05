import type { Quote } from "./types";
import { pct, price } from "./format";

export interface AlertDef {
  id: number;
  symbol: string;
  kind: "above" | "below" | "pct_move" | "earnings";
  threshold: number | null;
  note: string | null;
  active: boolean;
  repeat: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

/** Price alerts are evaluated in the browser against polled quotes. Returns a message when it triggers. */
export function checkAlert(a: AlertDef, q: Quote | undefined): string | null {
  if (!a.active || a.threshold === null || !q || q.price === null) return null;
  switch (a.kind) {
    case "above":
      return q.price >= a.threshold ? `${a.symbol} is at ${price(q.price)}, above your ${price(a.threshold)} alert` : null;
    case "below":
      return q.price <= a.threshold ? `${a.symbol} is at ${price(q.price)}, below your ${price(a.threshold)} alert` : null;
    case "pct_move":
      return q.changePct !== null && Math.abs(q.changePct) >= a.threshold
        ? `${a.symbol} moved ${pct(q.changePct)} today (alert at ±${a.threshold}%)`
        : null;
    default:
      return null; // earnings: checked by the daily cron
  }
}
