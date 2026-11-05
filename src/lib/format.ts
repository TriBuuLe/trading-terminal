/** Display formatting. Inputs may be Alpaca decimal strings or numbers. */
type N = number | string | null | undefined;

const toNum = (v: N): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function money(v: N, opts: { sign?: boolean; compact?: boolean; whole?: boolean } = {}): string {
  const n = toNum(v);
  if (n === null) return "—";
  if (opts.compact && Math.abs(n) >= 1e6) return `${n < 0 ? "-" : opts.sign && n > 0 ? "+" : ""}$${compact(Math.abs(n))}`;
  const s = (opts.whole ? usd0 : usd).format(Math.abs(n));
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}${s}`;
}

/** Price: 2 decimals at/above $1, 4 below. */
export function price(v: N): string {
  const n = toNum(v);
  if (n === null) return "—";
  return n >= 1 || n === 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toFixed(4);
}

export function pct(v: N, opts: { sign?: boolean; digits?: number } = {}): string {
  const n = toNum(v);
  if (n === null) return "—";
  const d = opts.digits ?? 2;
  const sign = n < 0 ? "−" : opts.sign !== false && n > 0 ? "+" : "";
  return `${sign}${Math.abs(n).toFixed(d)}%`;
}

export function qty(v: N): string {
  const n = toNum(v);
  if (n === null) return "—";
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function compact(v: N): string {
  const n = toNum(v);
  if (n === null) return "—";
  const a = Math.abs(n);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return n < 0 ? `−${s}` : s;
}

export function signClass(v: N): string {
  const n = toNum(v);
  if (n === null || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-up" : "text-down";
}

/** Arrow glyph so direction never relies on color alone. */
export function arrow(v: N): string {
  const n = toNum(v);
  if (n === null || n === 0) return "";
  return n > 0 ? "▲" : "▼";
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
