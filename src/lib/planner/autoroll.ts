import { addMonths, expenseInMonth, round2 } from "./core";
import { netIncome } from "./net";
import type { Profile, YearMonth } from "./types";

/**
 * Monthly auto-update of balances. After a month ENDS, apply what happened:
 *   cash += take-home income − spending − debt payments
 *   each debt: + interest (APR/12), − its minimum payment
 * Using imported transactions for that month when available (actual), otherwise
 * the plan's numbers (estimated). Pure and idempotent: lastRolledMonth guards it.
 */
export interface AutoRoll {
  enabled: boolean;
  /** Account (CASH/HISA) that receives income and pays spending. */
  cashAccountId: string;
  /** Last month already applied (YYYY-MM). The next roll is the month after. */
  lastRolledMonth: YearMonth;
}

export interface MonthActuals {
  income: number; // money in (positive transactions, excl. transfers)
  spending: number; // money out (excl. transfers)
}

export interface RollEntry {
  month: YearMonth;
  source: "actual" | "estimated";
  income: number;
  spending: number;
  debtPayments: number;
  debtInterest: number;
  cashAfter: number;
  debtAfter: number;
  netWorth: number;
}

export function lastCompletedMonth(today: YearMonth): YearMonth {
  return addMonths(today, -1);
}

/** Apply one finished month to the profile. Returns the new profile and a log entry. */
export function rollMonth(p: Profile, month: YearMonth, actual?: MonthActuals | null): { profile: Profile; entry: RollEntry } {
  const ar = p.autoRoll!;
  const plannedIncome = netIncome(p, month, 1).byMonth[0]!.amount;
  const plannedSpending = expenseInMonth(p.expenses, month);
  const income = actual ? actual.income : plannedIncome;
  const spending = actual ? actual.spending : plannedSpending;

  let paid = 0;
  let interest = 0;
  const debts = p.debts.map((d) => {
    if (d.balance <= 0) return d;
    const i = (d.balance * d.aprPct) / 100 / 12;
    const withInterest = d.balance + i;
    const pay = Math.min(d.minPayment, withInterest);
    interest += i;
    paid += pay;
    return { ...d, balance: round2(withInterest - pay) };
  });

  const accounts = p.accounts.map((a) => (a.id === ar.cashAccountId ? { ...a, balance: round2(a.balance + income - spending - paid) } : a));
  const cashAfter = accounts.find((a) => a.id === ar.cashAccountId)?.balance ?? 0;
  const assets = accounts.reduce((s, a) => s + a.balance, 0);
  const debtAfter = round2(debts.reduce((s, d) => s + d.balance, 0));
  return {
    profile: { ...p, accounts, debts, autoRoll: { ...ar, lastRolledMonth: month } },
    entry: {
      month,
      source: actual ? "actual" : "estimated",
      income: round2(income),
      spending: round2(spending),
      debtPayments: round2(paid),
      debtInterest: round2(interest),
      cashAfter,
      debtAfter,
      netWorth: round2(assets - debtAfter),
    },
  };
}

/** Roll every finished month since lastRolledMonth (capped so a long gap can't run away). */
export function rollForward(
  p: Profile,
  today: YearMonth,
  actualFor: (month: YearMonth) => MonthActuals | null = () => null,
  maxMonths = 60,
): { profile: Profile; entries: RollEntry[] } {
  const entries: RollEntry[] = [];
  if (!p.autoRoll?.enabled || !p.accounts.some((a) => a.id === p.autoRoll!.cashAccountId)) return { profile: p, entries };
  const last = lastCompletedMonth(today);
  let cur = p;
  for (let m = addMonths(cur.autoRoll!.lastRolledMonth, 1); m <= last && entries.length < maxMonths; m = addMonths(m, 1)) {
    const r = rollMonth(cur, m, actualFor(m));
    cur = r.profile;
    entries.push(r.entry);
  }
  return { profile: cur, entries };
}
