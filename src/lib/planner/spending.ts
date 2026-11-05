import { round2 } from "./core";
import type { Expense, YearMonth } from "./types";

/**
 * Planned budget vs actual spending from imported transactions.
 * - Spending = money out (negative amounts) in non-income, non-transfer
 *   categories; refunds (positive amounts in a spending category) reduce it.
 * - Averages use COMPLETE months only; the current month is shown to date and
 *   as a pace projection, never mixed into the average.
 * - Transaction categories map onto budget lines by name, built-in synonyms,
 *   or the user's own mapping.
 */
export interface Tx {
  date: string; // YYYY-MM-DD
  amount: number;
  category: string;
}

export type CategoryStatus = "over" | "under" | "on track" | "no data" | "unplanned";

export interface CategoryRow {
  /** Budget line this maps to (null = spending with no budget line). */
  planCategory: string | null;
  /** Transaction categories counted here. */
  actualCategories: string[];
  /** Of those, the ones mapped by the user (can be reset). */
  manualCategories: string[];
  kind: "need" | "want";
  planned: number;
  actualAvg: number | null; // per complete month
  lastMonth: number | null;
  monthToDate: number;
  pace: number | null; // projected for the current month
  diff: number | null; // actualAvg − planned
  status: CategoryStatus;
}

export interface SpendingAnalysis {
  completeMonths: YearMonth[];
  currentMonth: YearMonth;
  daysElapsed: number;
  daysInMonth: number;
  rows: CategoryRow[];
  totals: { planned: number; actualAvg: number | null; monthToDate: number; pace: number | null };
  /** Budget lines with actual averages swapped in where there's data (for "plan with actual spending"). */
  actualBasisExpenses: Expense[];
  warnings: string[];
}

const EXCLUDED = new Set(["income", "transfers"]);
const norm = (s: string) => s.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/** Common equivalences between transaction categories and how people name budget lines. */
const SYNONYMS: Record<string, string[]> = {
  "dining out": ["dining", "restaurants", "eating out", "food out", "takeout", "coffee"],
  entertainment: ["fun", "movies", "going out", "leisure", "hobbies"],
  transportation: ["transport", "transit", "gas", "car", "commute"],
  "phone and internet": ["phone", "internet", "mobile", "cell phone"],
  subscriptions: ["subscription", "streaming", "apps", "software"],
  shopping: ["clothes", "clothing", "stuff", "misc shopping"],
  groceries: ["food", "grocery"],
  health: ["medical", "pharmacy", "health and fitness"],
  rent: ["housing", "rent and housing", "mortgage"],
};

export function matchPlanCategory(actual: string, plan: string[], userMap: Record<string, string> = {}): string | null {
  if (userMap[actual] !== undefined) return userMap[actual] === "" ? null : userMap[actual]!;
  const a = norm(actual);
  const exact = plan.find((p) => norm(p) === a);
  if (exact) return exact;
  const syn = SYNONYMS[a] ?? [];
  return plan.find((p) => syn.includes(norm(p))) ?? plan.find((p) => (SYNONYMS[norm(p)] ?? []).includes(a)) ?? null;
}

