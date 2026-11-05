import { incomeInMonth, paychecks, paySchedule, round2 } from "./core";
import { detectPaychecks, matchIncomeLine, PAYCHECK, type PayTx } from "./paychecks";
import { payer } from "./summary";
import type { Profile, YearMonth } from "./types";

/**
 * Income for the calendar year that adds up with your statements:
 *
 *   received       = every deposit marked Income this year (exactly Analysis' "money in"),
 *                    split into your income lines (matched by employer) and other money in
 *   still expected = paychecks / payments dated after your last imported transaction
 *   2026 total     = received + still expected
 *
 * Expected paychecks before your last statement aren't counted (if they came, they're in
 * "received"); a one-time payment with no matching deposit is flagged, not counted.
 */
export interface LineIncome {
  id: string;
  name: string;
  received: number;
  deposits: number;
  /** Paydays between the first and last deposit with no deposit within 3 days (a missing statement): estimated at the line's amount. */
  estimated: number;
  estimatedDates: string[];
  ahead: number;
  aheadCount: number;
  total: number;
  flag: string | null;
}

export interface YearIncome {
  year: number;
  coveredThrough: string | null; // last imported transaction
  lines: LineIncome[];
  /** Payroll deposits from employers that have no income line yet (counted: it's pay). */
  unlinked: { employer: string; received: number; deposits: number }[];
  /** Money in that isn't pay (Zelle from people, refunds, cash, other deposits): not income here; see Analysis. */
  other: { received: number; sources: { label: string; total: number }[] };
  /** Every deposit marked Income (Analysis' "money in"), for reference. */
  allMoneyIn: number;
  received: number; // pay received: income lines + employers without a line
  estimated: number;
  ahead: number;
  total: number; // received + estimated + ahead
  aheadByMonth: number[]; // 12, still-expected money by the month it lands in
  missing: { month: YearMonth; estimate: number }[]; // estimated paychecks by month (no deposit found)
}

const day = 86_400_000;
const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const iso = (x: number) => new Date(x).toISOString().slice(0, 10);

/** Money a line still brings in this year: paychecks / payments dated after `coveredThrough` (the last imported transaction). */
export function aheadFor(line: Profile["incomes"][number], coveredThrough: string | null, year: number): { amount: number; count: number; byMonth: number[]; dates: string[] } {
  const after = coveredThrough ? iso(t(coveredThrough) + day) : `${year}-01-01`;
  const from = after > `${year}-01-01` ? after : `${year}-01-01`;
  const byMonth = Array.from({ length: 12 }, () => 0);
  const dates: string[] = [];
  if (line.frequency === "once") {
    const d = line.firstPayDate ?? (line.startMonth ? `${line.startMonth}-01` : null);
    if (d && d.startsWith(`${year}-`) && d >= from) {
      byMonth[Number(d.slice(5, 7)) - 1]! += line.amount;
      dates.push(d);
    }
  } else if (paySchedule(line)) {
    for (const c of paychecks(line, from, `${year}-12-31`)) {
      byMonth[Number(c.date.slice(5, 7)) - 1]! += c.amount;
      dates.push(c.date);
    }
  } else {
    const lastCovered = coveredThrough ? coveredThrough.slice(0, 7) : `${year - 1}-12`;
    for (let k = 0; k < 12; k++) {
      const m = `${year}-${String(k + 1).padStart(2, "0")}`;
      const v = m > lastCovered ? incomeInMonth([line], m) : 0;
      if (v > 0) {
        byMonth[k]! += v;
        dates.push(`${m}-01`);
      }
    }
  }
  return { amount: round2(byMonth.reduce((a, b) => a + b, 0)), count: dates.length, byMonth: byMonth.map(round2), dates };
}

