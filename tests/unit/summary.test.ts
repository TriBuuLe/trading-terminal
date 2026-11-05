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

describe("year summary (from transactions)", () => {
  const txs = [
    { date: "2026-09-05", description: "TAQUERIA", amount: -40, category: "Dining out" },
    { date: "2026-09-20", description: "SUSHI", amount: -160, category: "Dining out" },
    { date: "2026-09-26", description: "ACME 3141 DES:PAYROLL ID:1000200669", amount: 2000, category: "Income" },
    { date: "2026-09-28", description: "Zelle payment from ALEX KIM", amount: 30, category: "Income" },
    { date: "2026-10-04", description: "MR. TIRE", amount: -607.34, category: "Transportation" },
    { date: "2026-10-10", description: "ACME 3141 DES:PAYROLL ID:1000353517", amount: 2000, category: "Income" },
    { date: "2026-10-12", description: "NIKE", amount: -91.38, category: "Shopping" },
    { date: "2026-10-16", description: "MOBILE PAYMENT - THANK YOU", amount: 510.7, category: "Transfers" },
    { date: "2026-10-20", description: "WIRE OUT TUITION", amount: -3000, category: "Education" },
    { date: "2026-11-02", description: "SUSHI", amount: -50, category: "Dining out" },
  ];
  const s = yearSummary({ profile, txs, year: 2026, today: "2026-11-05" });

  it("money in comes from transactions, split by source; income lines are the comparison", () => {
    // 2,000 + 30 + 2,000 = 4,030; paychecks 4,000; income lines for Sep–Nov (months with data): 3 × 5,300 = 15,900
    expect(s.income).toMatchObject({ actual: 4030, paychecks: 4000, plannedYear: 33_200, plannedSameMonths: 15_900 });
    expect(s.income.sources.map((x) => [x.label, x.kind, x.total, x.count])).toEqual([
      ["ACME", "paycheck", 4000, 2],
      ["From people (Zelle etc.)", "people", 30, 1],
    ]);
  });

  it("spending excludes card payments; averages use full months only (not the current one)", () => {
    // 40 + 160 + 607.34 + 91.38 + 3,000 + 50 = 3,948.72; full months Sep + Oct: (200 + 3,698.72) / 2 = 1,949.36
    expect(s.fullMonths).toEqual(["2026-09", "2026-10"]);
    expect(s.spending).toEqual({ actual: 3948.72, avgPerMonth: 1949.36, budgetPerMonth: 1350 });
    // saved 4,030 − 3,948.72 = 81.28; rate 81.28 / 4,030 = 2.02%
    expect(s.saved).toEqual({ actual: 81.28, ratePct: 2.02 });
    expect(s.months.find((m) => m.month === "2026-11")!.status).toBe("current");
  });

  it("every category is its own row (Education is not mapped into anything)", () => {
    expect(s.categories.map((c) => [c.category, c.total, c.status])).toEqual([
      ["Education", 3000, "no budget"],
      ["Transportation", 607.34, "no budget"],
      ["Dining out", 250, "under"], // avg (200 + 0) / 2 = 100 vs 150
      ["Shopping", 91.38, "no budget"],
      ["Rent", 0, "no transactions"],
    ]);
    expect(s.categories[2]).toMatchObject({ avgPerMonth: 100, budgetPerMonth: 150, diffPerMonth: -50, lastMonth: 0 });
  });

  it("flags what needs attention and gaps in the data", () => {
    const t = s.attention.map((a) => a.text).join(" | ");
    expect(t).toMatch(/Education: \$3,000 this year \(~\$1,500\/month\) with no budget line/);
    expect(t).toMatch(/Large one-offs: 2026-10-20 Education \$3,000; 2026-10-04 Transportation \$607/);
    expect(s.dataChecks.join(" ")).toMatch(/Budgeted but no transactions: Rent/);
  });

  it("a month with far fewer transactions than usual is flagged and left out of averages", () => {
    const many = (m: string, k: number) => Array.from({ length: k }, (_, j) => ({ date: `2026-${m}-${String(j + 1).padStart(2, "0")}`, description: "SUSHI", amount: -10, category: "Dining out" }));
    const t = yearSummary({ profile, txs: [...many("06", 20), ...many("07", 2), ...many("08", 20)], year: 2026, today: "2026-11-05" });
    expect(t.fullMonths).toEqual(["2026-06", "2026-08"]);
    expect(t.dataChecks[0]).toMatch(/2026-07: only 2 transaction/);
  });
});
