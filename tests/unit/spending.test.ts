import { describe, expect, it } from "vitest";
import { analyzeSpending, matchPlanCategory } from "@/lib/planner/spending";
import type { Expense } from "@/lib/planner/types";

const budget: Expense[] = [
  { id: "r", category: "Rent", monthly: 900, kind: "need" },
  { id: "g", category: "Groceries", monthly: 300, kind: "need" },
  { id: "d", category: "Dining out", monthly: 150, kind: "want" },
  { id: "f", category: "Fun", monthly: 120, kind: "want" },
];
const tx = (date: string, amount: number, category: string) => ({ date, amount, category });

describe("plan vs actual spending", () => {
  const txs = [
    // September (complete)
    tx("2026-09-03", -280, "Groceries"),
    tx("2026-09-10", -200, "Dining out"),
    tx("2026-09-20", -60, "Entertainment"), // → "Fun" via synonym
    tx("2026-09-25", -40, "Shopping"), // no budget line → unplanned
    // October (complete)
    tx("2026-10-02", -320, "Groceries"),
    tx("2026-10-12", -260, "Dining out"),
    tx("2026-10-15", 20, "Dining out"), // refund
    tx("2026-10-22", -100, "Entertainment"),
    tx("2026-10-30", 2000, "Income"), // not spending
    tx("2026-10-31", 500, "Transfers"), // card payment: not spending
    // November so far (current month, day 10)
    tx("2026-11-04", -90, "Dining out"),
  ];
  const a = analyzeSpending({ expenses: budget, txs, today: "2026-11-10" });
  const row = (c: string) => a.rows.find((r) => r.planCategory === c || r.actualCategories.includes(c))!;

  it("averages complete months only (hand-computed)", () => {
    expect(a.completeMonths).toEqual(["2026-09", "2026-10"]);
    // Groceries (280 + 320) / 2 = 300 → on track
    expect(row("Groceries")).toMatchObject({ actualAvg: 300, diff: 0, status: "on track", lastMonth: 320 });
    // Dining (200 + (260 − 20)) / 2 = 220 vs 150 → over by 70
    expect(row("Dining out")).toMatchObject({ actualAvg: 220, diff: 70, status: "over" });
    // Fun ← Entertainment (60 + 100) / 2 = 80 vs 120 → under
    expect(row("Fun")).toMatchObject({ actualCategories: ["Entertainment"], actualAvg: 80, status: "under" });
    // Shopping has no budget line: (40 + 0) / 2 = 20
    expect(row("Shopping")).toMatchObject({ planCategory: null, actualAvg: 20, status: "unplanned" });
  });

  it("current month: to date + pace, not mixed into the average", () => {
    // Dining: 90 in 10 of 30 days → pace 270
    expect(row("Dining out")).toMatchObject({ monthToDate: 90, pace: 270 });
  });

  it("flags budget lines with no transactions instead of assuming $0", () => {
    expect(row("Rent")).toMatchObject({ status: "no data", actualAvg: null });
    expect(a.warnings.join(" ")).toMatch(/No transactions for Rent/);
  });

  it("the actual-spending basis keeps planned amounts where there's no data", () => {
    // Rent 900 (no data) + Groceries 300 + Dining 220 + Fun 80 + Shopping (unbudgeted) 20 = 1,520 vs planned 1,470
    expect(a.actualBasisExpenses.map((e) => [e.category, e.monthly])).toEqual([
      ["Rent", 900],
      ["Groceries", 300],
      ["Dining out", 220],
      ["Fun", 80],
      ["Shopping (unbudgeted)", 20],
    ]);
    expect(a.totals).toMatchObject({ planned: 1470, actualAvg: 1520 });
  });

  it("matches by name, synonym, or the user's own mapping", () => {
    expect(matchPlanCategory("Transportation", ["Transport", "Food"])).toBe("Transport");
    expect(matchPlanCategory("Groceries", ["Food"])).toBe("Food");
    expect(matchPlanCategory("Shopping", ["Fun"], { Shopping: "Fun" })).toBe("Fun");
    expect(matchPlanCategory("Shopping", ["Shopping"], { Shopping: "" })).toBeNull(); // user said: ignore mapping
  });

  it("with no complete month yet, says so", () => {
    const b = analyzeSpending({ expenses: budget, txs: [tx("2026-11-04", -90, "Dining out")], today: "2026-11-10" });
    expect(b.totals.actualAvg).toBeNull();
    expect(b.warnings[0]).toMatch(/No complete month/);
  });
});

describe("partial first month", () => {
  it("leaves out a statement's partial first month (1 transaction vs ~10/month)", () => {
    const many = (m: string) => Array.from({ length: 10 }, (_, d) => ({ date: `${m}-${String(d + 1).padStart(2, "0")}`, amount: -10, category: "Dining out" }));
    const txs = [{ date: "2026-03-30", amount: -5, category: "Dining out" }, ...many("2026-04"), ...many("2026-05"), ...many("2026-06")];
    const a = analyzeSpending({ expenses: budget, txs, today: "2026-07-02" });
    expect(a.completeMonths).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(a.rows.find((r) => r.planCategory === "Dining out")!.actualAvg).toBe(100); // not (5 + 300)/4
    expect(a.warnings[0]).toMatch(/2026-03 left out/);
  });
});
