import { expenseInMonth, round2 } from "./core";
import { defaultKind } from "./categories";
import { netIncome } from "./net";
import type { AssetAccount, Debt, Expense, Goal, Profile, YearMonth } from "./types";

/**
 * The calendar-year plan: set at the start of the year (or when you start using
 * the app), kept as the ORIGINAL plan while statements fill in what actually
 * happened. One per year; previous years are kept.
 *
 *   budget  — per category, a Jan–Dec allocation (rent can change in May, a
 *             one-off goes in its month); the annual budget is the sum
 *   save    — planned cash saved per month (money that stays in the bank)
 *   invest  — planned investment contributions per month (Fidelity...)
 *   December goals = the sums of save and invest.
 */
export interface YearPlan {
  year: number;
  createdAt: string; // YYYY-MM-DD
  /** Balances and debts when the plan was started (carried from the previous year's real numbers). */
  opening: { asOf: string; accounts: AssetAccount[]; debts: Debt[] };
  budget: BudgetRow[];
  save: number[]; // 12
  invest: number[]; // 12
}

export interface BudgetRow {
  category: string;
  kind: "need" | "want";
  months: number[]; // 12, Jan..Dec
}

export const monthsOf = (year: number): YearMonth[] => Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}`);
export const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));
const zeros = () => Array.from({ length: 12 }, () => 0);

/** Split an annual amount evenly across 12 months (cents); the last month absorbs rounding so the total is exact. */
export function spreadAnnual(total: number): number[] {
  const each = Math.floor((total / 12) * 100) / 100;
  const out = Array.from({ length: 12 }, () => each);
  out[11] = round2(total - each * 11);
  return out;
}

/** Copy month k's amount into every later month (a rent change from May on). */
export function fillFrom(months: number[], k: number): number[] {
  return months.map((v, j) => (j > k ? months[k]! : v));
}

/**
 * A new plan for `year`: the budget and targets carry over from the previous
 * year's plan if there is one, otherwise from your budget lines; balances and
 * debts are today's real numbers.
 */
export function newYearPlan(p: Profile, year: number, today: string, previous?: YearPlan): YearPlan {
  const months = monthsOf(year);
  const budget: BudgetRow[] = previous
    ? previous.budget.map((r) => ({ ...r, months: [...r.months] }))
    : [...new Map(p.expenses.map((e) => [e.category, e.kind])).entries()].map(([category, kind]) => ({ category, kind, months: months.map((m) => round2(expenseInMonth(p.expenses, m, category))) }));
  return {
    year,
    createdAt: today,
    opening: { asOf: today, accounts: p.accounts.map((a) => ({ ...a })), debts: p.debts.map((d) => ({ ...d })) },
    budget,
    save: previous ? [...previous.save] : zeros(),
    invest: previous ? [...previous.invest] : zeros(),
  };
}

/** Budget lines for the rest of the app (spending analysis, plan engine), from every year's plan: equal neighbouring months merge into one line. */
export function budgetToExpenses(plans: Record<string, YearPlan>): Expense[] {
  const out: Expense[] = [];
  for (const plan of Object.values(plans).sort((a, b) => a.year - b.year)) {
    const ms = monthsOf(plan.year);
    for (const row of plan.budget) {
      let k = 0;
      while (k < 12) {
        const v = row.months[k] ?? 0;
        let j = k;
        while (j + 1 < 12 && (row.months[j + 1] ?? 0) === v) j++;
        if (v > 0) out.push({ id: `y${plan.year}:${row.category}:${k + 1}`, category: row.category, kind: row.kind, monthly: v, startMonth: ms[k]!, endMonth: ms[j]! });
        k = j + 1;
      }
    }
  }
  return out;
}

export function addBudgetRow(plan: YearPlan, category: string, monthly = 0): YearPlan {
  if (plan.budget.some((r) => r.category === category)) return plan;
  return { ...plan, budget: [...plan.budget, { category, kind: defaultKind(category), months: Array.from({ length: 12 }, () => monthly) }] };
}

/** Planned per month for the year: take-home from income lines, budget, save and invest targets, and what's left unassigned. */
export function plannedMonths(plan: YearPlan, p: Profile) {
  const income = netIncome(p, `${plan.year}-01`, 12).byMonth.map((m) => m.amount);
  return monthsOf(plan.year).map((month, k) => {
    const spending = round2(plan.budget.reduce((s, r) => s + (r.months[k] ?? 0), 0));
    const save = plan.save[k] ?? 0;
    const invest = plan.invest[k] ?? 0;
    return { month, income: income[k]!, spending, save, invest, unassigned: round2(income[k]! - spending - save - invest) };
  });
}

/** What statements show for a month (from the Analysis summary). */
export interface MonthActual {
  month: YearMonth;
  income: number | null;
  spent: number | null;
  invested: number | null; // net moved to investment accounts
  status: "full" | "thin" | "current" | "none";
}

export type MonthStatus = "met" | "missed" | "no statement" | "in progress" | "upcoming";

export interface Progress {
  year: number;
  months: {
    month: YearMonth;
    planned: { income: number; spending: number; save: number; invest: number };
    /** null when there's no complete statement for the month (never treated as zero). */
    actual: { income: number; spending: number; saved: number; invested: number } | null;
    status: MonthStatus;
  }[];
  goals: { save: number; invest: number; total: number }; // December goals
  /** Months with a complete statement: actual vs plan for exactly those months. */
  toDate: { months: YearMonth[]; plannedSave: number; plannedInvest: number; saved: number; invested: number; spending: number; plannedSpending: number };
  /** Past months with no (or an incomplete) statement: unknown, not zero. */
  missing: YearMonth[];
  /** From the month after the last complete statement through December. */
  remaining: {
    months: YearMonth[];
    save: number; // still to save by December
    invest: number;
    perMonth: { save: number; invest: number; total: number };
    projected: number; // saved + invested so far + the plan for the remaining months
    shortfall: number; // December goal − projected (0 if on track)
    cutSpendingPerMonth: number; // spend this much less per remaining month to close the shortfall
  };
}

/**
 * Plan vs statements. Cash saved = income − spending − invested, so money moved
 * to investing isn't counted twice. A month "met" the plan when cash saved +
 * invested ≥ its save + invest targets.
 */
export function progress(plan: YearPlan, p: Profile, actuals: MonthActual[], today: string): Progress {
  const current = today.slice(0, 7);
  const planned = plannedMonths(plan, p);
  const byMonth = new Map(actuals.map((a) => [a.month, a]));
  const months = planned.map((pl) => {
    const a = byMonth.get(pl.month);
    const complete = a?.status === "full" && a.income !== null && a.spent !== null;
    const actual = complete ? { income: a!.income!, spending: a!.spent!, invested: round2(a!.invested ?? 0), saved: round2(a!.income! - a!.spent! - (a!.invested ?? 0)) } : null;
    const target = pl.save + pl.invest;
    const status: MonthStatus = actual
      ? actual.saved + actual.invested >= target - 1
        ? "met"
        : "missed"
      : pl.month < current
        ? "no statement"
        : pl.month === current
          ? "in progress"
          : "upcoming";
    return { month: pl.month, planned: { income: pl.income, spending: pl.spending, save: pl.save, invest: pl.invest }, actual, status };
  });

  const done = months.filter((m) => m.actual);
  const lastDone = done.at(-1)?.month ?? null;
  const goals = { save: sum(plan.save), invest: sum(plan.invest), total: round2(sum(plan.save) + sum(plan.invest)) };
  const saved = sum(done.map((m) => m.actual!.saved));
  const invested = sum(done.map((m) => m.actual!.invested));
  // Still ahead: after the last complete statement, excluding past months with no statement (unknown, not zero).
  const rest = months.filter((m) => !m.actual && m.status !== "no statement" && (!lastDone || m.month > lastDone));
  const n = Math.max(1, rest.length);
  const remSave = round2(goals.save - saved);
  const remInvest = round2(goals.invest - invested);
  const projected = round2(saved + invested + sum(rest.map((m) => m.planned.save + m.planned.invest)));
  const shortfall = round2(Math.max(0, goals.total - projected));
  return {
    year: plan.year,
    months,
    goals,
    toDate: {
      months: done.map((m) => m.month),
      plannedSave: sum(done.map((m) => m.planned.save)),
      plannedInvest: sum(done.map((m) => m.planned.invest)),
      saved,
      invested,
      spending: sum(done.map((m) => m.actual!.spending)),
      plannedSpending: sum(done.map((m) => m.planned.spending)),
    },
    missing: months.filter((m) => m.status === "no statement").map((m) => m.month),
    remaining: {
      months: rest.map((m) => m.month),
      save: Math.max(0, remSave),
      invest: Math.max(0, remInvest),
      perMonth: { save: round2(Math.max(0, remSave) / n), invest: round2(Math.max(0, remInvest) / n), total: round2((Math.max(0, remSave) + Math.max(0, remInvest)) / n) },
      projected,
      shortfall,
      cutSpendingPerMonth: round2(shortfall / n),
    },
  };
}

/** Long-term goals (kept across years): current value, target, projected at the current pace, gap, pace needed. */
export interface LongTermGoal {
  goal: Goal;
  current: number;
  target: number;
  by: YearMonth;
  monthsLeft: number;
  pacePerMonth: number; // what this year's plan puts aside per month (save + invest), or the goal's own share
  projected: number;
  gap: number; // target − projected (0 if on track)
  neededPerMonth: number; // to reach the target from today
}

export function longTermGoals(p: Profile, plan: YearPlan | null, netWorth: number, today: string): LongTermGoal[] {
  const now = today.slice(0, 7);
  const planPace = plan ? round2((sum(plan.save) + sum(plan.invest)) / 12) : 0;
  return p.goals
    .filter((g) => g.kind === "net_worth" || g.kind === "retirement" || g.kind === "long_term" || g.kind === "house")
    .map((g) => {
      const monthsLeft = Math.max(1, (Number(g.targetDate.slice(0, 4)) - Number(now.slice(0, 4))) * 12 + (Number(g.targetDate.slice(5, 7)) - Number(now.slice(5, 7))));
      const current = g.kind === "net_worth" ? netWorth : g.current;
      const pace = g.kind === "net_worth" ? planPace : (g.monthlyContribution ?? 0);
      const projected = round2(current + pace * monthsLeft);
      return {
        goal: g,
        current: round2(current),
        target: g.target,
        by: g.targetDate,
        monthsLeft,
        pacePerMonth: pace,
        projected,
        gap: round2(Math.max(0, g.target - projected)),
        neededPerMonth: round2(Math.max(0, g.target - current) / monthsLeft),
      };
    });
}
