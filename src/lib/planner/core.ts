import type { Debt, Expense, Frequency, IncomeStream, RiskAnswers, YearMonth } from "./types";

/** Deterministic planning math. Pure functions, no I/O. */

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// "once" (a bonus) has no monthly equivalent: it counts in the month it's paid (see incomeInMonth).
const PER_YEAR: Record<Exclude<Frequency, "hourly">, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1, once: 0 };

/** Monthly equivalent. Hourly = rate × hours/week × 52 weeks ÷ 12 months. */
export function monthlyEquivalent(amount: number, frequency: Frequency, hoursPerWeek = 40): number {
  if (frequency === "hourly") return (amount * hoursPerWeek * 52) / 12;
  return (amount * PER_YEAR[frequency]) / 12;
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(from: YearMonth, to: YearMonth): number {
  const [y1, m1] = from.split("-").map(Number) as [number, number];
  const [y2, m2] = to.split("-").map(Number) as [number, number];
  return (y2 - y1) * 12 + (m2 - m1);
}

const dayMs = 86_400_000;
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const onOrAfter = (t: number, weekday: number) => t + ((((weekday - new Date(t).getUTCDay()) % 7) + 7) % 7) * dayMs;

/**
 * A paycheck schedule: weekly or every two weeks on `payDay`, or hourly pay with
 * `payEvery`. Needs a first paycheck date or an employment start date.
 */
export function paySchedule(s: IncomeStream): { periodDays: 7 | 14; hourly: boolean } | null {
  if (!s.firstPayDate && !s.employmentStart) return null;
  if (s.frequency === "weekly") return { periodDays: 7, hourly: false };
  if (s.frequency === "biweekly") return { periodDays: 14, hourly: false };
  if (s.frequency === "hourly" && s.payEvery) return { periodDays: s.payEvery === "weekly" ? 7 : 14, hourly: true };
  return null;
}

/** Workdays (default Mon–Fri) between two dates inclusive, also inside the employment dates. */
function workdaysIn(s: IncomeStream, from: number, to: number): { worked: number; all: number } {
  const days = s.workdays?.length ? s.workdays : [1, 2, 3, 4, 5];
  const lo = s.employmentStart ? utc(s.employmentStart) : -Infinity;
  const hi = s.employmentEnd ? utc(s.employmentEnd) : Infinity;
  let worked = 0;
  let all = 0;
  for (let t = from; t <= to; t += dayMs) {
    if (!days.includes(new Date(t).getUTCDay())) continue;
    all++;
    if (t >= lo && t <= hi) worked++;
  }
  return { worked, all };
}

/**
 * Every paycheck (date and take-home/gross amount per the line's basis) between
 * `from` and `to`. A paycheck on payday P pays for the period ending
 * `periodEndsDaysBefore` days before P. With employment dates, partial first/last
 * periods are prorated by the workdays inside the employment dates; hourly pay is
 * rate × hours per workday × workdays worked in the period.
 */
export function paychecks(s: IncomeStream, from: string, to: string): { date: string; amount: number }[] {
  const sch = paySchedule(s);
  if (!sch) return [];
  const payDay = s.payDay ?? 5;
  // How far pay runs behind work. Known first paycheck + employment start → measured
  // (start Mon Aug 31, first check Fri Sep 11 = one week behind); otherwise the setting.
  const measured = s.firstPayDate && s.employmentStart ? Math.max(0, utc(s.firstPayDate) - onOrAfter(utc(s.employmentStart), payDay)) : null;
  const lag = measured ?? (s.periodEndsDaysBefore ?? 0) * dayMs;
  const first = s.firstPayDate ? utc(s.firstPayDate) : onOrAfter(utc(s.employmentStart!) + lag, payDay);
  // Last paycheck: known, or the first payday ON THE SCHEDULE on/after (employment end + lag).
  const period = sch.periodDays * dayMs;
  const last = s.lastPayDate ? utc(s.lastPayDate) : s.employmentEnd ? first + Math.max(0, Math.ceil((utc(s.employmentEnd) + lag - first) / period)) * period : Infinity;
  const lo = utc(from);
  const hi = Math.min(last, utc(to));
  const days = s.workdays?.length ? s.workdays : [1, 2, 3, 4, 5];
  // Salaried pay: every paycheck is the per-paycheck amount (no proration). Hourly: rate × hours × workdays worked.
  const out: { date: string; amount: number }[] = [];
  for (let t = first; t <= hi; t += sch.periodDays * dayMs) {
    if (t < lo) continue;
    const end = t - lag;
    const w = workdaysIn(s, end - (sch.periodDays - 1) * dayMs, end);
    const amount = sch.hourly ? s.amount * ((s.hoursPerWeek ?? 40) / days.length) * w.worked : s.amount;
    if (amount > 0) out.push({ date: iso(t), amount: round2(amount) });
  }
  return out;
}

/** Paycheck dates only. */
export const paydays = (s: IncomeStream, from: string, to: string) => paychecks(s, from, to).map((p) => p.date);

/** The next expected paycheck on or after `today` (an expectation from the schedule, not a deposit). */
export function nextPaycheck(streams: IncomeStream[], today: string): { date: string; amount: number; name: string } | null {
  const next = streams
    .flatMap((s) => {
      const p = paychecks(s, today, iso(utc(today) + 15 * dayMs))[0];
      return p ? [{ ...p, name: s.name }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return next[0] ?? null;
}

const lastDay = (month: YearMonth) => iso(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));

/** Take-home income in a given month, honoring co-op/school windows, exact pay schedules and yearly raises. */
export function incomeInMonth(streams: IncomeStream[], month: YearMonth): number {
  let total = 0;
  for (const s of streams) {
    const sch = paySchedule(s);
    const startYm = (s.employmentStart ?? s.firstPayDate)?.slice(0, 7) ?? s.startMonth;
    let amt: number;
    if (s.frequency === "once") {
      // A one-time payment (bonus): the whole amount in the month it's paid.
      const paid = s.firstPayDate?.slice(0, 7) ?? s.startMonth;
      if (paid !== month) continue;
      amt = s.amount;
    } else if (sch) amt = paychecks(s, `${month}-01`, lastDay(month)).reduce((a, p) => a + p.amount, 0);
    else if (s.employmentStart || s.employmentEnd) {
      // monthly / semimonthly / annual with employment dates: active by month
      if ((s.employmentStart && month < s.employmentStart.slice(0, 7)) || (s.employmentEnd && month > s.employmentEnd.slice(0, 7))) continue;
      amt = monthlyEquivalent(s.amount, s.frequency, s.hoursPerWeek);
    } else {
      if (!isActive(s, month)) continue;
      amt = monthlyEquivalent(s.amount, s.frequency, s.hoursPerWeek);
    }
    if (s.annualRaisePct && startYm) {
      const years = Number(month.slice(0, 4)) - Number(startYm.slice(0, 4));
      if (years > 0) amt *= (1 + s.annualRaisePct / 100) ** years;
    }
    total += amt;
  }
  return total;
}

/**
 * Is an income stream paying in `month`?
 *  - one-off window: startMonth ≤ month ≤ endMonth (either side open-ended)
 *  - repeatsYearly: the same calendar months every year from the start year on
 *    (e.g. a Sep–Dec co-op term; Nov–Feb wraps across New Year)
 */
export interface Windowed {
  startMonth?: YearMonth | null;
  endMonth?: YearMonth | null;
  repeatsYearly?: boolean;
}

export function isActive(s: Windowed, month: YearMonth): boolean {
  if (s.repeatsYearly && s.startMonth && s.endMonth) {
    if (month < s.startMonth) return false;
    const m = Number(month.slice(5, 7));
    const a = Number(s.startMonth.slice(5, 7));
    const b = Number(s.endMonth.slice(5, 7));
    return a <= b ? m >= a && m <= b : m >= a || m <= b;
  }
  if (s.startMonth && month < s.startMonth) return false;
  if (s.endMonth && month > s.endMonth) return false;
  return true;
}

/** Budgeted spending in a month (only lines active that month), optionally for one category. */
export function expenseInMonth(expenses: Expense[], month: YearMonth, category?: string): number {
  return expenses.filter((e) => (category === undefined || e.category === category) && isActive(e, month)).reduce((s, e) => s + e.monthly, 0);
}

/**
 * Expenses averaged over the next `n` months, one line per category: a 4-month
 * lease at $900 then $1,150 becomes the average monthly rent for the plan.
 */
export function averageExpenses(expenses: Expense[], from: YearMonth, n = 12): Expense[] {
  const cats = [...new Map(expenses.map((e) => [e.category, e])).values()];
  return cats
    .map((e) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += expenseInMonth(expenses, addMonths(from, i), e.category);
      return { id: `avg:${e.category}`, category: e.category, kind: e.kind, monthly: round2(sum / n) };
    })
    .filter((e) => e.monthly > 0);
}

/** Income for each of the next `n` months (for the timeline). */
export function incomeTimeline(streams: IncomeStream[], from: YearMonth, n = 12): { month: YearMonth; amount: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const month = addMonths(from, i);
    return { month, amount: round2(incomeInMonth(streams, month)) };
  });
}

