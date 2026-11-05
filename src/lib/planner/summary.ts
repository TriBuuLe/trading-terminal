import { expenseInMonth, round2 } from "./core";
import { netIncome } from "./net";
import { matchPlanCategory } from "./spending";
import type { Profile, YearMonth } from "./types";

/**
 * One calendar year at a glance: take-home income (from income lines, every
 * month of the year, past jobs included), actual spending (from imported
 * transactions), budget for the same months, where the money went, and what
 * needs attention. Pure; amounts in dollars.
 */
export interface SummaryTx {
  date: string;
  description: string;
  amount: number;
  category: string;
}

export interface CategorySpend {
  label: string; // budget line, or the transaction category if it has none
  budgeted: boolean;
  actual: number;
  budget: number; // over the months that have transactions
  diff: number;
  sharePct: number;
  top: { date: string; description: string; amount: number }[];
}

export interface Attention {
  severity: "high" | "medium" | "info";
  text: string;
}

export interface YearSummary {
  year: number;
  months: { month: YearMonth; takeHome: number; spent: number | null; budget: number }[];
  income: { takeHomeYear: number; takeHomeToDate: number; throughMonth: YearMonth | null; fromTransactions: number };
  spending: { actual: number; monthsWithData: YearMonth[]; budgetSameMonths: number; /** Budget lines active in those months with no transactions (paid elsewhere?). */ noDataLines: string[] };
  savedOverDataMonths: number | null;
  categories: CategorySpend[];
  attention: Attention[];
}

const NOT_SPENDING = new Set(["income", "transfers"]);
const isSpend = (t: SummaryTx) => !NOT_SPENDING.has(t.category.trim().toLowerCase());
const fmt = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

