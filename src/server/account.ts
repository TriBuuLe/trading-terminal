import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import type { AccountSummary, PositionRow } from "@/lib/types";
import { tradingDayOf } from "@/lib/time";
import { getAccount, getPortfolioHistory, getPositions } from "./alpaca/trading";

export interface AccountStart {
  accountNumber: string;
  balance: string;
  date: string; // YYYY-MM-DD
  source: "auto" | "manual";
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const rows = await db().select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0] ? (rows[0].value as T) : null;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db()
    .insert(settings)
    .values({ key, value: value as unknown, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as unknown, updatedAt: new Date() } });
}

/**
 * Starting balance + date for "all-time" P&L and the SPY benchmark. Taken from
 * settings; if missing (or the paper account was reset → new account number),
 * derived from the first point of Alpaca's portfolio history.
 */
export async function getAccountStart(accountNumber: string, currentEquity: string): Promise<AccountStart> {
  const saved = await getSetting<AccountStart>("account_start");
  if (saved && saved.accountNumber === accountNumber) return saved;

  let balance = currentEquity;
  let date = new Date().toISOString().slice(0, 10);
  try {
    const h = await getPortfolioHistory({ period: "1A", timeframe: "1D" });
    const i = h.equity.findIndex((v) => v !== null && v > 0);
    if (i >= 0) {
      balance = new Decimal(h.equity[i]!).toFixed(2);
      date = tradingDayOf(h.timestamp[i]!);
    } else if (h.base_value) {
      balance = new Decimal(h.base_value).toFixed(2);
    }
  } catch {
    // fall back to current equity
  }
  const start: AccountStart = { accountNumber, balance, date, source: "auto" };
  await setSetting("account_start", start);
  return start;
}

const pct = (num: Decimal, den: Decimal) => (den.isZero() ? null : num.div(den).mul(100).toFixed(4));

export async function getAccountSummary(): Promise<AccountSummary> {
  const a = await getAccount();
  const start = await getAccountStart(a.account_number, a.equity);
  const equity = new Decimal(a.equity);
  const lastEquity = new Decimal(a.last_equity);
  const startBal = new Decimal(start.balance);
  const dayPL = equity.minus(lastEquity);
  const allTime = equity.minus(startBal);
  return {
    accountNumber: a.account_number,
    status: a.status,
    equity: a.equity,
    lastEquity: a.last_equity,
    cash: a.cash,
    buyingPower: a.buying_power,
    longMarketValue: a.long_market_value ?? null,
    dayPL: dayPL.toFixed(2),
    dayPLPct: pct(dayPL, lastEquity),
    allTimePL: allTime.toFixed(2),
    allTimePLPct: pct(allTime, startBal),
    startBalance: start.balance,
    startDate: start.date,
    patternDayTrader: a.pattern_day_trader ?? false,
    daytradeCount: a.daytrade_count ?? 0,
    tradingBlocked: a.trading_blocked ?? false,
    shortingEnabled: a.shorting_enabled ?? false,
  };
}

export async function getPositionRows(): Promise<PositionRow[]> {
  const [positions, a] = await Promise.all([getPositions(), getAccount()]);
  const equity = new Decimal(a.equity);
  return positions
    .map((p) => {
      const mv = p.market_value ? new Decimal(p.market_value) : null;
      return {
        symbol: p.symbol,
        side: p.side,
        qty: p.qty,
        avgEntry: p.avg_entry_price,
        last: p.current_price ?? null,
        marketValue: p.market_value ?? null,
        costBasis: p.cost_basis,
        unrealizedPL: p.unrealized_pl ?? null,
        unrealizedPLPct: p.unrealized_plpc ? new Decimal(p.unrealized_plpc).mul(100).toFixed(4) : null,
        todayPL: p.unrealized_intraday_pl ?? null,
        todayPLPct: p.unrealized_intraday_plpc ? new Decimal(p.unrealized_intraday_plpc).mul(100).toFixed(4) : null,
        pctOfPortfolio: mv && !equity.isZero() ? mv.abs().div(equity).mul(100).toFixed(4) : null,
      };
    })
    .sort((x, y) => Math.abs(Number(y.marketValue ?? 0)) - Math.abs(Number(x.marketValue ?? 0)));
}
