import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/planner/types";
import { budgetToExpenses, expectedIncome, fillFrom, longTermGoals, newYearPlan, plannedMonths, progress, spreadAnnual, type MonthActual, type YearPlan } from "@/lib/planner/yearplan";

const profile: Profile = {
  country: "US", region: "NC", age: 21, crossBorder: false,
  incomes: [{ id: "a", name: "Job", amount: 3000, frequency: "monthly", kind: "salary", basis: "net" }],
  expenses: [
    { id: "r1", category: "Rent", monthly: 650, kind: "need", startMonth: "2026-01", endMonth: "2026-04" },
    { id: "r2", category: "Rent", monthly: 880, kind: "need", startMonth: "2026-05", endMonth: null },
    { id: "d", category: "Dining out", monthly: 400, kind: "want" },
  ],
  debts: [], accounts: [{ id: "c", name: "Chequing", type: "CASH", balance: 3094.33 }],
  goals: [{ id: "nw", name: "Net worth $50k", kind: "net_worth", target: 50_000, targetDate: "2028-12", priority: 1, current: 0 }],
  risk: { horizonYears: 10, drawdownReaction: 3, incomeStability: 2, experience: 1 }, sandboxPct: 10, highInterestAprPct: 8,
};

describe("yearly budget", () => {
  it("annual total ↔ months: $860/month rent is a $10,320 annual budget; uneven totals keep the exact sum", () => {
    expect(spreadAnnual(10_320)).toEqual(Array.from({ length: 12 }, () => 860));
    const odd = spreadAnnual(1000); // 83.33 × 11 + 83.37
    expect(odd[0]).toBe(83.33);
    expect(odd[11]).toBe(83.37);
    expect(odd.reduce((s, x) => s + x, 0)).toBeCloseTo(1000, 6);
  });

  it("a rent change from May on", () => {
    const months = [650, 650, 650, 650, 880, 0, 0, 0, 0, 0, 0, 0];
    expect(fillFrom(months, 4)).toEqual([650, 650, 650, 650, 880, 880, 880, 880, 880, 880, 880, 880]);
  });

  it("a new plan starts from your budget lines; back to lines for the rest of the app", () => {
    const plan = newYearPlan(profile, 2026, "2026-11-05");
    expect(plan.budget.find((r) => r.category === "Rent")!.months).toEqual([650, 650, 650, 650, 880, 880, 880, 880, 880, 880, 880, 880]);
    expect(plan.opening).toEqual({ asOf: "2026-11-05", accounts: profile.accounts, debts: [] });
    expect(budgetToExpenses({ "2026": plan }).filter((e) => e.category === "Rent")).toEqual([
      { id: "y2026:Rent:1", category: "Rent", kind: "need", monthly: 650, startMonth: "2026-01", endMonth: "2026-04" },
      { id: "y2026:Rent:5", category: "Rent", kind: "need", monthly: 880, startMonth: "2026-05", endMonth: "2026-12" },
    ]);
  });

  it("next January copies last year's budget and targets; last year's plan is untouched", () => {
    const y26: YearPlan = { ...newYearPlan(profile, 2026, "2026-01-02"), save: Array.from({ length: 12 }, () => 500), invest: Array.from({ length: 12 }, () => 200) };
    const y27 = newYearPlan({ ...profile, accounts: [{ id: "c", name: "Chequing", type: "CASH", balance: 9000 }] }, 2027, "2027-01-03", y26);
    expect(y27.year).toBe(2027);
    expect(y27.budget).toEqual(y26.budget);
    expect(y27.budget).not.toBe(y26.budget);
    expect(y27.opening.accounts[0]!.balance).toBe(9000); // real balance carried forward
    y27.budget[0]!.months[0] = 1;
    expect(y26.budget[0]!.months[0]).toBe(650);
  });
});

