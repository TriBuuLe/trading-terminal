/**
 * DEMO_MODE broker + market data. Only used when DEMO_MODE=true (tests, demos),
 * and the UI shows a "DEMO DATA" banner. Prices are a deterministic simulation,
 * NOT real market data. State (cash, positions, orders, fills) lives in Postgres.
 */
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { demoState } from "@/db/schema";
import { addDaysIso, etParts } from "@/lib/time";
import type { Account, Bar, FillActivity, NewsArticle, Order, Position, Snapshot } from "./alpaca/schemas";
import type { AlpacaOrderPayload } from "./alpaca/trading";
import { UpstreamError } from "./http";

const ACCOUNT = "DEMO0001";
const START_CASH = "100000";

interface DemoBook {
  cash: string;
  positions: Record<string, { qty: string; avg: string }>;
  orders: Order[];
  fills: FillActivity[];
  createdAt: string;
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Deterministic simulated price for a symbol at a time. */
export function demoPrice(symbol: string, at = Date.now()): number {
  const h = hash(symbol);
  const base = 20 + (h % 480);
  const t = at / 1000;
  const wave = 0.03 * Math.sin(t / 900 + (h % 100)) + 0.01 * Math.sin(t / 97 + (h % 13));
  return Math.round(base * (1 + wave) * 100) / 100;
}

const prevClose = (symbol: string) => {
  const d = new Date();
  d.setUTCHours(20, 0, 0, 0);
  return demoPrice(symbol, d.getTime() - 86400_000);
};

async function load(): Promise<DemoBook> {
  const rows = await db().select().from(demoState).where(eq(demoState.key, "book")).limit(1);
  if (rows[0]) return rows[0].value as DemoBook;
  const book: DemoBook = { cash: START_CASH, positions: {}, orders: [], fills: [], createdAt: new Date().toISOString() };
  await save(book);
  return book;
}

async function save(book: DemoBook): Promise<void> {
  await db()
    .insert(demoState)
    .values({ key: "book", value: book, updatedAt: new Date() })
    .onConflictDoUpdate({ target: demoState.key, set: { value: book, updatedAt: new Date() } });
}

function equityOf(book: DemoBook): Decimal {
  return Object.entries(book.positions).reduce((e, [s, p]) => e.plus(new Decimal(p.qty).mul(demoPrice(s))), new Decimal(book.cash));
}

export async function account(): Promise<Account> {
  const book = await load();
  const eq = equityOf(book);
  const lmv = eq.minus(book.cash);
  return {
    id: "demo",
    account_number: ACCOUNT,
    status: "ACTIVE",
    currency: "USD",
    cash: new Decimal(book.cash).toFixed(2),
    equity: eq.toFixed(2),
    last_equity: START_CASH,
    buying_power: new Decimal(book.cash).toFixed(2),
    long_market_value: lmv.toFixed(2),
    daytrade_count: 0,
    pattern_day_trader: false,
    trading_blocked: false,
    shorting_enabled: false,
  };
}

export function clock() {
  // Demo market is always "open" so the UI polls and fills are immediate.
  const now = new Date();
  return {
    timestamp: now.toISOString(),
    is_open: true,
    next_open: new Date(now.getTime() + 86400_000).toISOString(),
    next_close: new Date(now.getTime() + 3 * 3600_000).toISOString(),
  };
}

export function calendar(start: string, end: string) {
  const out = [];
  for (let d = start; d <= end; d = addDaysIso(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ date: d, open: "09:30", close: "16:00", session_open: "0400", session_close: "2000" });
  }
  return out;
}

export async function positions(): Promise<Position[]> {
  const book = await load();
  return Object.entries(book.positions).map(([symbol, p]) => {
    const px = demoPrice(symbol);
    const qty = new Decimal(p.qty);
    const mv = qty.mul(px);
    const cost = qty.mul(p.avg);
    const pc = prevClose(symbol);
    return {
      asset_id: symbol,
      symbol,
      avg_entry_price: p.avg,
      qty: p.qty,
      side: "long" as const,
      market_value: mv.toFixed(2),
      cost_basis: cost.toFixed(2),
      unrealized_pl: mv.minus(cost).toFixed(2),
      unrealized_plpc: cost.isZero() ? "0" : mv.minus(cost).div(cost).toFixed(6),
      unrealized_intraday_pl: qty.mul(px - pc).toFixed(2),
      unrealized_intraday_plpc: ((px - pc) / pc).toFixed(6),
      current_price: px.toFixed(2),
      lastday_price: pc.toFixed(2),
      change_today: ((px - pc) / pc).toFixed(6),
    };
  });
}