export function yearSummary(i: { profile: Profile; txs: SummaryTx[]; year: number; today: string; categoryMap?: Record<string, string> }): YearSummary {
  const p = i.profile;
  const months = Array.from({ length: 12 }, (_, k) => `${i.year}-${String(k + 1).padStart(2, "0")}`);
  const currentMonth = i.today.slice(0, 7);
  const income = netIncome(p, months[0]!, 12).byMonth;

  const inYear = i.txs.filter((t) => t.date.startsWith(String(i.year)));
  const spendTx = inYear.filter(isSpend);
  const spentBy = new Map<string, number>();
  for (const t of spendTx) spentBy.set(t.date.slice(0, 7), (spentBy.get(t.date.slice(0, 7)) ?? 0) - t.amount);
  const monthsWithData = months.filter((m) => spentBy.has(m));

  const rows = months.map((m, k) => ({
    month: m,
    takeHome: income[k]!.amount,
    spent: spentBy.has(m) ? round2(spentBy.get(m)!) : null,
    budget: round2(expenseInMonth(p.expenses, m)),
  }));
  const passed = months.filter((m) => m <= currentMonth);
  const takeHomeToDate = rows.filter((r) => passed.includes(r.month)).reduce((s, r) => s + r.takeHome, 0);
  const actual = spendTx.reduce((s, t) => s - t.amount, 0);
  const budgetSameMonths = monthsWithData.reduce((s, m) => s + expenseInMonth(p.expenses, m), 0);

  // Where the money went: group by budget line (or the raw category).
  const planNames = [...new Set(p.expenses.map((e) => e.category))];
  const groups = new Map<string, { budgeted: boolean; txs: SummaryTx[] }>();
  for (const t of spendTx) {
    const line = matchPlanCategory(t.category, planNames, i.categoryMap);
    const label = line ?? t.category;
    const g = groups.get(label) ?? { budgeted: line !== null, txs: [] };
    g.txs.push(t);
    groups.set(label, g);
  }
  const categories: CategorySpend[] = [...groups.entries()]
    .map(([label, g]) => {
      const a = g.txs.reduce((s, t) => s - t.amount, 0);
      const budget = g.budgeted ? monthsWithData.reduce((s, m) => s + expenseInMonth(p.expenses, m, label), 0) : 0;
      return {
        label,
        budgeted: g.budgeted,
        actual: round2(a),
        budget: round2(budget),
        diff: round2(a - budget),
        sharePct: actual > 0 ? round2((a / actual) * 100) : 0,
        top: [...g.txs]
          .sort((x, y) => x.amount - y.amount)
          .slice(0, 3)
          .filter((t) => t.amount < 0)
          .map((t) => ({ date: t.date, description: t.description, amount: round2(-t.amount) })),
      };
    })
    .sort((a, b) => b.actual - a.actual);

  // What needs attention, most important first.
  const attention: Attention[] = [];
  const n = monthsWithData.length;
  for (const c of categories.filter((c) => c.budgeted && c.diff > Math.max(50, c.budget * 0.1)).sort((a, b) => b.diff - a.diff)) {
    attention.push({
      severity: c.diff > c.budget * 0.5 ? "high" : "medium",
      text: `${c.label}: ${fmt(c.actual)} spent vs ${fmt(c.budget)} budgeted over ${n} month${n === 1 ? "" : "s"} (${fmt(c.diff)} over, ~${fmt(c.diff / Math.max(1, n))}/month). Biggest: ${c.top.map((t) => `${t.description} ${fmt(t.amount)}`).join(", ")}.`,
    });
  }
  for (const c of categories.filter((c) => !c.budgeted && c.label.toLowerCase() !== "uncategorized" && c.actual > 50)) {
    attention.push({
      severity: c.actual / Math.max(1, n) > 150 ? "high" : "medium",
      text: `${c.label}: ${fmt(c.actual)} (~${fmt(c.actual / Math.max(1, n))}/month) with no budget line. Add one in My finances, or map it to an existing line.`,
    });
  }
  const unc = categories.find((c) => c.label.toLowerCase() === "uncategorized");
  if (unc && unc.actual > 0) attention.push({ severity: "medium", text: `Uncategorized: ${fmt(unc.actual)} the app can't place. Pick categories under Transactions so it counts against the right line.` });
  const big = spendTx.filter((t) => -t.amount >= 300).sort((a, b) => a.amount - b.amount).slice(0, 5);
  if (big.length) attention.push({ severity: "info", text: `Large one-off purchases: ${big.map((t) => `${t.date} ${t.description} ${fmt(-t.amount)}`).join("; ")}. Plan for these with a goal or a sinking fund.` });
  const noDataLines = [...new Set(p.expenses.filter((e) => monthsWithData.some((m) => expenseInMonth([e], m) > 0)).map((e) => e.category))].filter(
    (cat) => !categories.some((c) => c.label === cat),
  );
  const silent = [...new Set(p.expenses.filter((e) => e.kind === "need" && monthsWithData.some((m) => expenseInMonth([e], m) > 0)).map((e) => e.category))].filter(
    (cat) => !categories.some((c) => c.label === cat),
  );
  if (silent.length && n) attention.push({ severity: "info", text: `No transactions for ${silent.join(", ")}: if you pay ${silent.length > 1 ? "these" : "it"} from another account, import that account too.` });
  const under = categories.filter((c) => c.budgeted && c.diff < -Math.max(50, c.budget * 0.2));
  if (under.length) attention.push({ severity: "info", text: `Under budget: ${under.map((c) => `${c.label} (${fmt(-c.diff)} less)`).join(", ")}. Either good habits or spending from another account.` });

  const saved = n ? round2(monthsWithData.reduce((s, m) => s + rows.find((r) => r.month === m)!.takeHome - spentBy.get(m)!, 0)) : null;
  return {
    year: i.year,
    months: rows,
    income: {
      takeHomeYear: round2(rows.reduce((s, r) => s + r.takeHome, 0)),
      takeHomeToDate: round2(takeHomeToDate),
      throughMonth: passed.at(-1) ?? null,
      fromTransactions: round2(inYear.filter((t) => t.category.toLowerCase() === "income" && t.amount > 0).reduce((s, t) => s + t.amount, 0)),
    },
    spending: { actual: round2(actual), monthsWithData, budgetSameMonths: round2(budgetSameMonths), noDataLines },
    savedOverDataMonths: saved,
    categories,
    attention,
  };
}