describe("plan vs statements", () => {
  // Income 3,000/month; budget Jan–Apr 1,050, May on 1,280; save 500 + invest 200 every month → December goals 6,000 + 2,400 = 8,400
  const plan: YearPlan = { ...newYearPlan(profile, 2026, "2026-01-02"), save: Array.from({ length: 12 }, () => 500), invest: Array.from({ length: 12 }, () => 200) };
  const full = (month: string, income: number, spent: number, invested: number): MonthActual => ({ month, income, spent, invested, status: "full" });
  const actuals: MonthActual[] = [
    full("2026-01", 3000, 1500, 200), // saved 1,300 + 200 → met
    { month: "2026-02", income: 100, spent: 20, invested: 0, status: "thin" }, // incomplete statement: unknown
    full("2026-03", 3000, 2600, 0), // saved 400 + 0 < 700 → missed
    ...["04", "05", "06", "07", "08", "09", "10"].map((m) => full(`2026-${m}`, 3000, 2100, 200)), // 700 + 200 = 900 → met
    { month: "2026-11", income: 0, spent: 50, invested: 0, status: "current" },
  ];
  const r = progress(plan, profile, actuals, "2026-11-05");

  it("planned per month", () => {
    expect(plannedMonths(plan, profile)[4]).toEqual({ month: "2026-05", income: 3000, spending: 1280, save: 500, invest: 200, unassigned: 1020 });
  });

  it("each month: met / missed / no statement / in progress / upcoming (missing ≠ zero)", () => {
    expect(r.months.map((m) => m.status)).toEqual(["met", "no statement", "missed", "met", "met", "met", "met", "met", "met", "met", "in progress", "upcoming"]);
    expect(r.months[1]!.actual).toBeNull();
    expect(r.missing).toEqual(["2026-02"]);
  });

  it("cash saved excludes money moved to investing", () => {
    expect(r.months[0]!.actual).toEqual({ income: 3000, spending: 1500, invested: 200, saved: 1300 });
  });

  it("to date, remaining through December, shortfall, spending cut", () => {
    // Saved: 1,300 + 400 + 7 × 700 = 6,600; invested: 200 + 0 + 7 × 200 = 1,600 (9 complete months)
    expect(r.toDate).toMatchObject({ saved: 6600, invested: 1600, plannedSave: 4500, plannedInvest: 1800 });
    // Remaining months: Nov, Dec. Save goal 6,000 already passed → 0 left; invest 2,400 − 1,600 = 800 → 400/month
    expect(r.remaining).toMatchObject({ months: ["2026-11", "2026-12"], save: 0, invest: 800, perMonth: { save: 0, invest: 400, total: 400 } });
    // Projected: 8,200 so far + 2 × 700 planned = 9,600 ≥ 8,400 → no shortfall
    expect(r.remaining).toMatchObject({ projected: 9600, shortfall: 0, cutSpendingPerMonth: 0 });
  });

  it("a shortfall turns into a monthly spending cut", () => {
    const behind = progress(plan, profile, [full("2026-01", 3000, 3000, 0), ...["02", "03", "04", "05", "06", "07", "08", "09", "10"].map((m) => full(`2026-${m}`, 3000, 3000, 0))], "2026-11-05");
    // Nothing saved in 10 months; projected = 2 × 700 = 1,400; shortfall 8,400 − 1,400 = 7,000 → 3,500/month less spending in Nov and Dec
    expect(behind.remaining).toMatchObject({ projected: 1400, shortfall: 7000, cutSpendingPerMonth: 3500 });
  });
});

describe("long-term goals", () => {
  it("net worth: current, target, projected at this year's pace, gap, needed per month", () => {
    const plan: YearPlan = { ...newYearPlan(profile, 2026, "2026-01-02"), save: Array.from({ length: 12 }, () => 500), invest: Array.from({ length: 12 }, () => 200) };
    const [g] = longTermGoals(profile, plan, 3094.33, "2026-11-05");
    // Nov 2026 → Dec 2028 = 25 months; pace 700/month → 3,094.33 + 17,500 = 20,594.33; gap 29,405.67; needed (50,000 − 3,094.33) / 25 = 1,876.23
    expect(g).toMatchObject({ current: 3094.33, target: 50_000, monthsLeft: 25, pacePerMonth: 700, projected: 20_594.33, gap: 29_405.67, neededPerMonth: 1876.23 });
  });
});

describe("expected take-home for the year", () => {
  it("statements for complete months, income lines for the rest (missing statements use the plan)", () => {
    // Lines: 3,000/month. Statements: Jan 3,200 (full), Feb thin (plan), Mar 2,900 (full), Nov running (plan)
    const r = expectedIncome(2026, profile, [
      { month: "2026-01", income: 3200, spent: 1000, invested: 0, status: "full" },
      { month: "2026-02", income: 100, spent: 10, invested: 0, status: "thin" },
      { month: "2026-03", income: 2900, spent: 1000, invested: 0, status: "full" },
      { month: "2026-11", income: 500, spent: 100, invested: 0, status: "current" },
    ]);
    expect(r.statementMonths).toEqual(["2026-01", "2026-03"]);
    expect(r.months[1]).toEqual({ month: "2026-02", amount: 3000, source: "plan" });
    // received 6,100 + 10 months × 3,000 = 36,100
    expect(r).toMatchObject({ received: 6100, expected: 30000, total: 36100 });
  });
});