export function yearIncome(p: Profile, txs: PayTx[], year: number, _statementStatus?: (m: YearMonth) => "full" | "thin" | "current" | "none"): YearIncome {
  const coveredThrough = txs.map((x) => x.date).sort().at(-1) ?? null;
  const after = coveredThrough ? iso(t(coveredThrough) + day) : `${year}-01-01`;
  const inYear = txs.filter((x) => x.date.startsWith(`${year}-`) && x.category === "Income" && x.amount > 0);
  const patterns = detectPaychecks(txs);
  const used = new Set<PayTx>();
  const aheadByMonth = Array.from({ length: 12 }, () => 0);
  const missing = new Map<string, number>();

  const lines: LineIncome[] = p.incomes.map((line) => {
    let received = 0;
    let deposits = 0;
    let flag: string | null = null;
    const depositDates: string[] = [];
    // Deposits from this line's employer
    const pt = patterns.find((x) => matchIncomeLine(x, p.incomes)?.id === line.id);
    if (pt) {
      for (const x of inYear.filter((x) => !used.has(x) && PAYCHECK.test(x.description) && payer(x.description) === pt.employer)) {
        used.add(x);
        received += x.amount;
        deposits++;
        depositDates.push(x.date);
      }
    }
    // Still expected (after the last statement); a one-time payment already due must show up as a deposit
    const a = aheadFor(line, coveredThrough, year);
    const ahead = a.amount;
    const aheadCount = a.count;
    a.byMonth.forEach((v, k) => (aheadByMonth[k]! += v));
    if (line.frequency === "once") {
      const d = line.firstPayDate ?? (line.startMonth ? `${line.startMonth}-01` : null);
      if (d && d.startsWith(`${year}-`) && d < after) {
        const hit = inYear.find((x) => !used.has(x) && Math.abs(t(x.date) - t(d)) <= 10 * day && Math.abs(x.amount - line.amount) <= Math.max(1, line.amount * 0.02));
        if (hit) {
          used.add(hit);
          received += hit.amount;
          deposits++;
        } else flag = `No deposit of ${fmt(line.amount)} around ${d} in your statements: not counted.`;
      }
    }
    // Paydays inside the deposit range with no deposit within 3 days: the statement for them is missing.
    let estimated = 0;
    const estimatedDates: string[] = [];
    if (paySchedule(line) && depositDates.length >= 2) {
      const sorted = [...depositDates].sort();
      for (const c of paychecks(line, sorted[0]!, sorted.at(-1)!)) {
        if (depositDates.some((d) => Math.abs(t(d) - t(c.date)) <= 3 * day)) continue;
        estimated += c.amount;
        estimatedDates.push(c.date);
        missing.set(c.date.slice(0, 7), (missing.get(c.date.slice(0, 7)) ?? 0) + c.amount);
      }
    }
    // A line that should have paid before your last statement but matched no deposits
    if (!flag && line.frequency !== "once" && received === 0 && coveredThrough) {
      const due = Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}`).filter((m) => m <= coveredThrough.slice(0, 7) && incomeInMonth([line], m) > 0);
      if (due.length) flag = `No deposits from this job in your statements (${due[0]} – ${due.at(-1)}): not counted.`;
    }
    return { id: line.id, name: line.name, received: round2(received), deposits, estimated: round2(estimated), estimatedDates, ahead: round2(ahead), aheadCount, total: round2(received + estimated + ahead), flag };
  });

  // Payroll from employers with no income line: still pay
  const unlinkedMap = new Map<string, { employer: string; received: number; deposits: number }>();
  for (const x of inYear.filter((x) => !used.has(x) && PAYCHECK.test(x.description))) {
    const e = payer(x.description);
    const g = unlinkedMap.get(e) ?? { employer: e, received: 0, deposits: 0 };
    g.received += x.amount;
    g.deposits++;
    unlinkedMap.set(e, g);
    used.add(x);
  }
  const unlinked = [...unlinkedMap.values()].map((g) => ({ ...g, received: round2(g.received) })).sort((a, b) => b.received - a.received);
  // Everything else that came in (not pay): Zelle from people, refunds, cash, other deposits
  const rest = inYear.filter((x) => !used.has(x));
  const bySource = new Map<string, number>();
  for (const x of rest) {
    const label = /zelle|venmo|e-?transfer/i.test(x.description) ? "From people (Zelle etc.)" : /\batm\b/i.test(x.description) ? "Cash deposits" : /refund|reward|credit|cash ?back|points/i.test(x.description) ? "Refunds & rewards" : x.description.split(/ DES:| ID:|\*/)[0]!.replace(/\s+\S*\d\S*/g, "").trim().slice(0, 30);
    bySource.set(label, (bySource.get(label) ?? 0) + x.amount);
  }
  const otherReceived = round2(rest.reduce((s, x) => s + x.amount, 0));
  const allMoneyIn = round2(inYear.reduce((s, x) => s + x.amount, 0));
  const received = round2(lines.reduce((s, l) => s + l.received, 0) + unlinked.reduce((s, u) => s + u.received, 0));
  const ahead = round2(lines.reduce((s, l) => s + l.ahead, 0));
  const estimated = round2(lines.reduce((s, l) => s + l.estimated, 0));
  return {
    year,
    coveredThrough,
    lines,
    unlinked,
    allMoneyIn,
    other: { received: otherReceived, sources: [...bySource.entries()].map(([label, total]) => ({ label, total: round2(total) })).sort((a, b) => b.total - a.total) },
    received,
    estimated,
    ahead,
    total: round2(received + estimated + ahead),
    aheadByMonth: aheadByMonth.map(round2),
    missing: [...missing.entries()].map(([month, estimate]) => ({ month, estimate: round2(estimate) })).sort((a, b) => a.month.localeCompare(b.month)),
  };

}

const fmt = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
