import Decimal from "decimal.js";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { equitySnapshots, fills as fillsTable, journalEntries, orders as ordersTable } from "@/db/schema";
import {
  arrivalPrice,
  closedTrades,
  dailyReturns,
  fifo,
  maxDrawdown,
  realistic,
  sharpe,
  slippageBps,
  tradeStats,
  unrealized,
  verdict,
  type Fill,
} from "@/lib/analytics";
import { addDaysIso, etParts, tradingDayOf } from "@/lib/time";
import { getAccountStart } from "./account";
import { getBars, getSnapshots } from "./alpaca/market";
import { getAccount, getPortfolioHistory, getPositions } from "./alpaca/trading";
import { env } from "./env";
import { finnhubConfigured } from "./finnhub";
import { getFundamentals } from "./fundamentals";
import { normalizeSnapshot } from "./quotes";
import { syncFills } from "./sync";

export const RANGES = ["1D", "1W", "1M", "3M", "YTD", "ALL"] as const;
export type Range = (typeof RANGES)[number];

export interface CurvePoint {
  t: number; // unix seconds
  equity: number;
  spy: number | null; // SPY buy-and-hold with the same starting equity
}

export interface HistoryResult {
  range: Range;
  intraday: boolean;
  points: CurvePoint[];
  stats: {
    startEquity: number | null;
    endEquity: number | null;
    returnPct: number | null;
    spyReturnPct: number | null;
    excessPct: number | null;
    maxDrawdownPct: number | null;
    sharpe: number | null;
    days: number;
  };
  note: string | null;
}

const SPY = "SPY";

