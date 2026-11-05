import { incomeInMonth, round2 } from "./core";
import { payer } from "./summary";
import type { IncomeStream } from "./types";

/**
 * Find your paychecks in imported transactions: deposits marked Income whose
 * description says payroll / direct deposit, grouped by employer. From the dates
 * we infer how often (weekly, every two weeks, twice a month, monthly), which
 * weekday, the usual amount, and whether it's still coming.
 */
export interface PayPattern {
  employer: string;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  payDay: number | null; // 0 Sunday … 6 Saturday (weekly / biweekly)
  amount: number; // usual paycheck: median of on-schedule deposits, leaving out the first/last (often partial) and off-cycle ones
  latest: number;
  average: number; // average of all deposits found
  count: number;
  first: string;
  last: string;
  ongoing: boolean;
  /** The income line this would set up. */
  line: Omit<IncomeStream, "id">;
}

export interface PayTx {
  date: string;
  description: string;
  amount: number;
  category: string;
}

export const PAYCHECK = /payroll|direct dep|salary|pay ?cheque|paycheck/i;
const dayMs = 86_400_000;
const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function detectPaychecks(txs: PayTx[]): PayPattern[] {
  const dataEnd = txs.map((x) => x.date).sort().at(-1);
  if (!dataEnd) return [];
  const byEmployer = new Map<string, PayTx[]>();
  for (const x of txs) {
    if (x.category !== "Income" || x.amount <= 0 || !PAYCHECK.test(x.description)) continue;
    const e = payer(x.description);
    byEmployer.set(e, [...(byEmployer.get(e) ?? []), x]);
  }
  const out: PayPattern[] = [];
  for (const [employer, list] of byEmployer) {
    const xs = [...list].sort((a, b) => a.date.localeCompare(b.date));
    if (xs.length < 2) continue;
    const gaps = xs.slice(1).map((x, k) => Math.round((t(x.date) - t(xs[k]!.date)) / dayMs));
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
    // Weekly/biweekly pay always lands a whole number of weeks apart; twice-a-month pay (15th and last day) doesn't.
    const weekAligned = gaps.filter((g) => g % 7 === 0).length >= gaps.length * 0.7;
    const frequency = median <= 9 ? "weekly" : median <= 16 ? (!weekAligned && sameDaysOfMonth(xs) ? "semimonthly" : "biweekly") : "monthly";
    const days = xs.map((x) => new Date(t(x.date)).getUTCDay());
    const counts = new Map<number, number>();
    for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
    const payDay = frequency === "weekly" || frequency === "biweekly" ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0] : null;
    const period = { weekly: 7, biweekly: 14, semimonthly: 16, monthly: 31 }[frequency];
    const last = xs.at(-1)!;
    const amount = usualPaycheck(xs, frequency, payDay);
    // Still coming if the last one is within one pay period (+ a few days) of the newest transaction you imported.
    const ongoing = (t(dataEnd) - t(last.date)) / dayMs <= period + 4;
    out.push({
      employer,
      frequency,
      payDay,
      amount,
      latest: round2(last.amount),
      average: round2(xs.reduce((s, x) => s + x.amount, 0) / xs.length),
      count: xs.length,
      first: xs[0]!.date,
      last: last.date,
      ongoing,
      line: {
        name: employer,
        amount,
        frequency,
        basis: "net",
        kind: "salary",
        // Exact dates only for weekly/biweekly (counted by payday); others are by month.
        ...(payDay !== null ? { payDay, firstPayDate: xs[0]!.date, lastPayDate: ongoing ? null : last.date } : {}),
        startMonth: xs[0]!.date.slice(0, 7),
        endMonth: ongoing ? null : last.date.slice(0, 7),
      },
    });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last));
}

/**
 * The usual paycheck: median of deposits on the pay schedule (the main weekday,
 * a whole number of periods after the first), without the first and last
 * deposits (partial periods) and off-cycle ones (an advance on a Monday).
 */
function usualPaycheck(xs: PayTx[], frequency: PayPattern["frequency"], payDay: number | null): number {
  const step = frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : 0;
  const onSchedule = step && payDay !== null ? xs.filter((x) => new Date(t(x.date)).getUTCDay() === payDay && Math.round((t(x.date) - t(xs[0]!.date)) / dayMs) % step === 0) : xs;
  const core = onSchedule.length >= 4 ? onSchedule.slice(1, -1) : onSchedule.length ? onSchedule : xs;
  const sorted = core.map((x) => x.amount).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return round2(sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Twice a month on (about) the same days, e.g. the 15th and the last day. */
function sameDaysOfMonth(xs: PayTx[]): boolean {
  const dom = xs.map((x) => Number(x.date.slice(8, 10)));
  const early = dom.filter((d) => d <= 16);
  const late = dom.filter((d) => d > 16);
  const spread = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
  return early.length > 0 && late.length > 0 && spread(early) <= 3 && spread(late) <= 4;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Which existing income line a detected pattern most likely describes (same employer name, or the same months). */
export function matchIncomeLine(p: PayPattern, incomes: IncomeStream[]): IncomeStream | null {
  const e = norm(p.employer);
  const byName = incomes.find((i) => {
    const n = norm(i.name);
    return n.length >= 3 && (e.includes(n) || n.includes(e) || initials(p.employer) === n);
  });
  if (byName) return byName;
  const months: string[] = [];
  for (let m = p.first.slice(0, 7); m <= p.last.slice(0, 7); m = nextMonth(m)) months.push(m);
  let best: { i: IncomeStream; overlap: number } | null = null;
  for (const i of incomes) {
    const overlap = months.filter((m) => incomeInMonth([i], m) > 0).length;
    if (overlap >= Math.min(2, months.length) && (!best || overlap > best.overlap)) best = { i, overlap };
  }
  return best?.i ?? null;
}

/** Does the line already describe this pattern (same schedule, amount within 1%)? */
export function lineMatchesPattern(i: IncomeStream, p: PayPattern): boolean {
  return i.frequency === p.frequency && Math.abs(i.amount - p.amount) <= Math.max(1, p.amount * 0.01) && (i.payDay ?? null) === p.payDay && (p.payDay === null || i.firstPayDate === p.first);
}

const initials = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .toLowerCase();
const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};
