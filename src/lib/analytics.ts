import Decimal from "decimal.js";

/**
 * Portfolio math. Pure functions; money in Decimal (no float drift in totals).
 * Ratios (Sharpe, drawdown, win rate) are plain numbers.
 */

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: string; // buy | sell | sell_short
  qty: string;
  price: string;
  time: string; // ISO
}

export interface Lot {
  symbol: string;
  qty: Decimal; // > 0 long, < 0 short
  price: Decimal;
  orderId: string;
  time: string;
}

/** One FIFO match: part of an opening lot closed by a later fill. */
export interface Match {
  symbol: string;
  direction: "long" | "short";
  qty: Decimal;
  openPrice: Decimal;
  closePrice: Decimal;
  openOrderId: string;
  closeOrderId: string;
  openTime: string;
  closeTime: string;
  pnl: Decimal;
}

export interface FifoResult {
  matches: Match[];
  openLots: Lot[];
  realizedBySymbol: Record<string, Decimal>;
  realizedTotal: Decimal;
}

const isBuy = (side: string) => side.toLowerCase() === "buy";

/** FIFO realized P&L over fills (handles partial closes, flips, and shorts). */
export function fifo(fills: Fill[], adjustPrice?: (f: Fill) => Decimal): FifoResult {
  const sorted = [...fills].sort((a, b) => (a.time === b.time ? a.id.localeCompare(b.id) : a.time.localeCompare(b.time)));
  const lots: Record<string, Lot[]> = {};
  const matches: Match[] = [];
  for (const f of sorted) {
    const px = adjustPrice ? adjustPrice(f) : new Decimal(f.price);
    let remaining = new Decimal(f.qty).mul(isBuy(f.side) ? 1 : -1);
    const book = (lots[f.symbol] ??= []);
    while (!remaining.isZero() && book.length > 0 && book[0]!.qty.isNegative() !== remaining.isNegative()) {
      const lot = book[0]!;
      const m = Decimal.min(lot.qty.abs(), remaining.abs());
      const long = lot.qty.isPositive();
      const pnl = long ? px.minus(lot.price).mul(m) : lot.price.minus(px).mul(m);
      matches.push({
        symbol: f.symbol,
        direction: long ? "long" : "short",
        qty: m,
        openPrice: lot.price,
        closePrice: px,
        openOrderId: lot.orderId,
        closeOrderId: f.orderId,
        openTime: lot.time,
        closeTime: f.time,
        pnl,
      });
      lot.qty = long ? lot.qty.minus(m) : lot.qty.plus(m);
      remaining = remaining.isPositive() ? remaining.minus(m) : remaining.plus(m);
      if (lot.qty.isZero()) book.shift();
    }
    if (!remaining.isZero()) book.push({ symbol: f.symbol, qty: remaining, price: px, orderId: f.orderId, time: f.time });
  }
  const realizedBySymbol: Record<string, Decimal> = {};
  for (const m of matches) realizedBySymbol[m.symbol] = (realizedBySymbol[m.symbol] ?? new Decimal(0)).plus(m.pnl);
  const realizedTotal = Object.values(realizedBySymbol).reduce((a, b) => a.plus(b), new Decimal(0));
  return { matches, openLots: Object.values(lots).flat(), realizedBySymbol, realizedTotal };
}

/** Unrealized P&L of open lots at current prices. Missing price → excluded and reported. */
export function unrealized(lots: Lot[], prices: Record<string, number | null | undefined>, exitAdjust?: (symbol: string, px: Decimal, long: boolean) => Decimal) {
  let total = new Decimal(0);
  const missing: string[] = [];
  for (const l of lots) {
    const p = prices[l.symbol];
    if (p == null) {
      missing.push(l.symbol);
      continue;
    }
    const long = l.qty.isPositive();
    const mark = exitAdjust ? exitAdjust(l.symbol, new Decimal(p), long) : new Decimal(p);
    total = total.plus(long ? mark.minus(l.price).mul(l.qty) : l.price.minus(mark).mul(l.qty.abs()));
  }
  return { total, missing: [...new Set(missing)] };
}

/**
 * "Would this work for real?": re-run P&L with slippage applied against you on
 * every fill (buy higher, sell lower by `bps`), a commission per order, and
 * exit slippage + commission on positions still open.
 */
