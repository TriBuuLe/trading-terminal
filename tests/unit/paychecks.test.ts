import { describe, expect, it } from "vitest";
import { incomeInMonth, nextPaycheck, paychecks, paydays } from "@/lib/planner/core";
import { detectPaychecks, lineMatchesPattern, matchIncomeLine } from "@/lib/planner/paychecks";
import type { IncomeStream } from "@/lib/planner/types";

const ibm: IncomeStream = { id: "i", name: "IBM", amount: 1325.47, frequency: "weekly", kind: "coop", basis: "net", payDay: 5, firstPayDate: "2026-09-11", lastPayDate: "2026-12-11" };

describe("exact pay schedules", () => {
  it("counts every Friday in the month (Fridays in 2026: Sep 11/18/25, Oct 2/9/16/23/30, Dec 4/11 until the last paycheck)", () => {
    expect(paydays(ibm, "2026-09-01", "2026-09-30")).toEqual(["2026-09-11", "2026-09-18", "2026-09-25"]);
    expect(incomeInMonth([ibm], "2026-10")).toBeCloseTo(5 * 1325.47, 6); // 5 Fridays
    expect(incomeInMonth([ibm], "2026-11")).toBeCloseTo(4 * 1325.47, 6); // Nov 6/13/20/27
    expect(incomeInMonth([ibm], "2026-12")).toBeCloseTo(2 * 1325.47, 6); // Dec 4 and 11, then it ends
    expect(incomeInMonth([ibm], "2027-01")).toBe(0);
  });

  it("from employment dates: first payday on/after the start; every paycheck is the per-paycheck amount", () => {
    const s: IncomeStream = { ...ibm, firstPayDate: null, lastPayDate: null, employmentStart: "2026-09-08" };
    expect(paychecks(s, "2026-09-01", "2026-09-18")).toEqual([
      { date: "2026-09-11", amount: 1325.47 },
      { date: "2026-09-18", amount: 1325.47 },
    ]);
  });
  it("IBM: employed Aug 31 – Dec 18, first check Sep 11 → 16 weekly checks × $1,325.47 = $21,207.52", () => {
    const s: IncomeStream = { ...ibm, firstPayDate: "2026-09-11", lastPayDate: null, employmentStart: "2026-08-31", employmentEnd: "2026-12-18" };
    const c = paychecks(s, "2026-01-01", "2026-12-31");
    expect(c).toHaveLength(16);
    expect(c.reduce((t, x) => t + x.amount, 0)).toBeCloseTo(21207.52, 2);
  });

  it("biweekly skips every other week", () => {
    const modmed: IncomeStream = { ...ibm, frequency: "biweekly", firstPayDate: "2026-05-29", lastPayDate: "2026-08-21", amount: 1048.05 };
    expect(paydays(modmed, "2026-05-01", "2026-08-31")).toEqual(["2026-05-29", "2026-06-12", "2026-06-26", "2026-07-10", "2026-07-24", "2026-08-07", "2026-08-21"]);
  });

  describe("hourly: rate × hours per workday × workdays worked in each pay period", () => {
    // $20/h, 30 h/week over Mon–Fri = 6 h/day; starts Thu Oct 1; paid Fridays
    const cafe: IncomeStream = { id: "h", name: "Cafe", amount: 20, frequency: "hourly", hoursPerWeek: 30, payEvery: "weekly", kind: "salary", payDay: 5, employmentStart: "2026-10-01" };
    it("partial first week", () => {
      // Oct 2: Thu+Fri = 2 days × 6 h × $20 = 240; Oct 9, 16, 23, 30: 5 days = 600 each → 2,640
      expect(paychecks(cafe, "2026-10-01", "2026-10-09").map((x) => x.amount)).toEqual([240, 600]);
      expect(incomeInMonth([cafe], "2026-10")).toBe(2640);
    });
    it("pay period ending before payday (paid a week behind)", () => {
      // Period ends 6 days before payday (Saturday). First payday whose period includes Oct 1: Oct 9 (Sep 27 – Oct 3: Thu+Fri = 240),
      // then Oct 16, 23, 30 at 600 → 2,040
      expect(incomeInMonth([{ ...cafe, periodEndsDaysBefore: 6 }], "2026-10")).toBe(2040);
    });
    it("employment end: last partial week, then nothing", () => {
      // Ends Wed Oct 14: Oct 16 covers Oct 10–16, worked Mon–Wed = 3 days = 360 → 240 + 600 + 360
      const ending = { ...cafe, employmentEnd: "2026-10-14" };
      expect(incomeInMonth([ending], "2026-10")).toBe(1200);
      expect(incomeInMonth([ending], "2026-11")).toBe(0);
    });
    it("every two weeks and custom workdays", () => {
      // Oct 2 (Sep 19 – Oct 2: Oct 1–2 = 240), Oct 16 (10 workdays = 1,200), Oct 30 (1,200)
      expect(incomeInMonth([{ ...cafe, payEvery: "biweekly" }], "2026-10")).toBe(2640);
      // Weekends only, 16 h/week = 8 h/day: Oct 2 paycheck covers Sep 26 – Oct 2 but work starts Oct 1 → 0 days → no paycheck; Oct 9 covers Sat 3 + Sun 4 = 2 × 8 × 20 = 320
      const weekend = { ...cafe, hoursPerWeek: 16, workdays: [0, 6] };
      expect(paychecks(weekend, "2026-10-01", "2026-10-09")).toEqual([{ date: "2026-10-09", amount: 320 }]);
    });
  });

  it("the next expected paycheck", () => {
    expect(nextPaycheck([ibm], "2026-11-05")).toEqual({ date: "2026-11-06", amount: 1325.47, name: "IBM" });
    expect(nextPaycheck([ibm], "2026-12-12")).toBeNull(); // after the last one
  });

  it("lines without exact dates still work by month", () => {
    expect(incomeInMonth([{ id: "m", name: "Job", amount: 4000, frequency: "monthly", kind: "salary", startMonth: "2026-05", endMonth: "2026-08" }], "2026-06")).toBe(4000);
  });
});

