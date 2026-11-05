import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/planner/types";
import { budgetToExpenses, fillFrom, longTermGoals, newYearPlan, plannedMonths, progress, spreadAnnual, type MonthActual, type YearPlan } from "@/lib/planner/yearplan";

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
  // Income 3,000/month; budget Jan–Apr 1,050 (rent 650 + dining 400), May on 1,280; save 500 + invest 200 a month → goals 6,000 + 2,400 = 8,400
  const plan: YearPlan = { ...newYearPlan(profile, 2026, "2026-01-02"), save: Array.from({ length: 12 }, () => 500), invest: Array.from({ length: 12 }, () => 200) };
  const full = (month: string, income: number, spent: number, invested: number): MonthActual => ({ month, income, spent, invested, status: "full" });
  const actuals: MonthActual[] = [
    full("2026-01", 3000, 1000, 200), // spent 1,000 ≤ 1,050 → met
    { month: "2026-02", income: 100, spent: 20, invested: 0, status: "thin" }, // incomplete statement: unknown
    full("2026-03", 3000, 2600, 0), // 2,600 > 1,050 → missed
    full("2026-04", 3000, 1200, 200), // 1,200 > 1,050 → missed
    ...["05", "06", "07", "08", "09", "10"].map((m) => full(`2026-${m}`, 3000, 1200, 200)), // 1,200 ≤ 1,280 → met
    { month: "2026-11", income: 0, spent: 50, invested: 0, status: "current" },
  ];
  const r = progress(plan, profile, actuals, "2026-11-05");

  it("planned per month", () => {
    expect(plannedMonths(plan, profile)[4]).toEqual({ month: "2026-05", income: 3000, spending: 1280, save: 500, invest: 200, unassigned: 1020 });
  });

  it("a month met the plan when spending stayed within the budget (missing ≠ zero)", () => {
    expect(r.months.map((m) => m.status)).toEqual(["met", "no statement", "missed", "missed", "met", "met", "met", "met", "met", "met", "in progress", "upcoming"]);
    expect(r.months[1]!.actual).toBeNull();
    expect(r.missing).toEqual(["2026-02"]);
  });

  it("cash saved excludes money moved to investing", () => {
    expect(r.months[0]!.actual).toEqual({ income: 3000, spending: 1000, invested: 200, saved: 1800 });
  });

  it("to date, remaining, and a projection of what you'd really keep", () => {
    // Saved: 1,800 + 400 + 7 × 1,600 = 13,400; invested: 200 + 0 + 7 × 200 = 1,600
    expect(r.toDate).toMatchObject({ saved: 13_400, invested: 1600, plannedSave: 4500, plannedInvest: 1800 });
    // Nov + Dec: save goal already passed; invest 2,400 − 1,600 = 800 → 400/month
    expect(r.remaining).toMatchObject({ months: ["2026-11", "2026-12"], save: 0, invest: 800, perMonth: { save: 0, invest: 400, total: 400 } });
    // Projected = 15,000 kept so far + 2 × 3,000 income − 2 × 1,280 budget = 18,440 ≥ 8,400
    expect(r.remaining).toMatchObject({ projected: 18_440, shortfall: 0, cutSpendingPerMonth: 0 });
  });

  it("with income still expected from your statements, and a shortfall → spending cut", () => {
    const flat = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((m) => full(`2026-${m}`, 3000, 3000, 0));
    const b = progress(plan, profile, flat, "2026-11-05", { incomeAhead: 5000 });
    // Nothing kept so far; projected = 0 + 5,000 − 2,560 = 2,440; shortfall 8,400 − 2,440 = 5,960 → 2,980/month less spending in Nov and Dec
    expect(b.remaining).toMatchObject({ projected: 2440, shortfall: 5960, cutSpendingPerMonth: 2980 });
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

describe("no budget yet", () => {
  it("a month with no budget isn't judged over budget", () => {
    const empty: YearPlan = { ...newYearPlan({ ...profile, expenses: [] }, 2026, "2026-01-02") };
    const r = progress(empty, { ...profile, expenses: [] }, [{ month: "2026-01", income: 3000, spent: 1800, invested: 0, status: "full" }], "2026-11-05");
    expect(r.months[0]!.status).toBe("no budget");
  });
});