function daysIn(month: YearMonth): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function analyzeSpending(i: {
  expenses: Expense[];
  txs: Tx[];
  today: string; // YYYY-MM-DD
  categoryMap?: Record<string, string>;
}): SpendingAnalysis {
  const currentMonth = i.today.slice(0, 7);
  const daysElapsed = Number(i.today.slice(8, 10));
  const dim = daysIn(currentMonth);
  const planNames = i.expenses.map((e) => e.category);
  const spendTx = i.txs.filter((t) => !EXCLUDED.has(norm(t.category)));

  // spending per (month, actual category): money out positive, refunds negative
  const per = new Map<string, Map<string, number>>();
  for (const t of spendTx) {
    const m = t.date.slice(0, 7);
    if (m > currentMonth) continue;
    const byCat = per.get(m) ?? new Map<string, number>();
    byCat.set(t.category, (byCat.get(t.category) ?? 0) - t.amount);
    per.set(m, byCat);
  }
  // Complete months, minus a partial first month: a statement that starts on the
  // 28th leaves that month with a handful of transactions, which would drag every
  // average down. Drop the earliest month if it has < 25% of the median count.
  const counts = new Map<string, number>();
  for (const t of spendTx) counts.set(t.date.slice(0, 7), (counts.get(t.date.slice(0, 7)) ?? 0) + 1);
  let completeMonths = [...per.keys()].filter((m) => m < currentMonth).sort();
  const excludedMonths: string[] = [];
  if (completeMonths.length >= 3) {
    const sorted = completeMonths.map((m) => counts.get(m) ?? 0).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const first = completeMonths[0]!;
    if ((counts.get(first) ?? 0) < median * 0.25) {
      excludedMonths.push(first);
      completeMonths = completeMonths.slice(1);
    }
  }
  const lastComplete = completeMonths.at(-1) ?? null;
  const actualCats = [...new Set(spendTx.map((t) => t.category))];

  // group actual categories under budget lines
  const groups = new Map<string | null, string[]>();
  const unplanned: string[] = [];
  for (const c of actualCats) {
    const p = matchPlanCategory(c, planNames, i.categoryMap);
    if (p === null) unplanned.push(c);
    else groups.set(p, [...(groups.get(p) ?? []), c]);
  }
  const sumFor = (month: string, cats: string[]) => cats.reduce((s, c) => s + (per.get(month)?.get(c) ?? 0), 0);
  const avgFor = (cats: string[]) => (completeMonths.length ? completeMonths.reduce((s, m) => s + sumFor(m, cats), 0) / completeMonths.length : null);
  const pace = (mtd: number) => (daysElapsed > 0 ? (mtd / daysElapsed) * dim : null);
  const status = (planned: number, avg: number | null): CategoryStatus => {
    if (avg === null) return "no data";
    const tol = Math.max(10, planned * 0.1); // within 10% (or $10) counts as on track
    return avg > planned + tol ? "over" : avg < planned - tol ? "under" : "on track";
  };

  const rows: CategoryRow[] = i.expenses.map((e) => {
    const cats = groups.get(e.category) ?? [];
    const avg = cats.length ? avgFor(cats) : null;
    const mtd = cats.length ? sumFor(currentMonth, cats) : 0;
    return {
      planCategory: e.category,
      actualCategories: cats,
      manualCategories: cats.filter((c) => i.categoryMap?.[c] !== undefined),
      kind: e.kind,
      planned: e.monthly,
      actualAvg: avg === null ? null : round2(avg),
      lastMonth: cats.length && lastComplete ? round2(sumFor(lastComplete, cats)) : null,
      monthToDate: round2(mtd),
      pace: cats.length && pace(mtd) !== null ? round2(pace(mtd)!) : null,
      diff: avg === null ? null : round2(avg - e.monthly),
      status: cats.length ? status(e.monthly, avg) : "no data",
    };
  });
  for (const c of unplanned) {
    const avg = avgFor([c]);
    const mtd = sumFor(currentMonth, [c]);
    rows.push({
      planCategory: null,
      actualCategories: [c],
      manualCategories: i.categoryMap?.[c] !== undefined ? [c] : [],
      kind: "want",
      planned: 0,
      actualAvg: avg === null ? null : round2(avg),
      lastMonth: lastComplete ? round2(sumFor(lastComplete, [c])) : null,
      monthToDate: round2(mtd),
      pace: pace(mtd) === null ? null : round2(pace(mtd)!),
      diff: avg === null ? null : round2(avg),
      status: "unplanned",
    });
  }

  const warnings: string[] = [];
  for (const m of excludedMonths)
    warnings.push(`${m} left out of the averages: only ${counts.get(m)} transaction${counts.get(m) === 1 ? "" : "s"}, so the statement probably starts partway through that month.`);
  if (!completeMonths.length) warnings.push(`No complete month of transactions yet: averages start once ${currentMonth} ends (or import an earlier month).`);
  const silentNeeds = rows.filter((r) => r.planCategory && r.kind === "need" && r.planned > 0 && r.actualCategories.length === 0);
  if (silentNeeds.length && completeMonths.length)
    warnings.push(
      `No transactions for ${silentNeeds.map((r) => r.planCategory).join(", ")}. If you pay ${silentNeeds.length > 1 ? "these" : "it"} from another account, import that account too; until then the planned amount is used.`,
    );
  if (actualCats.some((c) => norm(c) === "uncategorized")) warnings.push("Some transactions are Uncategorized: pick a category so they count against the right budget line.");

  const sum = (f: (r: CategoryRow) => number | null) => rows.reduce<number | null>((s, r) => (f(r) === null ? s : (s ?? 0) + f(r)!), null);
  const actualBasisExpenses: Expense[] = [
    ...i.expenses.map((e) => {
      const r = rows.find((x) => x.planCategory === e.category)!;
      return r.actualAvg === null ? e : { ...e, monthly: Math.max(0, r.actualAvg) };
    }),
    ...rows
      .filter((r) => r.status === "unplanned" && r.actualAvg !== null && r.actualAvg > 0)
      .map((r) => ({ id: `actual:${r.actualCategories[0]}`, category: `${r.actualCategories[0]} (unbudgeted)`, monthly: r.actualAvg!, kind: "want" as const })),
  ];
  return {
    completeMonths,
    currentMonth,
    daysElapsed,
    daysInMonth: dim,
    rows,
    totals: {
      planned: round2(i.expenses.reduce((s, e) => s + e.monthly, 0)),
      actualAvg: completeMonths.length ? round2(actualBasisExpenses.reduce((s, e) => s + e.monthly, 0)) : null,
      monthToDate: round2(rows.reduce((s, r) => s + r.monthToDate, 0)),
      pace: sum((r) => r.pace) === null ? null : round2(sum((r) => r.pace)!),
    },
    actualBasisExpenses,
    warnings,
  };
}