describe("paychecks found in transactions", () => {
  const fridays = ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"];
  const txs = [
    ...fridays.map((date) => ({ date, description: "IBM 3141 DES:PAYROLL ID:100", amount: 1325.47, category: "Income" })),
    ...["2026-05-29", "2026-06-12", "2026-06-26", "2026-07-10"].map((date) => ({ date, description: "MODERNIZING MEDI DES:PAYROLL", amount: 1048.05, category: "Income" })),
    { date: "2026-10-05", description: "Zelle payment from MAX", amount: 16, category: "Income" }, // not a paycheck
    { date: "2026-10-26", description: "UBER EATS", amount: -26.77, category: "Dining out" }, // newest transaction
  ];
  const found = detectPaychecks(txs);

  it("employer, how often, which weekday, latest amount, still coming or ended", () => {
    expect(found.map((x) => [x.employer, x.frequency, x.payDay, x.amount, x.count, x.first, x.last, x.ongoing])).toEqual([
      ["IBM", "weekly", 5, 1325.47, 7, "2026-09-11", "2026-10-23", true],
      ["Modernizing Medi", "biweekly", 5, 1048.05, 4, "2026-05-29", "2026-07-10", false],
    ]);
    expect(found[0]!.line).toMatchObject({ frequency: "weekly", payDay: 5, firstPayDate: "2026-09-11", lastPayDate: null, basis: "net" });
  });

  it("matches your existing lines by name, or by the same months", () => {
    const lines: IncomeStream[] = [
      { id: "a", name: "IBM", amount: 5300, frequency: "monthly", kind: "coop", startMonth: "2026-09", endMonth: "2026-12" },
      { id: "b", name: "ModMed", amount: 4000, frequency: "monthly", kind: "salary", startMonth: "2026-05", endMonth: "2026-08" },
    ];
    expect(matchIncomeLine(found[0]!, lines)?.id).toBe("a");
    expect(matchIncomeLine(found[1]!, lines)?.id).toBe("b"); // "ModMed" ≠ "Modernizing Medi", but the same months
    expect(lineMatchesPattern(lines[0]!, found[0]!)).toBe(false);
    expect(lineMatchesPattern({ id: "a", ...found[0]!.line }, found[0]!)).toBe(true);
  });
});

describe("one-time payments (bonus)", () => {
  it("the whole amount in the month it's paid, nothing in other months", () => {
    const bonus: IncomeStream = { id: "b", name: "Signing bonus", amount: 4000, frequency: "once", kind: "bonus", basis: "net", firstPayDate: "2026-07-20" };
    expect(incomeInMonth([bonus], "2026-07")).toBe(4000);
    expect(incomeInMonth([bonus], "2026-08")).toBe(0);
    expect(incomeInMonth([bonus], "2027-07")).toBe(0);
  });
});

