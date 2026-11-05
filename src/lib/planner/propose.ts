import { round2 } from "./core";
import type { BudgetRow } from "./yearplan";

/**
 * A proposed annual budget for the "want" categories (nice to have), so as much
 * as possible goes to saving and investing. Needs are yours to set.
 *
 *   savings target = max(20% of take-home, what long-term goals need this year)
 *   available      = take-home − needs − debt minimums − savings target
 *   wants total    = available, but at most 30% of take-home (50/30/20) and at
 *                    most what you spend now, and at least half of what you
 *                    spend now (so the plan is livable)
 *   per category   = wants total split by your current spending (statement
 *                    average × 12, or the current budget where there's no data)
 */
export interface WantProposal {
  income: number;
  needs: number;
  debt: number;
  savingsTarget: number;
  savingsTargetSource: "20% of take-home" | "long-term goals";
  available: number;
  baseline: number; // what wants cost now (per year)
  total: number; // proposed wants total (per year)
  limitedBy: "available" | "30% of take-home" | "current spending" | "half of current spending";
  rows: { category: string; baseline: number; baselineSource: "statements" | "budget"; proposed: number }[];
  freed: number; // baseline − total: more for saving / investing per year
}

export function proposeWants(i: {
  budget: BudgetRow[];
  income: number; // planned take-home for the year
  debtMinimumsYear: number;
  goalsNeedYear: number; // long-term goals' needed per month × 12
  statementAvg: (category: string) => number | null; // average per full month from statements
}): WantProposal {
  const sumRow = (r: BudgetRow) => r.months.reduce((s, x) => s + x, 0);
  const needs = round2(i.budget.filter((r) => r.kind === "need").reduce((s, r) => s + sumRow(r), 0));
  const wants = i.budget.filter((r) => r.kind === "want");
  const base = wants.map((r) => {
    const a = i.statementAvg(r.category);
    return a !== null ? { category: r.category, baseline: round2(a * 12), baselineSource: "statements" as const } : { category: r.category, baseline: round2(sumRow(r)), baselineSource: "budget" as const };
  });
  const baseline = round2(base.reduce((s, r) => s + r.baseline, 0));
  const twenty = i.income * 0.2;
  const savingsTarget = round2(Math.max(twenty, i.goalsNeedYear));
  const available = round2(i.income - needs - i.debtMinimumsYear - savingsTarget);
  const cap30 = i.income * 0.3;
  const floor = baseline * 0.5;
  let total = Math.max(0, available);
  let limitedBy: WantProposal["limitedBy"] = "available";
  if (total > cap30) [total, limitedBy] = [cap30, "30% of take-home"];
  if (total > baseline) [total, limitedBy] = [baseline, "current spending"];
  if (total < floor) [total, limitedBy] = [floor, "half of current spending"];
  total = round2(total);
  const rows = base.map((r) => ({ ...r, proposed: baseline > 0 ? Math.round((r.baseline / baseline) * total) : 0 }));
  return {
    income: round2(i.income),
    needs,
    debt: round2(i.debtMinimumsYear),
    savingsTarget,
    savingsTargetSource: i.goalsNeedYear > twenty ? "long-term goals" : "20% of take-home",
    available,
    baseline,
    total,
    limitedBy,
    rows,
    freed: round2(baseline - rows.reduce((s, r) => s + r.proposed, 0)),
  };
}