/** Average monthly income over the next `n` months (smooths co-op/school terms). */
export function averageIncome(streams: IncomeStream[], from: YearMonth, n = 12): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += incomeInMonth(streams, addMonths(from, i));
  return sum / n;
}

export interface CashFlow {
  income: number;
  needs: number;
  wants: number;
  debtMinimums: number;
  available: number; // left for savings / extra debt payment
  savingsRatePct: number;
  /** 50/30/20 guideline in dollars, for comparison. */
  guideline: { needs: number; wants: number; savings: number };
}

export function cashFlow(income: number, expenses: Expense[], debts: Debt[]): CashFlow {
  const needs = expenses.filter((e) => e.kind === "need").reduce((a, e) => a + e.monthly, 0);
  const wants = expenses.filter((e) => e.kind === "want").reduce((a, e) => a + e.monthly, 0);
  const debtMinimums = debts.reduce((a, d) => a + Math.min(d.minPayment, d.balance), 0);
  const available = income - needs - wants - debtMinimums;
  return {
    income: round2(income),
    needs: round2(needs),
    wants: round2(wants),
    debtMinimums: round2(debtMinimums),
    available: round2(available),
    savingsRatePct: income > 0 ? round2((available / income) * 100) : 0,
    guideline: { needs: round2(income * 0.5), wants: round2(income * 0.3), savings: round2(income * 0.2) },
  };
}

