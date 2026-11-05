import { describe, expect, it } from "vitest";
import { averageExpenses, expenseInMonth } from "@/lib/planner/core";
import { yearSummary } from "@/lib/planner/summary";
import type { Profile } from "@/lib/planner/types";

const profile: Profile = {
  country: "US", region: "NC", age: 21, crossBorder: false,
  incomes: [
    { id: "a", name: "Tampa", amount: 3000, frequency: "monthly", kind: "salary", startMonth: "2026-01", endMonth: "2026-04" },
    { id: "b", name: "IBM", amount: 5300, frequency: "monthly", kind: "coop", startMonth: "2026-09", endMonth: "2026-12" },
  ],
  expenses: [
    { id: "r1", category: "Rent", monthly: 900, kind: "need", startMonth: "2026-01", endMonth: "2026-04" },
    { id: "r2", category: "Rent", monthly: 1200, kind: "need", startMonth: "2026-05" },
    { id: "d", category: "Dining out", monthly: 150, kind: "want" },
  ],
  debts: [], accounts: [], goals: [], risk: { horizonYears: 10, drawdownReaction: 3, incomeStability: 2, experience: 1 }, sandboxPct: 10, highInterestAprPct: 8,
};

describe("date-ranged budget lines", () => {
  it("a lease change: $900 Jan–Apr, $1,200 from May", () => {
    expect(expenseInMonth(profile.expenses, "2026-03", "Rent")).toBe(900);
    expect(expenseInMonth(profile.expenses, "2026-06", "Rent")).toBe(1200);
    // From Jan: 4 × 900 + 8 × 1,200 = 13,200 / 12 = 1,100 average rent
    expect(averageExpenses(profile.expenses, "2026-01", 12).find((e) => e.category === "Rent")!.monthly).toBe(1100);
  });
});

describe("year summary", () => {
  const txs = [
    { date: "2026-09-05", description: "TAQUERIA", amount: -40, category: "Dining out" },
    { date: "2026-09-20", description: "SUSHI", amount: -160, category: "Dining out" },
    { date: "2026-10-04", description: "MR. TIRE", amount: -607.34, category: "Transportation" },
    { date: "2026-10-12", description: "NIKE", amount: -91.38, category: "Shopping" },
    { date: "2026-10-16", description: "MOBILE PAYMENT - THANK YOU", amount: 510.7, category: "Transfers" },
  ];
  const s = yearSummary({ profile, txs, year: 2026, today: "2026-11-05" });

  it("take-home for the whole year counts past jobs (hand-computed)", () => {
    // 4 × 3,000 + 4 × 5,300 = 33,200; through November: + Sep, Oct, Nov of IBM = 12,000 + 15,900 = 27,900
    expect(s.income).toMatchObject({ takeHomeYear: 33_200, takeHomeToDate: 27_900, throughMonth: "2026-11" });
  });

  it("spending from transactions, budget for the same months, saved over those months", () => {
    // Spent: 40 + 160 + 607.34 + 91.38 = 898.72 (the card payment is a transfer)
    // Budget for Sep + Oct: 2 × (1,200 + 150) = 2,700
    // Saved: (5,300 − 200) + (5,300 − 698.72) = 9,701.28
    expect(s.spending).toEqual({ actual: 898.72, monthsWithData: ["2026-09", "2026-10"], budgetSameMonths: 2700, noDataLines: ["Rent"] });
    expect(s.savedOverDataMonths).toBe(9701.28);
  });

  it("categories biggest first, with their largest purchases", () => {
    expect(s.categories.map((c) => [c.label, c.actual, c.budgeted])).toEqual([
      ["Transportation", 607.34, false],
      ["Dining out", 200, true],
      ["Shopping", 91.38, false],
    ]);
    expect(s.categories[1]!.top[0]).toEqual({ date: "2026-09-20", description: "SUSHI", amount: 160 });
    expect(s.categories[1]!.budget).toBe(300); // 2 months × 150
  });

  it("flags what needs attention", () => {
    const t = s.attention.map((a) => a.text).join(" | ");
    expect(t).toMatch(/Transportation: \$607 .*no budget line/);
    expect(t).toMatch(/Large one-off purchases: 2026-10-04 MR. TIRE \$607/);
    expect(t).toMatch(/No transactions for Rent/);
  });
});
