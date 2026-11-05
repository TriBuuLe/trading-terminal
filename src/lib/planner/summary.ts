import { expenseInMonth, round2 } from "./core";
import { PEER_PAYMENT } from "./csv";
import { netIncome } from "./net";
import { matchPlanCategory } from "./spending";
import type { Profile, YearMonth } from "./types";

/**
 * One calendar year from your TRANSACTIONS (what really happened), with your
 * plan (income lines and budget lines) alongside for comparison.
 *
 *   money in  = transactions in Income (paychecks, Zelle from people, cash deposits...)
 *   spending  = everything else except Transfers (credit-card payments), net of refunds
 *   saved     = money in − spending
 *
 * Each transaction category is its own row: no mapping. Averages use FULL
 * months only: not the current month (still running) and not "thin" months
 * that look like a statement is missing.
 */
export interface SummaryTx {
  date: string;
  description: string;
  amount: number;
  category: string;
}

export type IncomeKind = "paycheck" | "people" | "refund" | "cash" | "other";

export interface IncomeSource {
  label: string;
  kind: IncomeKind;
  total: number;
  count: number;
}

export type RowStatus = "over" | "under" | "on track" | "no budget" | "no transactions";

export interface CategoryRow {
  category: string;
  kind: "need" | "want" | null; // from the budget line, if any
  total: number; // this year, all months
  avgPerMonth: number | null; // over full months
  budgetPerMonth: number | null; // budget line averaged over the same full months
  diffPerMonth: number | null;
  lastMonth: number | null; // most recent full month
  sharePct: number;
  status: RowStatus;
  top: { date: string; description: string; amount: number }[];
}

export interface MonthRow {
  month: YearMonth;
  income: number | null; // from transactions; null = no transactions that month
  spent: number | null;
  saved: number | null;
  planned: number; // take-home from your income lines
  budget: number; // budget lines active that month
  count: number;
  status: "full" | "thin" | "current" | "none";
}

export interface Attention {
  severity: "high" | "medium" | "info";
  text: string;
}

export interface YearSummary {
  year: number;
  months: MonthRow[];
  fullMonths: YearMonth[];
  income: {
    actual: number;
    paychecks: number;
    sources: IncomeSource[];
    /** From your income lines: whole year, and the same months you have transactions for. */
    plannedYear: number;
    plannedSameMonths: number;
  };
  spending: { actual: number; avgPerMonth: number | null; budgetPerMonth: number | null };
  saved: { actual: number; ratePct: number | null };
  categories: CategoryRow[];
  attention: Attention[];
  dataChecks: string[];
}

const PAYCHECK = /payroll|direct dep|salary|pay ?cheque|paycheck/i;
const REFUND = /refund|reward|statement credit|cash ?back|points|rebate/i;
const fmt = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