/**
 * Which "want" categories to cut, largest first, to free `gap` dollars a month.
 * Suggests cutting each category by up to half (never to zero) before moving on.
 */
export function cutSuggestions(expenses: Expense[], gap: number): { category: string; cut: number }[] {
  if (gap <= 0) return [];
  const out: { category: string; cut: number }[] = [];
  let left = gap;
  for (const e of [...expenses].filter((x) => x.kind === "want").sort((a, b) => b.monthly - a.monthly)) {
    if (left <= 0) break;
    const cut = Math.min(left, e.monthly / 2);
    if (cut > 0) {
      out.push({ category: e.category, cut: round2(cut) });
      left -= cut;
    }
  }
  return out;
}

/** Emergency-fund months by income stability (1 unstable … 3 stable). */
export function emergencyMonths(stability: 1 | 2 | 3): number {
  return stability === 3 ? 3 : stability === 2 ? 4.5 : 6;
}

export function emergencyFundTarget(monthlyEssentials: number, stability: 1 | 2 | 3) {
  const months = emergencyMonths(stability);
  return {
    months,
    full: round2(monthlyEssentials * months),
    /** Starter fund: one month of essentials, at least $1,000. */
    starter: round2(Math.max(1000, monthlyEssentials)),
  };
}

/**
 * Required monthly contribution (end of month) to grow `current` to `target`
 * in `months` at `annualRealPct` (compounded monthly). With r = 0 it is a straight line.
 *   FV = PV(1+r)^n + PMT·((1+r)^n − 1)/r   ⇒   PMT = (FV − PV(1+r)^n)·r / ((1+r)^n − 1)
 */
export function requiredMonthly(target: number, current: number, months: number, annualRealPct: number): number {
  if (months <= 0) return Math.max(0, round2(target - current));
  const r = annualRealPct / 100 / 12;
  if (r === 0) return Math.max(0, round2((target - current) / months));
  const g = (1 + r) ** months;
  const pmt = ((target - current * g) * r) / (g - 1);
  return Math.max(0, round2(pmt));
}

export interface PayoffResult {
  strategy: "avalanche" | "snowball";
  months: number;
  totalInterest: number;
  order: string[]; // payoff order by debt name
  paidOffMonth: Record<string, number>;
}

/**
 * Month-by-month payoff: interest accrues (APR/12), minimums are paid on every
 * debt, and `extra` (plus freed-up minimums) goes to the target debt:
 * highest APR first (avalanche) or smallest balance first (snowball).
 */