/** Equity curve for a range, with a SPY buy-and-hold overlay starting from the same equity. */
export async function getHistory(range: Range): Promise<HistoryResult> {
  const a = await getAccount();
  const start = await getAccountStart(a.account_number, a.equity);
  const today = etParts(new Date()).date;
  const intraday = range === "1D" || range === "1W";

  const q =
    range === "1D"
      ? { period: "1D", timeframe: "5Min" as const, intraday_reporting: "market_hours" as const }
      : range === "1W"
        ? { period: "1W", timeframe: "1H" as const, intraday_reporting: "market_hours" as const }
        : range === "1M"
          ? { period: "1M", timeframe: "1D" as const }
          : range === "3M"
            ? { period: "3M", timeframe: "1D" as const }
            : range === "YTD"
              ? { start: `${today.slice(0, 4)}-01-01`, timeframe: "1D" as const }
              : { start: start.date, timeframe: "1D" as const };
  const h = await getPortfolioHistory(q);

  let raw = h.timestamp
    .map((t, i) => ({ t, equity: h.equity[i] }))
    .filter((p): p is { t: number; equity: number } => p.equity != null && p.equity > 0);

  // Daily ranges: fill gaps with our own end-of-day snapshots (same account).
  if (!intraday) {
    const snaps = await db().select().from(equitySnapshots).where(eq(equitySnapshots.accountNumber, a.account_number));
    const have = new Set(raw.map((p) => tradingDayOf(p.t)));
    const firstDate = raw[0] ? tradingDayOf(raw[0].t) : start.date;
    for (const s of snaps) {
      if (!have.has(s.date) && s.date >= firstDate) {
        raw.push({ t: Math.floor(new Date(`${s.date}T21:00:00Z`).getTime() / 1000), equity: Number(s.equity) });
      }
    }
    raw = raw.sort((x, y) => x.t - y.t);
  }

  // End the curve at live equity. Daily points mean "equity at the end of that day",
  // so if today's point exists, update it in place instead of adding a duplicate.
  const nowT = Math.floor(Date.now() / 1000);
  const lastRaw = raw[raw.length - 1];
  let livePointIndex = -1;
  if (lastRaw && !intraday && tradingDayOf(lastRaw.t) === today) {
    lastRaw.equity = Number(a.equity);
    livePointIndex = raw.length - 1;
  } else if (lastRaw && nowT - lastRaw.t > 60) {
    raw.push({ t: nowT, equity: Number(a.equity) });
    livePointIndex = raw.length - 1;
  }

  let note: string | null = null;
  const points: CurvePoint[] = raw.map((p) => ({ ...p, spy: null }));
  if (points.length >= 1) {
    const firstDate = intraday ? etParts(new Date(points[0]!.t * 1000)).date : tradingDayOf(points[0]!.t);
    const tf = range === "1D" ? "5Min" : range === "1W" ? "1Hour" : "1Day";
    const barsStart = intraday ? new Date((points[0]!.t - 3 * 86400) * 1000).toISOString() : `${addDaysIso(firstDate, -7)}T00:00:00Z`;
    const spyBars = (await getBars([SPY], tf, barsStart))[SPY] ?? [];
    const spyQuote = normalizeSnapshot(SPY, (await getSnapshots([SPY]))[SPY]);
    const spyAt = (t: number): number | null => {
      if (!intraday) {
        const d = tradingDayOf(t);
        let px: number | null = null;
        for (const b of spyBars) if (etParts(new Date(b.t)).date <= d) px = b.c;
        return px;
      }
      let px: number | null = null;
      for (const b of spyBars) if (new Date(b.t).getTime() / 1000 <= t) px = b.c;
      return px;
    };
    const spy0 = livePointIndex === 0 && spyQuote.price ? spyQuote.price : spyAt(points[0]!.t);
    const base = points[0]!.equity;
    if (spy0) {
      for (let i = 0; i < points.length; i++) {
        // Today's/now point uses the live SPY price (today's daily bar may not exist yet).
        const isNow = i === livePointIndex;
        const px = isNow && spyQuote.price ? spyQuote.price : spyAt(points[i]!.t);
        points[i]!.spy = px ? (base * px) / spy0 : null;
      }
    } else note = "SPY prices unavailable for this range; benchmark hidden.";
  }

  const equities = points.map((p) => p.equity);
  const first = points[0];
  const last = points[points.length - 1];
  const ret = first && last ? (last.equity / first.equity - 1) * 100 : null;
  const spyRet = first?.spy && last?.spy ? (last.spy / first.spy - 1) * 100 : null;
  const dd = equities.length ? maxDrawdown(equities).maxDd * 100 : null;
  const daily = !intraday ? dailyReturns(equities) : [];
  if (points.length < 2) note = "Not enough history yet: the curve fills in as days pass.";
  return {
    range,
    intraday,
    points,
    stats: {
      startEquity: first?.equity ?? null,
      endEquity: last?.equity ?? null,
      returnPct: ret,
      spyReturnPct: spyRet,
      excessPct: ret !== null && spyRet !== null ? ret - spyRet : null,
      maxDrawdownPct: dd,
      sharpe: sharpe(daily),
      days: daily.length,
    },
    note,
  };
}

const d2 = (x: Decimal | null) => (x === null ? null : x.toFixed(2));