function fill(book: DemoBook, o: Order, px: number): void {
  const qty = new Decimal(o.qty ?? new Decimal(o.notional ?? 0).div(px).toDecimalPlaces(6, Decimal.ROUND_DOWN));
  const cost = qty.mul(px);
  const pos = book.positions[o.symbol];
  if (o.side === "buy") {
    const q0 = new Decimal(pos?.qty ?? 0);
    const newQty = q0.plus(qty);
    const avg = q0.mul(pos?.avg ?? 0).plus(cost).div(newQty);
    book.positions[o.symbol] = { qty: newQty.toString(), avg: avg.toFixed(4) };
    book.cash = new Decimal(book.cash).minus(cost).toFixed(2);
  } else {
    const left = new Decimal(pos?.qty ?? 0).minus(qty);
    if (left.lte(0)) delete book.positions[o.symbol];
    else book.positions[o.symbol] = { qty: left.toString(), avg: pos!.avg };
    book.cash = new Decimal(book.cash).plus(cost).toFixed(2);
  }
  const now = new Date().toISOString();
  Object.assign(o, { status: "filled", filled_qty: qty.toString(), filled_avg_price: px.toFixed(2), filled_at: now, updated_at: now, qty: qty.toString() });
  book.fills.push({
    id: `${Date.now()}::${randomUUID()}`,
    activity_type: "FILL",
    transaction_time: now,
    type: "fill",
    price: px.toFixed(2),
    qty: qty.toString(),
    side: o.side,
    symbol: o.symbol,
    leaves_qty: "0",
    order_id: o.id,
    cum_qty: qty.toString(),
    order_status: "filled",
  });
}

const marketable = (o: Order, px: number) =>
  o.type === "market" || (o.type === "limit" && o.limit_price && (o.side === "buy" ? px <= Number(o.limit_price) : px >= Number(o.limit_price)));

/** Re-check resting limit orders against the current simulated price. */
async function matchOpen(book: DemoBook): Promise<boolean> {
  let changed = false;
  for (const o of book.orders) {
    if (o.status !== "new") continue;
    const px = demoPrice(o.symbol);
    if (marketable(o, px)) {
      fill(book, o, px);
      changed = true;
    }
  }
  return changed;
}

export async function placeOrder(p: AlpacaOrderPayload): Promise<Order> {
  const book = await load();
  const px = demoPrice(p.symbol);
  const now = new Date().toISOString();
  const o: Order = {
    id: randomUUID(),
    client_order_id: p.client_order_id,
    created_at: now,
    updated_at: now,
    submitted_at: now,
    symbol: p.symbol,
    asset_class: "us_equity",
    qty: p.qty ?? null,
    notional: p.notional ?? null,
    filled_qty: "0",
    filled_avg_price: null,
    order_class: p.order_class ?? "",
    type: p.type,
    side: p.side,
    time_in_force: p.time_in_force,
    limit_price: p.limit_price ?? null,
    stop_price: p.stop_price ?? null,
    status: "new",
    extended_hours: p.extended_hours ?? false,
    legs: null,
  };
  if (p.side === "sell") {
    const held = new Decimal(book.positions[p.symbol]?.qty ?? 0);
    if (held.lt(p.qty ?? 0)) throw new UpstreamError("demo", 403, "insufficient qty available for order (demo mode does not support short selling)");
  } else {
    const cost = new Decimal(p.notional ?? new Decimal(p.qty ?? 0).mul(p.limit_price ?? px));
    if (cost.gt(book.cash)) throw new UpstreamError("demo", 403, "insufficient buying power");
  }
  if (marketable(o, px)) fill(book, o, px);
  book.orders.unshift(o);
  await save(book);
  return o;
}

export async function listOrders(status: "open" | "closed" | "all"): Promise<Order[]> {
  const book = await load();
  if (await matchOpen(book)) await save(book);
  return book.orders.filter((o) => status === "all" || (status === "open" ? o.status === "new" : o.status !== "new"));
}

export async function cancelOrder(id: string): Promise<void> {
  const book = await load();
  const o = book.orders.find((x) => x.id === id && x.status === "new");
  if (o) Object.assign(o, { status: "canceled", canceled_at: new Date().toISOString() });
  await save(book);
}