export function payoff(debts: Debt[], extra: number, strategy: "avalanche" | "snowball", maxMonths = 600): PayoffResult {
  const ds = debts.map((d) => ({ ...d }));
  const budget = ds.reduce((a, d) => a + d.minPayment, 0) + extra;
  let interest = 0;
  let month = 0;
  const paidOffMonth: Record<string, number> = {};
  const order: string[] = [];
  const pick = () =>
    ds
      .filter((d) => d.balance > 0.005)
      .sort((a, b) => (strategy === "avalanche" ? b.aprPct - a.aprPct || a.balance - b.balance : a.balance - b.balance || b.aprPct - a.aprPct))[0];
  while (ds.some((d) => d.balance > 0.005) && month < maxMonths) {
    month++;
    for (const d of ds) {
      if (d.balance <= 0.005) continue;
      const i = (d.balance * d.aprPct) / 100 / 12;
      interest += i;
      d.balance += i;
    }
    let left = budget;
    for (const d of ds) {
      if (d.balance <= 0.005) continue;
      const pay = Math.min(d.minPayment, d.balance, left);
      d.balance -= pay;
      left -= pay;
    }
    for (let t = pick(); t && left > 0.005; t = pick()) {
      const pay = Math.min(t.balance, left);
      t.balance -= pay;
      left -= pay;
      if (t.balance > 0.005) break;
    }
    for (const d of ds) {
      if (d.balance <= 0.005 && paidOffMonth[d.name] === undefined) {
        d.balance = 0;
        paidOffMonth[d.name] = month;
        order.push(d.name);
      }
    }
  }
  return { strategy, months: month, totalInterest: round2(interest), order, paidOffMonth };
}

/** Risk score 1–10 from the questionnaire. */
export function riskScore(a: RiskAnswers): number {
  const horizon = a.horizonYears >= 15 ? 4 : a.horizonYears >= 8 ? 3 : a.horizonYears >= 4 ? 2 : 1;
  const raw = horizon + a.drawdownReaction + a.incomeStability + a.experience; // 4..14
  return Math.max(1, Math.min(10, Math.round(1 + ((raw - 4) / 10) * 9)));
}

/** Does an override contradict the answers? (more than 2 points riskier than the answers suggest) */
export function overrideWarning(a: RiskAnswers, override: number | null | undefined): string | null {
  if (override == null) return null;
  const s = riskScore(a);
  if (override - s > 2) {
    return `Your answers suggest a risk score of ${s}, but you chose ${override}. A ${override} portfolio can fall 30–40% in a bad year; your answer to a big drop suggests you might sell at the bottom, which locks in the loss.`;
  }
  if (s - override > 3) return `Your answers suggest ${s}; ${override} is much more conservative, which lowers expected growth on long-term goals.`;
  return null;
}

/** Long-horizon stock share for a risk score: 30% at 1 … 90% at 10. */
export function equityForRisk(score: number): number {
  return Math.min(0.9, 0.3 + (Math.max(1, Math.min(10, score)) - 1) * (0.6 / 9));
}

export type HorizonBand = "short" | "medium" | "long";
export const horizonBand = (years: number): HorizonBand => (years < 3 ? "short" : years < 7 ? "medium" : "long");

/**
 * Asset mix for money needed in `yearsLeft` years (glide path):
 *  - < 3 years: 100% cash/HISA/GIC. No stocks for money needed soon.
 *  - 3–7 years: conservative: stocks rise from 20% (at 3y) toward 40% (at 7y), capped by the risk score.
 *  - ≥ 7 years: the risk-score stock share; glides down from there as the date approaches.
 */
export function goalMix(yearsLeft: number, riskEquity: number): { equity: number; bonds: number; cash: number } {
  if (yearsLeft < 3) return { equity: 0, bonds: 0, cash: 1 };
  if (yearsLeft < 7) {
    const eq = Math.min(riskEquity, 0.2 + ((yearsLeft - 3) / 4) * 0.2);
    return { equity: round2(eq * 100) / 100, bonds: round2((1 - eq - 0.1) * 100) / 100, cash: 0.1 };
  }
  const eq = Math.min(riskEquity, 0.4 + (yearsLeft - 7) * 0.05);
  return { equity: round2(eq * 100) / 100, bonds: round2((1 - eq) * 100) / 100, cash: 0 };
}

export function inflate(realAmount: number, years: number, inflationPct: number): number {
  return realAmount * (1 + inflationPct / 100) ** years;
}

export function deflate(nominal: number, years: number, inflationPct: number): number {
  return nominal / (1 + inflationPct / 100) ** years;
}

/** Long-run cost of a fee: ending value lost vs. a fee-free version, as a %. */
export function feeDrag(annualReturnPct: number, feePct: number, years: number): number {
  const gross = (1 + annualReturnPct / 100) ** years;
  const net = (1 + (annualReturnPct - feePct) / 100) ** years;
  return round2((1 - net / gross) * 100);
}
