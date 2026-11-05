import { yearTax, type YearTax } from "../tax/calc";
import { addMonths, incomeInMonth, round2 } from "./core";
import type { IncomeStream, Profile, YearMonth } from "./types";

/**
 * Take-home income per month. "Before tax" streams are taxed per CALENDAR YEAR
 * (all gross pay in that year, so a 4-month co-op year is taxed as a 4-month
 * year), then spread back over the months by the year's take-home ratio.
 * Canada: tax estimates aren't built yet, so gross streams there are flagged.
 */
const isGross = (s: IncomeStream) => s.basis === "gross";

export function grossInYear(streams: IncomeStream[], year: number): number {
  let g = 0;
  for (let m = 1; m <= 12; m++) g += incomeInMonth(streams.filter(isGross), `${year}-${String(m).padStart(2, "0")}`);
  return g;
}

export function taxForYear(p: Profile, year: number): YearTax | null {
  const gross = grossInYear(p.incomes, year);
  if (gross <= 0 || p.country !== "US") return null;
  return yearTax({
    year,
    grossWages: gross,
    filingStatus: p.tax?.filingStatus ?? "single",
    state: p.region,
    pretaxDeductions: p.tax?.pretaxAnnual ?? 0,
    stateRateOverridePct: p.tax?.stateRatePct ?? null,
  });
}

export interface NetIncome {
  byMonth: { month: YearMonth; amount: number; gross: number }[];
  average: number;
  taxes: YearTax[];
  notes: string[];
}

export function netIncome(p: Profile, from: YearMonth, n = 12): NetIncome {
  const notes: string[] = [];
  const years = [...new Set(Array.from({ length: n }, (_, i) => Number(addMonths(from, i).slice(0, 4))))];
  const taxes = years.map((y) => taxForYear(p, y)).filter((t): t is YearTax => t !== null);
  const ratio = new Map(taxes.map((t) => [t.year, t.gross > 0 ? t.net / t.gross : 1]));
  const gross = p.incomes.filter(isGross);
  const net = p.incomes.filter((s) => !isGross(s));
  if (gross.length && p.country !== "US") notes.push("Before-tax income: Canadian tax estimates aren't built yet, so these amounts are counted as take-home. Enter take-home pay for now.");
  for (const t of taxes) for (const x of t.notes) if (!notes.includes(x)) notes.push(x);
  const byMonth = Array.from({ length: n }, (_, i) => {
    const month = addMonths(from, i);
    const g = incomeInMonth(gross, month);
    const r = p.country === "US" ? (ratio.get(Number(month.slice(0, 4))) ?? 1) : 1;
    return { month, amount: round2(incomeInMonth(net, month) + g * r), gross: round2(g) };
  });
  return { byMonth, average: round2(byMonth.reduce((s, m) => s + m.amount, 0) / n), taxes, notes };
}

/**
 * Tax facts derived from income, used when the user hasn't typed them in:
 * earned income ≈ gross wages; MAGI ≈ AGI (gross − pre-tax deductions);
 * marginal rate = federal bracket + state rate.
 */
export function derivedTaxFacts(p: Profile, year: number): { earnedIncome: number; magi: number; marginalPct: number } | null {
  const t = taxForYear(p, year);
  if (!t) return null;
  return { earnedIncome: t.gross, magi: t.agi, marginalPct: t.marginalPct };
}
