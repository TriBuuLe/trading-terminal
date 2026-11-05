import { describe, expect, it } from "vitest";
import { yearIncome } from "@/lib/planner/received";
import type { Profile } from "@/lib/planner/types";

const profile: Profile = {
  country: "US", region: "NC", age: 21, crossBorder: false,
  incomes: [
    { id: "ibm", name: "IBM", amount: 1325.47, frequency: "weekly", kind: "coop", basis: "net", payDay: 5, firstPayDate: "2026-09-11", employmentStart: "2026-08-31", employmentEnd: "2026-12-18" },
    { id: "bonus", name: "Sign-on", amount: 10200, frequency: "once", kind: "bonus", firstPayDate: "2026-07-01" },
    { id: "refund", name: "Deposit back", amount: 667, frequency: "once", kind: "bonus", firstPayDate: "2026-12-18" },
  ],
  expenses: [], debts: [], accounts: [], goals: [],
  risk: { horizonYears: 10, drawdownReaction: 3, incomeStability: 2, experience: 1 }, sandboxPct: 10, highInterestAprPct: 8,
};
const ibm = ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"].map((date) => ({ date, description: "IBM 3141 DES:PAYROLL ID:1", amount: 1325.47, category: "Income" }));
const txs = [
  ...ibm,
  { date: "2026-07-15", description: "GRAEBEL HOLDINGS DES:TRADE PAY", amount: 4000, category: "Income" },
  { date: "2026-08-02", description: "Zelle payment from SAM", amount: 50, category: "Income" },
  { date: "2026-10-26", description: "UBER EATS", amount: -26.77, category: "Dining out" }, // last imported transaction
];

describe("year income that adds up with statements", () => {
  const r = yearIncome(profile, txs, 2026);
  it("received = every deposit marked Income (same as Analysis), split by line and other", () => {
    // 7 × 1,325.47 = 9,278.29; + 4,000 + 50 = 13,328.29
    expect(r.received).toBe(13328.29);
    expect(r.lines.find((l) => l.id === "ibm")).toMatchObject({ received: 9278.29, deposits: 7 });
    expect(r.other.received).toBe(4050);
  });
  it("still expected = paychecks after the last statement (Oct 30 … Dec 25, one week behind) + payments still ahead", () => {
    // 9 IBM checks × 1,325.47 = 11,929.23; + 667 on Dec 18
    expect(r.lines.find((l) => l.id === "ibm")).toMatchObject({ ahead: 11929.23, aheadCount: 9 });
    expect(r.ahead).toBe(12596.23);
    expect(r.total).toBe(25924.52);
    expect(r.aheadByMonth.slice(9)).toEqual([1325.47, 5301.88, 5968.88]);
  });
  it("a one-time payment that's already due but has no deposit is flagged, not counted", () => {
    expect(r.lines.find((l) => l.id === "bonus")).toMatchObject({ received: 0, ahead: 0, total: 0 });
    expect(r.lines.find((l) => l.id === "bonus")!.flag).toMatch(/No deposit of \$10,200\.00 around 2026-07-01/);
  });
});

describe("paychecks missing from your statements", () => {
  it("paydays between the first and last deposit with no deposit nearby are estimated (Tampa: Jan 30 and Feb 13 missing)", () => {
    const tampa: Profile = { ...profile, incomes: [{ id: "t", name: "Tampa Brass", amount: 1365.12, frequency: "biweekly", kind: "salary", payDay: 5, firstPayDate: "2026-01-16", lastPayDate: "2026-04-24", employmentStart: "2026-01-08", employmentEnd: "2026-04-08" }] };
    const dep = (date: string, amount: number) => ({ date, description: "REGIS GROUP DES:PAYROLL", amount, category: "Income" });
    // Mar 30 (Mon) counts for the Mar 27 payday (within 3 days)
    const r = yearIncome(tampa, [dep("2026-01-16", 138.52), dep("2026-02-27", 1521.93), dep("2026-03-13", 1365.12), dep("2026-03-30", 1000), dep("2026-04-03", 432.91), dep("2026-04-10", 1303.8), dep("2026-04-24", 486.49), { date: "2026-10-26", description: "UBER", amount: -5, category: "Transportation" }], 2026);
    const l = r.lines[0]!;
    expect(l).toMatchObject({ received: 6248.77, estimated: 2730.24, estimatedDates: ["2026-01-30", "2026-02-13"], ahead: 0 });
    expect(l.total).toBe(8979.01); // 6,248.77 + 2 × 1,365.12
    expect(r.total).toBe(8979.01);
  });
});