/** "IBM 3141 DES:PAYROLL ID:…" → "IBM"; "MODERNIZING MEDI DES:…" → "Modernizing Medi". */
export function payer(description: string): string {
  const head = description.split(/ DES:| ID:| PPD|\*/)[0]!.replace(/\s+\S*\d\S*/g, "").trim();
  const words = head.split(/\s+/).slice(0, 3).join(" ");
  return words.length <= 4 ? words.toUpperCase() : words.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function incomeKind(t: SummaryTx): IncomeKind {
  if (/\batm\b/i.test(t.description)) return "cash";
  if (PAYCHECK.test(t.description)) return "paycheck";
  if (PEER_PAYMENT.test(t.description)) return "people";
  if (REFUND.test(t.description)) return "refund";
  return "other";
}

export function yearSummary(i: { profile: Profile; txs: SummaryTx[]; year: number; today: string }): YearSummary {
  const p = i.profile;
  const months = Array.from({ length: 12 }, (_, k) => `${i.year}-${String(k + 1).padStart(2, "0")}`);
  const currentMonth = i.today.slice(0, 7);
  const planned = netIncome(p, months[0]!, 12).byMonth.map((m) => m.amount);

  const inYear = i.txs.filter((t) => t.date.startsWith(`${i.year}-`) && t.date.slice(0, 7) <= currentMonth);
  const isIncome = (t: SummaryTx) => t.category === "Income";
  const isSpend = (t: SummaryTx) => t.category !== "Income" && t.category !== "Transfers";
  const monthOf = (t: SummaryTx) => t.date.slice(0, 7);

  // Month status: a month with far fewer transactions than usual is probably missing a statement.
  const counts = new Map<string, number>();
  for (const t of inYear) counts.set(monthOf(t), (counts.get(monthOf(t)) ?? 0) + 1);
  const past = months.filter((m) => m < currentMonth && (counts.get(m) ?? 0) > 0);
  const sorted = past.map((m) => counts.get(m)!).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const statusOf = (m: string): MonthRow["status"] =>
    !(counts.get(m) ?? 0) ? "none" : m === currentMonth ? "current" : sorted.length >= 3 && counts.get(m)! < median * 0.25 ? "thin" : "full";
  const fullMonths = months.filter((m) => statusOf(m) === "full");
  const n = fullMonths.length;

  const sum = (xs: SummaryTx[]) => xs.reduce((s, t) => s + t.amount, 0);
  const rows: MonthRow[] = months.map((m, k) => {
    const mt = inYear.filter((t) => monthOf(t) === m);
    const has = mt.length > 0;
    const income = sum(mt.filter(isIncome));
    const spent = -sum(mt.filter(isSpend));
    return {
      month: m,
      income: has ? round2(income) : null,
      spent: has ? round2(spent) : null,
      saved: has ? round2(income - spent) : null,
      planned: planned[k]!,
      budget: round2(expenseInMonth(p.expenses, m)),
      count: mt.length,
      status: statusOf(m),
    };
  });

  // Income sources
  const incomeTx = inYear.filter(isIncome);
  const groups = new Map<string, IncomeSource>();
  for (const t of incomeTx) {
    const kind = incomeKind(t);
    const label = kind === "paycheck" || kind === "other" ? payer(t.description) : kind === "people" ? "From people (Zelle etc.)" : kind === "cash" ? "Cash deposits" : "Refunds & rewards";
    const g = groups.get(label) ?? { label, kind, total: 0, count: 0 };
    g.total += t.amount;
    g.count++;
    groups.set(label, g);
  }
  const sources = [...groups.values()].map((g) => ({ ...g, total: round2(g.total) })).sort((a, b) => b.total - a.total);
  const actualIncome = sum(incomeTx);
  const monthsWithData = months.filter((m) => (counts.get(m) ?? 0) > 0);
  const plannedSameMonths = monthsWithData.reduce((s, m) => s + planned[months.indexOf(m)]!, 0);

  // Spending by category: every transaction category is its own row; budget lines without transactions too.
  const spendTx = inYear.filter(isSpend);
  const totalSpent = -sum(spendTx);
  const budgetNames = [...new Set(p.expenses.map((e) => e.category))];
  const cats = [...new Set([...spendTx.map((t) => t.category), ...budgetNames.filter((b) => months.some((m) => expenseInMonth(p.expenses, m, b) > 0))])];
  const lastFull = fullMonths.at(-1) ?? null;
  const categories: CategoryRow[] = cats
    .map((cat) => {
      const tx = spendTx.filter((t) => t.category === cat);
      // A budget line with this exact name; an older free-text line name still matches (e.g. "Vacation" → Travel).
      const line = budgetNames.includes(cat) ? cat : matchPlanCategory(cat, budgetNames.filter((b) => !cats.includes(b)));
      const total = -sum(tx);
      const avg = n ? -sum(tx.filter((t) => fullMonths.includes(monthOf(t)))) / n : null;
      const budget = line ? (n ? fullMonths.reduce((s, m) => s + expenseInMonth(p.expenses, m, line), 0) / n : expenseInMonth(p.expenses, currentMonth, line)) : null;
      const tol = Math.max(10, (budget ?? 0) * 0.1);
      const status: RowStatus = !tx.length
        ? "no transactions"
        : budget === null
          ? "no budget"
          : avg === null
            ? "on track"
            : avg > budget + tol
              ? "over"
              : avg < budget - tol
                ? "under"
                : "on track";
      return {
        category: cat,
        kind: line ? (p.expenses.find((e) => e.category === line)?.kind ?? null) : null,
        total: round2(total),
        avgPerMonth: avg === null ? null : round2(avg),
        budgetPerMonth: budget === null ? null : round2(budget),
        diffPerMonth: avg !== null && budget !== null ? round2(avg - budget) : null,
        lastMonth: lastFull && tx.length ? round2(-sum(tx.filter((t) => monthOf(t) === lastFull))) : null,
        sharePct: totalSpent > 0 ? round2((total / totalSpent) * 100) : 0,
        status,
        top: [...tx]
          .sort((a, b) => a.amount - b.amount)
          .slice(0, 3)
          .filter((t) => t.amount < 0)
          .map((t) => ({ date: t.date, description: t.description, amount: round2(-t.amount) })),
      };
    })
    .sort((a, b) => b.total - a.total);

  // What needs attention
  const attention: Attention[] = [];
  for (const c of categories.filter((c) => c.status === "over").sort((a, b) => b.diffPerMonth! - a.diffPerMonth!))
    attention.push({
      severity: c.diffPerMonth! > c.budgetPerMonth! * 0.5 ? "high" : "medium",
      text: `${c.category}: ${fmt(c.avgPerMonth!)}/month vs ${fmt(c.budgetPerMonth!)} budgeted (${fmt(c.diffPerMonth!)} over). Biggest: ${c.top.map((t) => `${t.description.slice(0, 32)} ${fmt(t.amount)}`).join(", ")}.`,
    });
  for (const c of categories.filter((c) => c.status === "no budget" && c.category !== "Uncategorized" && c.total > 100))
    attention.push({
      severity: (c.avgPerMonth ?? 0) > 150 ? "high" : "medium",
      text: `${c.category}: ${fmt(c.total)} this year${c.avgPerMonth ? ` (~${fmt(c.avgPerMonth)}/month)` : ""} with no budget line. Add one in My finances${c.category === "Education" || c.category === "Travel" ? " (a once-a-year cost can be a single month with “every year”)" : ""}.`,
    });
  const big = spendTx.filter((t) => -t.amount >= 500 && t.category !== "Rent").sort((a, b) => a.amount - b.amount).slice(0, 5);
  if (big.length) attention.push({ severity: "info", text: `Large one-offs: ${big.map((t) => `${t.date} ${t.category} ${fmt(-t.amount)}`).join("; ")}. Big irregular costs are easier with a goal or a sinking fund.` });

  // Is the data complete?
  const dataChecks: string[] = [];
  const thin = months.filter((m) => statusOf(m) === "thin");
  if (thin.length) dataChecks.push(`${thin.join(", ")}: only ${thin.map((m) => counts.get(m)).join(", ")} transaction(s), so a statement is probably missing. Left out of the averages.`);
  // Gaps BETWEEN months that have data (before your first import isn't a gap).
  const first = monthsWithData[0];
  const none = months.filter((m) => first !== undefined && m > first && m < currentMonth && !(counts.get(m) ?? 0));
  if (none.length && monthsWithData.length) dataChecks.push(`No transactions for ${none.join(", ")}.`);
  const unc = categories.find((c) => c.category === "Uncategorized");
  if (unc && unc.total > 0) dataChecks.push(`${fmt(unc.total)} is Uncategorized: sort it under Transactions (Re-check categories does most of it).`);
  const cards = [...new Set(inYear.flatMap((t) => /payment to crd (\d{4})/i.exec(t.description)?.[1] ?? []))];
  if (cards.length) dataChecks.push(`You pay a card ending ${cards.join(", ")} from checking. If that card's own statement isn't imported, its purchases are missing here.`);
  const noTx = categories.filter((c) => c.status === "no transactions");
  if (noTx.length) dataChecks.push(`Budgeted but no transactions: ${noTx.map((c) => c.category).join(", ")}. If you pay ${noTx.length > 1 ? "these" : "it"} from another account, import that too.`);

  const fullSpent = rows.filter((r) => r.status === "full").reduce((s, r) => s + r.spent!, 0);
  return {
    year: i.year,
    months: rows,
    fullMonths,
    income: {
      actual: round2(actualIncome),
      paychecks: round2(sources.filter((s) => s.kind === "paycheck").reduce((s, x) => s + x.total, 0)),
      sources,
      plannedYear: round2(planned.reduce((s, x) => s + x, 0)),
      plannedSameMonths: round2(plannedSameMonths),
    },
    spending: {
      actual: round2(totalSpent),
      avgPerMonth: n ? round2(fullSpent / n) : null,
      budgetPerMonth: n ? round2(fullMonths.reduce((s, m) => s + expenseInMonth(p.expenses, m), 0) / n) : null,
    },
    saved: { actual: round2(actualIncome - totalSpent), ratePct: actualIncome > 0 ? round2(((actualIncome - totalSpent) / actualIncome) * 100) : null },
    categories,
    attention,
    dataChecks,
  };
}