export async function fills(): Promise<FillActivity[]> {
  return (await load()).fills;
}

export function snapshot(symbol: string): Snapshot {
  const now = Date.now();
  const px = demoPrice(symbol, now);
  const pc = prevClose(symbol);
  const today = new Date();
  today.setUTCHours(13, 30, 0, 0);
  const open = demoPrice(symbol, today.getTime());
  return {
    latestTrade: { t: new Date(now).toISOString(), p: px, s: 100 },
    latestQuote: { t: new Date(now).toISOString(), bp: Math.round((px - 0.01) * 100) / 100, bs: 1, ap: Math.round((px + 0.01) * 100) / 100, as: 1 },
    dailyBar: { t: today.toISOString(), o: open, h: Math.max(open, px) * 1.004, l: Math.min(open, px) * 0.996, c: px, v: 1_000_000 + (hash(symbol) % 900_000) },
    prevDailyBar: { t: new Date(today.getTime() - 86400_000).toISOString(), o: pc, h: pc * 1.01, l: pc * 0.99, c: pc, v: 1_200_000 },
  };
}

export function bars(symbol: string, timeframe: string, start: string): Bar[] {
  const out: Bar[] = [];
  const end = Date.now();
  if (timeframe === "1Day") {
    // One bar per weekday (ET), like real daily bars.
    for (let d = start.slice(0, 10); d <= today(); d = addDaysIso(d, 1)) {
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const t = new Date(`${d}T14:30:00Z`).getTime();
      const o = demoPrice(symbol, t);
      const c = demoPrice(symbol, t + 6.5 * 3600_000);
      out.push({ t: new Date(`${d}T05:00:00Z`).toISOString(), o, h: Math.max(o, c) * 1.006, l: Math.min(o, c) * 0.994, c, v: 1_000_000 + (hash(symbol + d) % 900_000) });
    }
    return out.slice(-1500);
  }
  const step = { "1Min": 60, "5Min": 300, "15Min": 900, "1Hour": 3600 }[timeframe] ?? 300;
  for (let t = Math.max(new Date(start).getTime(), end - 600 * step * 1000); t <= end; t += step * 1000) {
    const o = demoPrice(symbol, t);
    const c = demoPrice(symbol, t + step * 1000 * 0.9);
    out.push({ t: new Date(t).toISOString(), o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 10_000 + (hash(symbol + t) % 50_000) });
  }
  return out;
}

export function news(symbols: string[]): NewsArticle[] {
  return symbols.slice(0, 5).map((s, i) => ({
    id: i + 1,
    headline: `DEMO headline for ${s} (simulated, not real news)`,
    created_at: new Date(Date.now() - i * 3600_000).toISOString(),
    summary: "Demo mode placeholder.",
    symbols: [s],
    source: "demo",
    url: null,
  }));
}

const UNIVERSE = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "INTC", "SPY", "QQQ"];
export function movers() {
  const rows = UNIVERSE.map((s) => {
    const p = demoPrice(s);
    const pc = prevClose(s);
    return { symbol: s, price: p, change: p - pc, percent_change: ((p - pc) / pc) * 100 };
  }).sort((a, b) => b.percent_change - a.percent_change);
  return { gainers: rows.slice(0, 6), losers: rows.slice(-6).reverse(), market_type: "stocks", last_updated: new Date().toISOString() };
}
export function mostActives() {
  return { most_actives: UNIVERSE.map((s) => ({ symbol: s, volume: 1_000_000 + (hash(s) % 9_000_000), trade_count: 1000 })), last_updated: new Date().toISOString() };
}

export function asset(symbol: string) {
  return { id: symbol, class: "us_equity", exchange: "NASDAQ", symbol, name: `${symbol} (demo)`, status: "active", tradable: true, fractionable: true, shortable: false, easy_to_borrow: false };
}

export async function portfolioHistory() {
  const book = await load();
  const start = Math.floor(new Date(book.createdAt).getTime() / 1000);
  const eq = equityOf(book).toNumber();
  return { timestamp: [start, Math.floor(Date.now() / 1000)], equity: [Number(START_CASH), eq], profit_loss: [0, eq - Number(START_CASH)], profit_loss_pct: [0, 0], base_value: Number(START_CASH), timeframe: "1D" };
}

export const today = () => etParts(new Date()).date;