export function realistic(fills: Fill[], prices: Record<string, number | null | undefined>, bps: number, commissionPerTrade: number) {
  const k = new Decimal(bps).div(10_000);
  const adj = (f: Fill) => {
    const p = new Decimal(f.price);
    return isBuy(f.side) ? p.mul(new Decimal(1).plus(k)) : p.mul(new Decimal(1).minus(k));
  };
  const r = fifo(fills, adj);
  const u = unrealized(r.openLots, prices, (_s, px, long) => (long ? px.mul(new Decimal(1).minus(k)) : px.mul(new Decimal(1).plus(k))));
  const orders = new Set(fills.map((f) => f.orderId)).size;
  const openPositions = new Set(r.openLots.map((l) => l.symbol)).size;
  const commissions = new Decimal(commissionPerTrade).mul(orders + openPositions);
  return {
    realized: r.realizedTotal,
    unrealized: u.total,
    commissions,
    total: r.realizedTotal.plus(u.total).minus(commissions),
    missingPrices: u.missing,
  };
}

/** Group matches into "trades" by closing order (one exit = one trade). */
export function closedTrades(matches: Match[]) {
  const byClose = new Map<string, { symbol: string; pnl: Decimal; closeTime: string; openOrderIds: Set<string>; qty: Decimal }>();
  for (const m of matches) {
    const t = byClose.get(m.closeOrderId) ?? { symbol: m.symbol, pnl: new Decimal(0), closeTime: m.closeTime, openOrderIds: new Set<string>(), qty: new Decimal(0) };
    t.pnl = t.pnl.plus(m.pnl);
    t.qty = t.qty.plus(m.qty);
    t.openOrderIds.add(m.openOrderId);
    if (m.closeTime > t.closeTime) t.closeTime = m.closeTime;
    byClose.set(m.closeOrderId, t);
  }
  return [...byClose.entries()].map(([closeOrderId, t]) => ({ closeOrderId, ...t }));
}

export function tradeStats(pnls: Decimal[]) {
  const wins = pnls.filter((p) => p.gt(0));
  const losses = pnls.filter((p) => p.lt(0));
  const grossWin = wins.reduce((a, b) => a.plus(b), new Decimal(0));
  const grossLoss = losses.reduce((a, b) => a.plus(b), new Decimal(0)).abs();
  return {
    trades: pnls.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pnls.length ? wins.length / pnls.length : null,
    avgWin: wins.length ? grossWin.div(wins.length) : null,
    avgLoss: losses.length ? grossLoss.div(losses.length).neg() : null,
    // Infinity when there are wins and no losses; null with no trades.
    profitFactor: grossLoss.isZero() ? (grossWin.gt(0) ? Infinity : null) : grossWin.div(grossLoss).toNumber(),
    net: grossWin.minus(grossLoss),
  };
}

/** Simple daily returns from an equity series. */
export function dailyReturns(equity: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!;
    if (prev > 0) out.push(equity[i]! / prev - 1);
  }
  return out;
}

/** Annualized Sharpe from daily returns (risk-free = 0, sample stdev, √252). */
export function sharpe(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return null;
  return (mean / sd) * Math.sqrt(252);
}

/** Max peak-to-trough decline as a positive fraction (0.1 = −10%). */
export function maxDrawdown(equity: number[]): { maxDd: number; peakIndex: number; troughIndex: number } {
  let peak = -Infinity;
  let peakI = 0;
  let best = { maxDd: 0, peakIndex: 0, troughIndex: 0 };
  equity.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakI = i;
    }
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > best.maxDd) best = { maxDd: dd, peakIndex: peakI, troughIndex: i };
  });
  return best;
}

/** Plain-language verdict vs SPY. Percentages in, sentence out. */
export function verdict(myPct: number, spyPct: number): string {
  const f = (x: number) => `${Math.abs(x).toFixed(1)}%`;
  const dir = (x: number) => (x >= 0 ? "up" : "down");
  const diff = myPct - spyPct;
  const tail =
    Math.abs(diff) < 0.05
      ? "you're roughly matching the index."
      : diff > 0
        ? `you're outperforming by ${f(diff)}.`
        : `you're underperforming by ${f(diff)}.`;
  return `You're ${dir(myPct)} ${f(myPct)}, SPY is ${dir(spyPct)} ${f(spyPct)} over the same period → ${tail}`;
}

/** Slippage in bps vs the arrival price; positive = cost to you. */
export function slippageBps(side: "buy" | "sell", arrival: number, fill: number): number {
  const raw = ((fill - arrival) / arrival) * 10_000;
  return side === "buy" ? raw : -raw;
}

/** Arrival price: quote midpoint when the quote is sane, else the last trade. */
export function arrivalPrice(bid: number | null, ask: number | null, last: number | null): { price: number; basis: "mid" | "last" } | null {
  if (bid && ask && ask >= bid && (ask - bid) / ((ask + bid) / 2) < 0.05) return { price: (bid + ask) / 2, basis: "mid" };
  if (last) return { price: last, basis: "last" };
  return null;
}