/** Everything for the "Would this work for real?" panel and portfolio stats. */
export async function getPerformance() {
  const e = env();
  await syncFills();
  const a = await getAccount();
  const start = await getAccountStart(a.account_number, a.equity);
  const rows = await db().select().from(fillsTable).where(eq(fillsTable.accountNumber, a.account_number));
  const fills: Fill[] = rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    symbol: r.symbol,
    side: r.side,
    qty: r.qty,
    price: r.price,
    time: r.transactionTime.toISOString(),
  }));

  // Mark-to-market prices: Alpaca positions first, snapshots for anything else.
  const positions = await getPositions();
  const prices: Record<string, number | null> = {};
  for (const p of positions) prices[p.symbol] = p.current_price ? Number(p.current_price) : null;
  const raw = fifo(fills);
  const needed = [...new Set(raw.openLots.map((l) => l.symbol))].filter((s) => prices[s] == null);
  if (needed.length) {
    const snaps = await getSnapshots(needed);
    for (const s of needed) prices[s] = normalizeSnapshot(s, snaps[s]).price;
  }

  const unreal = unrealized(raw.openLots, prices);
  const rawTotal = raw.realizedTotal.plus(unreal.total);
  const real = realistic(fills, prices, e.SLIPPAGE_BPS, e.COMMISSION_PER_TRADE);
  const trades = closedTrades(raw.matches);
  const stats = tradeStats(trades.map((t) => t.pnl));

  // P&L per tag: attribute each FIFO match to the tags of the order that OPENED it.
  const orderIds = [...new Set(raw.matches.map((m) => m.openOrderId))];
  const tagRows = orderIds.length
    ? await db().select({ orderId: journalEntries.orderId, tags: journalEntries.tags }).from(journalEntries).where(inArray(journalEntries.orderId, orderIds))
    : [];
  const tagsByOrder = new Map(tagRows.map((r) => [r.orderId!, r.tags.length ? r.tags : ["untagged"]]));
  const perTag = new Map<string, { pnl: Decimal; closes: Set<string>; wins: number }>();
  for (const m of raw.matches) {
    for (const tag of tagsByOrder.get(m.openOrderId) ?? ["no journal"]) {
      const t = perTag.get(tag) ?? { pnl: new Decimal(0), closes: new Set<string>(), wins: 0 };
      t.pnl = t.pnl.plus(m.pnl);
      t.closes.add(m.closeOrderId);
      perTag.set(tag, t);
    }
  }

  // Measured slippage: market orders, quote at submit vs actual average fill.
  const filledMarket = await db()
    .select({
      symbol: journalEntries.symbol,
      side: journalEntries.side,
      bid: journalEntries.quoteBid,
      ask: journalEntries.quoteAsk,
      last: journalEntries.quoteLast,
      quoteAt: journalEntries.quoteAt,
      fill: ordersTable.filledAvgPrice,
      filledAt: ordersTable.filledAt,
      qty: ordersTable.filledQty,
    })
    .from(journalEntries)
    .innerJoin(ordersTable, eq(ordersTable.id, journalEntries.orderId))
    .where(and(eq(journalEntries.orderType, "market"), eq(ordersTable.status, "filled"), isNotNull(ordersTable.filledAvgPrice)));
  const slip = filledMarket.flatMap((r) => {
    const arr = arrivalPrice(r.bid, r.ask, r.last);
    if (!arr || !r.fill) return [];
    return [
      {
        symbol: r.symbol,
        side: r.side,
        arrival: arr.price,
        basis: arr.basis,
        fill: Number(r.fill),
        bps: slippageBps(r.side, arr.price, Number(r.fill)),
        // Orders that queued overnight fill at the open, not near the submit quote.
        delayedFill: r.quoteAt && r.filledAt ? r.filledAt.getTime() - r.quoteAt.getTime() > 5 * 60_000 : false,
        filledAt: r.filledAt?.toISOString() ?? null,
      },
    ];
  });
  const immediate = slip.filter((s) => !s.delayedFill);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  // Vs SPY since the first trade (the spec's benchmark start). No trades → no comparison yet.
  const firstTrade = fills.length ? fills.map((f) => f.time).sort()[0]! : null;
  const sinceDate = firstTrade ? etParts(new Date(firstTrade)).date : null;
  let spyPct: number | null = null;
  let spyValue: Decimal | null = null;
  if (sinceDate) {
    const spyBars = (await getBars([SPY], "1Day", `${addDaysIso(sinceDate, -10)}T00:00:00Z`))[SPY] ?? [];
    // Buy SPY at the prior close, i.e. at the start of the first trade's day.
    const before = spyBars.filter((b) => etParts(new Date(b.t)).date < sinceDate).at(-1) ?? spyBars[0];
    const spyNow = normalizeSnapshot(SPY, (await getSnapshots([SPY]))[SPY]).price;
    if (before && spyNow) {
      spyPct = (spyNow / before.c - 1) * 100;
      spyValue = new Decimal(start.balance).mul(spyNow).div(before.c);
    }
  }
  const myPct = new Decimal(a.equity).div(start.balance).minus(1).mul(100).toNumber();

  const closedCount = trades.length;
  return {
    accountNumber: a.account_number,
    start,
    since: sinceDate,
    equity: a.equity,
    equityPL: new Decimal(a.equity).minus(start.balance).toFixed(2),
    raw: { realized: d2(raw.realizedTotal), unrealized: d2(unreal.total), total: d2(rawTotal) },
    realistic: {
      realized: d2(real.realized),
      unrealized: d2(real.unrealized),
      commissions: d2(real.commissions),
      total: d2(real.total),
      gap: d2(rawTotal.minus(real.total)),
      slippageBps: e.SLIPPAGE_BPS,
      commissionPerTrade: e.COMMISSION_PER_TRADE,
    },
    missingPrices: unreal.missing,
    realizedBySymbol: Object.fromEntries(Object.entries(raw.realizedBySymbol).map(([s, v]) => [s, v.toFixed(2)])),
    trades: {
      count: closedCount,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      avgWin: d2(stats.avgWin),
      avgLoss: d2(stats.avgLoss),
      profitFactor: stats.profitFactor === Infinity ? "∞" : stats.profitFactor,
      recent: trades
        .sort((x, y) => y.closeTime.localeCompare(x.closeTime))
        .slice(0, 50)
        .map((t) => ({ closeOrderId: t.closeOrderId, symbol: t.symbol, qty: t.qty.toString(), pnl: t.pnl.toFixed(2), closeTime: t.closeTime })),
    },
    perTag: [...perTag.entries()]
      .map(([tag, v]) => ({ tag, pnl: v.pnl.toFixed(2), trades: v.closes.size }))
      .sort((x, y) => Number(y.pnl) - Number(x.pnl)),
    slippage: {
      orders: slip.length,
      immediateOrders: immediate.length,
      avgBps: avg(immediate.map((s) => s.bps)),
      medianBps: median(immediate.map((s) => s.bps)),
      avgBpsAll: avg(slip.map((s) => s.bps)),
      recent: slip.slice(-30).reverse(),
    },
    vsSpy: {
      myPct,
      spyPct,
      spyValue: d2(spyValue),
      verdict: spyPct !== null ? verdict(myPct, spyPct) : sinceDate ? "SPY data unavailable right now." : "No trades yet: the SPY comparison starts at your first fill.",
    },
    sampleWarning: closedCount < 30 ? `Not enough trades to conclude anything yet (${closedCount} closed; need at least 30).` : null,
    fillCount: fills.length,
  };
}

/** Allocation by position (incl. cash) and by sector (Finnhub industry when configured). */
export async function getAllocation() {
  const [positions, a] = await Promise.all([getPositions(), getAccount()]);
  const byPosition = positions
    .map((p) => ({ name: p.symbol, value: Math.abs(Number(p.market_value ?? 0)), side: p.side }))
    .sort((x, y) => y.value - x.value);
  const cash = Number(a.cash);
  let bySector: { name: string; value: number }[] | null = null;
  const sectorErrors: string[] = [];
  if (finnhubConfigured() && positions.length) {
    const m = new Map<string, number>();
    for (const p of positions) {
      let sector = "Unknown";
      try {
        sector = (await getFundamentals(p.symbol)).industry ?? "Unknown";
      } catch (e) {
        sectorErrors.push(`${p.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      }
      m.set(sector, (m.get(sector) ?? 0) + Math.abs(Number(p.market_value ?? 0)));
    }
    bySector = [...m.entries()].map(([name, value]) => ({ name, value })).sort((x, y) => y.value - x.value);
  }
  return { byPosition, cash, equity: Number(a.equity), bySector, sectorsEnabled: finnhubConfigured(), sectorErrors };
}