describe("paychecks you already know (from deposits)", () => {
  it("a measured pay lag moves the last paycheck: start Mon Aug 31, first check Fri Sep 11 → one week behind → last check Dec 25 for a Dec 18 end", () => {
    const ibm: IncomeStream = { id: "i", name: "IBM", amount: 1325.47, frequency: "weekly", kind: "coop", payDay: 5, employmentStart: "2026-08-31", employmentEnd: "2026-12-18", firstPayDate: "2026-09-11", lastPayDate: null };
    const dec = paydays(ibm, "2026-12-01", "2026-12-31");
    expect(dec).toEqual(["2026-12-04", "2026-12-11", "2026-12-18", "2026-12-25"]);
    expect(paydays(ibm, "2026-01-01", "2026-12-31")).toHaveLength(16); // Sep 11 … Dec 25
  });
  it("known first/last paychecks are paid in full, not prorated by employment dates", () => {
    // Tampa Brass: employed Jan 8 – Apr 8, but deposits ran every other Friday Jan 16 → Apr 24 (7 checks)
    const tampa: IncomeStream = { id: "t", name: "Tampa Brass", amount: 486.49, frequency: "biweekly", kind: "salary", payDay: 5, employmentStart: "2026-01-08", employmentEnd: "2026-04-08", firstPayDate: "2026-01-16", lastPayDate: "2026-04-24" };
    const checks = paychecks(tampa, "2026-01-01", "2026-12-31");
    expect(checks.map((c) => c.date)).toEqual(["2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27", "2026-03-13", "2026-03-27", "2026-04-10", "2026-04-24"].slice(0, 8));
    expect(checks.every((c) => c.amount === 486.49)).toBe(true);
  });
});

describe("hourly job with deposits (Tampa Brass: $20/h, Jan 8 – Apr 8, paid every other Friday, one week behind)", () => {
  const regis = [
    ["2026-01-16", 138.52], ["2026-02-27", 1521.93], ["2026-03-13", 1365.12], ["2026-03-30", 1000], ["2026-04-03", 432.91], ["2026-04-10", 1303.8], ["2026-04-24", 486.49],
  ].map(([date, amount]) => ({ date: date as string, description: "REGIS GROUP DES:PAYROLL", amount: amount as number, category: "Income" }));
  it("the usual paycheck ignores the partial first/last and off-cycle deposits", () => {
    const [x] = detectPaychecks([...regis, { date: "2026-10-26", description: "UBER", amount: -5, category: "Transportation" }]);
    // on schedule: Jan 16, Feb 27, Mar 13, Apr 10, Apr 24 → middle ones 1,521.93 / 1,365.12 / 1,303.80 → median 1,365.12
    expect(x).toMatchObject({ frequency: "biweekly", payDay: 5, amount: 1365.12, latest: 486.49, ongoing: false });
  });
  it("hourly: 2 days in the first check, 10 per full check, 3 in the last (gross)", () => {
    const tampa: IncomeStream = { id: "t", name: "Tampa Brass", amount: 20, frequency: "hourly", hoursPerWeek: 40, payEvery: "biweekly", basis: "gross", kind: "salary", payDay: 5, employmentStart: "2026-01-08", employmentEnd: "2026-04-08", firstPayDate: "2026-01-16" };
    const c = paychecks(tampa, "2026-01-01", "2026-12-31");
    // lag 7 days (start Thu Jan 8 → first Friday Jan 9, first check Jan 16): Jan 16 covers Dec 27–Jan 9 (Thu+Fri = 2 × 8 h × $20 = 320);
    // Jan 30 … Apr 10: 10 workdays = 1,600; Apr 24 covers Apr 4–17: Mon–Wed Apr 6–8 = 480. On the every-other-Friday schedule.
    expect(c.map((x) => [x.date, x.amount])).toEqual([
      ["2026-01-16", 320], ["2026-01-30", 1600], ["2026-02-13", 1600], ["2026-02-27", 1600], ["2026-03-13", 1600], ["2026-03-27", 1600], ["2026-04-10", 1600], ["2026-04-24", 480],
    ]);
  });
});
