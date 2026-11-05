import { round2 } from "./core";
import { detectPaychecks, matchIncomeLine, PAYCHECK, type PayTx } from "./paychecks";
import type { Profile } from "./types";
import { budgetToExpenses, newYearPlan } from "./yearplan";

/**
 * Profile updates that follow from your statements and the calendar. Pure: the
 * server loads the profile, applies these, and saves it once.
 */

const scheduled = (i: Profile["incomes"][number]) => i.frequency === "weekly" || i.frequency === "biweekly" || (i.frequency === "hourly" && !!i.payEvery);

/** First / last paycheck dates from payroll deposits for every scheduled income line that matches an employer. */
export function syncPayDates(p: Profile, txs: PayTx[]): Profile {
  const patterns = detectPaychecks(txs);
  const incomes = p.incomes.map((line) => {
    if (!scheduled(line)) return line;
    const x = patterns.find((pt) => matchIncomeLine(pt, p.incomes)?.id === line.id);
    if (!x) return line;
    return { ...line, firstPayDate: x.first, lastPayDate: x.ongoing ? null : x.last, payDatesFromDeposits: true, payDay: line.payDay ?? x.payDay ?? 5 };
  });
  return { ...p, incomes };
}

export interface StoredPayTx extends PayTx {
  id: number;
}

/**
 * Add paycheck deposits to the chosen cash account, once each: only deposits
 * dated AFTER the day you entered the balance (older ones are already in it),
 * and never a transaction id that was already added. Expected paydays alone
 * never add money: only imported deposits do.
 */
export function creditPaychecks(p: Profile, txs: StoredPayTx[]): { profile: Profile; credited: { id: number; date: string; amount: number }[] } {
  const cs = p.cashSync;
  if (!cs?.enabled || !p.accounts.some((a) => a.id === cs.accountId)) return { profile: p, credited: [] };
  const done = new Set(cs.credited);
  const credited = txs
    .filter((t) => t.category === "Income" && t.amount > 0 && PAYCHECK.test(t.description) && t.date > cs.balanceAsOf && !done.has(t.id))
    .map((t) => ({ id: t.id, date: t.date, amount: round2(t.amount) }));
  if (!credited.length) return { profile: p, credited };
  const add = credited.reduce((s, c) => s + c.amount, 0);
  return {
    profile: {
      ...p,
      accounts: p.accounts.map((a) => (a.id === cs.accountId ? { ...a, balance: round2(a.balance + add) } : a)),
      cashSync: { ...cs, credited: [...cs.credited, ...credited.map((c) => c.id)] },
    },
    credited,
  };
}

/** When you type a new balance for the synced account, deposits up to today are in it: move balanceAsOf to today. */
export function noteBalanceEdit(prev: Profile | null, next: Profile, today: string): Profile {
  const cs = next.cashSync;
  if (!cs?.enabled) return next;
  const before = prev?.accounts.find((a) => a.id === cs.accountId)?.balance;
  const after = next.accounts.find((a) => a.id === cs.accountId)?.balance;
  const switched = prev?.cashSync?.accountId !== cs.accountId || !prev?.cashSync?.enabled;
  return before !== after || switched ? { ...next, cashSync: { ...cs, balanceAsOf: today } } : next;
}

/**
 * The calendar-year plan exists for `year`: created from last year's plan (or
 * your budget lines), with today's balances; previous years are kept. Also turns
 * the old month-end auto-update into deposit-based updates (it estimated income).
 */
export function ensureYearPlan(p: Profile, year: number, today: string): { profile: Profile; changed: boolean } {
  let out = p;
  let changed = false;
  if (out.autoRoll?.enabled && !out.cashSync) {
    out = { ...out, cashSync: { enabled: true, accountId: out.autoRoll.cashAccountId, balanceAsOf: today, credited: [] }, autoRoll: { ...out.autoRoll, enabled: false } };
    changed = true;
  }
  const plans = out.yearPlans ?? {};
  if (!plans[String(year)]) {
    const plan = newYearPlan(out, year, today, plans[String(year - 1)]);
    out = { ...out, yearPlans: { ...plans, [String(year)]: plan } };
    changed = true;
  }
  return { profile: out, changed };
}

/** Budget lines used by the rest of the app come from the year plans. */
export function withPlanExpenses(p: Profile): Profile {
  return p.yearPlans && Object.keys(p.yearPlans).length ? { ...p, expenses: budgetToExpenses(p.yearPlans) } : p;
}
