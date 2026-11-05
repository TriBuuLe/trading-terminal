import { describe, expect, it } from "vitest";
import { proposeWants } from "@/lib/planner/propose";
import type { BudgetRow } from "@/lib/planner/yearplan";

const row = (category: string, kind: "need" | "want", monthly: number): BudgetRow => ({ category, kind, months: Array.from({ length: 12 }, () => monthly) });
const budget = [row("Rent", "need", 880), row("Groceries", "need", 300), row("Dining out", "want", 400), row("Shopping", "want", 50), row("Subscriptions", "want", 100)];
// Statement averages per month: dining 502, shopping 449, subscriptions 316 → 6,024 + 5,388 + 3,792 = 15,204 a year now
const avg = (c: string) => ({ "Dining out": 502, Shopping: 449, Subscriptions: 316 })[c] ?? null;

describe("proposed budget for wants", () => {
  it("take-home − needs − debt − savings target, capped at 30% of take-home, split by current spending", () => {
    // Income 60,000: needs 14,160; savings target 20% = 12,000; available 60,000 − 14,160 − 0 − 12,000 = 33,840
    // 30% cap = 18,000; current spending 15,204 is lower → wants total 15,204 (limited by current spending)
    const r = proposeWants({ budget, income: 60_000, debtMinimumsYear: 0, goalsNeedYear: 0, statementAvg: avg });
    expect(r).toMatchObject({ needs: 14_160, savingsTarget: 12_000, savingsTargetSource: "20% of take-home", available: 33_840, baseline: 15_204, total: 15_204, limitedBy: "current spending", freed: 0 });
  });

  it("when money is tight, wants shrink to what's available (never below half of what you spend now)", () => {
    // Income 40,000: needs 14,160, debt 1,200, target 8,000 → available 16,640 → over 30% cap 12,000 → 12,000
    const r = proposeWants({ budget, income: 40_000, debtMinimumsYear: 1200, goalsNeedYear: 0, statementAvg: avg });
    expect(r).toMatchObject({ available: 16_640, total: 12_000, limitedBy: "30% of take-home" });
    // Split by current spending: dining 6,024 / 15,204 × 12,000 = 4,754.54 → 4,755; shopping 4,252.56 → 4,253; subscriptions 2,992.90 → 2,993
    expect(r.rows.map((x) => [x.category, x.baseline, x.baselineSource, x.proposed])).toEqual([
      ["Dining out", 6024, "statements", 4755],
      ["Shopping", 5388, "statements", 4253],
      ["Subscriptions", 3792, "statements", 2993],
    ]);
    expect(r.freed).toBe(3203); // 15,204 − 12,001 (rounded per category)

    // Goals that need more than 20%: target 25,000 → available 40,000 − 14,160 − 1,200 − 25,000 < 0 → floor: half of 15,204
    const tight = proposeWants({ budget, income: 40_000, debtMinimumsYear: 1200, goalsNeedYear: 25_000, statementAvg: avg });
    expect(tight).toMatchObject({ savingsTargetSource: "long-term goals", total: 7602, limitedBy: "half of current spending" });
  });

  it("uses the current budget where there are no statements", () => {
    const r = proposeWants({ budget, income: 60_000, debtMinimumsYear: 0, goalsNeedYear: 0, statementAvg: () => null });
    expect(r.rows[0]).toMatchObject({ category: "Dining out", baseline: 4800, baselineSource: "budget" });
  });
});
