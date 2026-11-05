import Decimal from "decimal.js";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mockTxns } from "@/db/schema";
import { maxDrawdown } from "@/lib/analytics";
import { addDaysIso, etParts } from "@/lib/time";
import { getAccountSummary } from "./account";
import { getBars, getSnapshots } from "./alpaca/market";
import { getAccountState, listAccounts } from "./mock-broker";
import { normalizeSnapshot } from "./quotes";

/**
 * Daily value of a mock account (replayed from its ledger at each day's close)
 * next to "the same deposits into SPY": each contribution buys SPY at that
 * day's close, each withdrawal sells it. Same deposits, same dates: a fair test.
 */
export async function accountHistory(accountId: number) {
  const acct = await getAccountState(accountId);
  const txns = await db().select().from(mockTxns).where(eq(mockTxns.accountId, accountId)).orderBy(asc(mockTxns.at), asc(mockTxns.id));
  const start = etParts(new Date(acct.openedAt)).date;
  const symbols = [...new Set(["SPY", ...txns.filter((t) => t.symbol).map((t) => t.symbol!)])];
  const bars = await getBars(symbols, "1Day", `${addDaysIso(start, -7)}T00:00:00Z`);
  const close = (sym: string, date: string) => {
    let px: number | null = null;
    for (const b of bars[sym] ?? []) if (etParts(new Date(b.t)).date <= date) px = b.c;
    return px;
  };
  const days = [...new Set((bars.SPY ?? []).map((b) => etParts(new Date(b.t)).date).filter((d) => d >= start))];
  const today = etParts(new Date()).date;
  if (!days.includes(today)) days.push(today);

  const live = await getSnapshots(symbols);
  const livePx = (s: string) => normalizeSnapshot(s, live[s]).price;
  const points: { date: string; value: number; deposits: number; spy: number }[] = [];
  for (const d of days) {
    let cash = new Decimal(0);
    let deposits = new Decimal(0);
    let spyUnits = new Decimal(0);
    const qty = new Map<string, Decimal>();
    for (const t of txns) {
      if (etParts(t.at).date > d) break;
      cash = cash.plus(t.cash);
      if (t.kind === "contribution" || t.kind === "withdrawal") {
        deposits = deposits.plus(t.cash);
        const px = close("SPY", etParts(t.at).date) ?? livePx("SPY");
        if (px) spyUnits = spyUnits.plus(new Decimal(t.cash).div(px));
      }
      if (t.symbol && t.qty) qty.set(t.symbol, (qty.get(t.symbol) ?? new Decimal(0)).plus(t.kind === "buy" ? t.qty : new Decimal(t.qty).neg()));
    }
    const px = (s: string) => (d === today ? (livePx(s) ?? close(s, d)) : close(s, d));
    let v = cash;
    let ok = true;
    for (const [s, q] of qty) {
      const p = px(s);
      if (p === null) ok = false;
      else v = v.plus(q.mul(p));
    }
    const spyPx = px("SPY");
    if (!ok || spyPx === null) continue;
    points.push({ date: d, value: v.toDecimalPlaces(2).toNumber(), deposits: deposits.toDecimalPlaces(2).toNumber(), spy: spyUnits.mul(spyPx).toDecimalPlaces(2).toNumber() });
  }
  const last = points.at(-1);
  return {
    account: { id: acct.id, type: acct.type, name: acct.name },
    points,
    gain: last ? last.value - last.deposits : 0,
    gainVsSpy: last ? last.value - last.spy : 0,
    maxDrawdownPct: points.length ? maxDrawdown(points.map((p) => p.value)).maxDd * 100 : 0,
  };
}

/** "Followed the plan" (mock accounts) vs the stock-picking sandbox (Alpaca paper account). */
export async function planVsSandbox() {
  const accts = await listAccounts();
  const deposits = accts.reduce((s, a) => s + a.netDeposits, 0);
  const value = accts.every((a) => a.value !== null) ? accts.reduce((s, a) => s + (a.value ?? 0), 0) : null;
  let sandbox: { returnPct: number; since: string } | null = null;
  try {
    const s = await getAccountSummary();
    sandbox = { returnPct: Number(s.allTimePLPct ?? 0), since: s.startDate };
  } catch {
    sandbox = null;
  }
  return {
    plan: { deposits, value, returnPct: value !== null && deposits > 0 ? ((value - deposits) / deposits) * 100 : null },
    sandbox,
    note: "Plan = mock accounts following the model portfolio (gain on what you deposited). Sandbox = your Alpaca stock picking (gain on the starting balance). Different money bases, so compare the percentages; both span different dates until you've run them side by side for a while.",
  };
}
