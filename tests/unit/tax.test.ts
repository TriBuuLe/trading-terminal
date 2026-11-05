import { describe, expect, it } from "vitest";
import { bracketTax, yearTax } from "@/lib/tax/calc";
import { TAX_YEARS } from "@/lib/tax/rules";

const r = TAX_YEARS[2026]!;

describe("federal brackets (Rev. Proc. 2025-32)", () => {
  it("matches the IRS table's own base amounts at each threshold", () => {
    // The table states e.g. "Over $50,400 … $5,800 plus 22%", "Over $105,700 … $17,966 plus 24%", "Over $640,600 … $192,979.25 plus 37%"
    expect(bracketTax(50_400, r.federal.brackets.single).tax).toBe(5_800);
    expect(bracketTax(105_700, r.federal.brackets.single).tax).toBe(17_966);
    expect(bracketTax(640_600, r.federal.brackets.single).tax).toBe(192_979.25);
    expect(bracketTax(100_800, r.federal.brackets.mfj).tax).toBe(11_600);
    expect(bracketTax(768_700, r.federal.brackets.mfj).tax).toBe(206_583.5);
    expect(bracketTax(67_450, r.federal.brackets.hoh).tax).toBe(7_740);
    expect(bracketTax(384_350, r.federal.brackets.mfs).tax).toBe(103_291.75);
  });
});

describe("gross → take-home (2026, North Carolina)", () => {
  it("single, $60,000 salary (hand-computed)", () => {
    // Federal: 60,000 − 16,100 = 43,900 taxable → 1,240 + 12% × 31,500 = 5,020
    // FICA: 60,000 × 7.65% = 3,720 + 870 = 4,590
    // NC: (60,000 − 12,750) × 3.99% = 1,885.28
    // Take-home: 60,000 − 5,020 − 4,590 − 1,885.28 = 48,504.72
    const t = yearTax({ year: 2026, grossWages: 60_000, filingStatus: "single", state: "NC" });
    expect(t).toMatchObject({ federal: 5020, socialSecurity: 3720, medicare: 870, additionalMedicare: 0, state: 1885.28, net: 48_504.72 });
    expect(t.marginalPct).toBe(15.99); // 12% federal + 3.99% NC
  });

  it("a 4-month co-op at $5,300/month owes far less tax for the year", () => {
    // 21,200 gross: federal (21,200 − 16,100) × 10% = 510; FICA 1,314.40 + 307.40; NC (21,200 − 12,750) × 3.99% = 337.16
    // Take-home: 21,200 − 510 − 1,621.80 − 337.16 = 18,731.04
    const t = yearTax({ year: 2026, grossWages: 21_200, filingStatus: "single", state: "NC" });
    expect(t).toMatchObject({ federal: 510, socialSecurity: 1314.4, medicare: 307.4, state: 337.16, net: 18_731.04 });
  });

  it("Social Security stops at the wage base; Additional Medicare above $200k", () => {
    const t = yearTax({ year: 2026, grossWages: 250_000, filingStatus: "single", state: "NC" });
    expect(t.socialSecurity).toBe(11_439); // 184,500 × 6.2%
    expect(t.medicare).toBe(3_625); // 250,000 × 1.45%
    expect(t.additionalMedicare).toBe(450); // 50,000 × 0.9%
  });

  it("pre-tax 401(k) lowers income tax but not FICA", () => {
    const a = yearTax({ year: 2026, grossWages: 60_000, filingStatus: "single", state: "NC" });
    const b = yearTax({ year: 2026, grossWages: 60_000, filingStatus: "single", state: "NC", pretaxDeductions: 5_000 });
    expect(b.federal).toBe(a.federal - 600); // 5,000 × 12%
    expect(b.socialSecurity).toBe(a.socialSecurity);
    expect(b.state).toBeCloseTo(a.state! - 199.5, 2); // 5,000 × 3.99%
  });

  it("unverified states and future years are flagged, not guessed", () => {
    expect(yearTax({ year: 2026, grossWages: 50_000, filingStatus: "single", state: "CA" }).notes.join(" ")).toMatch(/isn't modeled/);
    expect(yearTax({ year: 2026, grossWages: 50_000, filingStatus: "single", state: "CA", stateRateOverridePct: 5 }).state).toBe(2500);
    expect(yearTax({ year: 2027, grossWages: 50_000, filingStatus: "single", state: "NC" }).notes.join(" ")).toMatch(/2027 tax tables/);
  });
});

import { netIncome } from "@/lib/planner/net";
import { monthlyEquivalent } from "@/lib/planner/core";
import type { Profile } from "@/lib/planner/types";

describe("before-tax income in the plan", () => {
  const profile = (incomes: Profile["incomes"]): Profile => ({
    country: "US", region: "NC", age: 21, crossBorder: false, incomes, expenses: [], debts: [], accounts: [], goals: [],
    risk: { horizonYears: 10, drawdownReaction: 3, incomeStability: 2, experience: 1 }, sandboxPct: 10, highInterestAprPct: 8, tax: { filingStatus: "single" },
  });
  it("hourly pay: $25/hr × 40 h/week = $4,333.33/month", () => {
    expect(monthlyEquivalent(25, "hourly", 40)).toBeCloseTo(4333.33, 2);
  });
  it("a $60,000 salary all year → $48,504.72 take-home → $4,042.06/month", () => {
    const n = netIncome(profile([{ id: "s", name: "Job", amount: 5000, frequency: "monthly", kind: "salary", basis: "gross", startMonth: "2026-01" }]), "2026-01", 12);
    expect(n.average).toBeCloseTo(48_504.72 / 12, 1);
    expect(n.taxes[0]!.net).toBe(48_504.72);
  });
  it("a short co-op year is taxed as a short year (not as if annualized)", () => {
    // Sep–Dec 2026 at $5,300 gross = 21,200 for 2026 → 18,731.04 take-home (88.4%), not the ~79% a full-year salary keeps
    const n = netIncome(profile([{ id: "c", name: "IBM", amount: 5300, frequency: "monthly", kind: "coop", basis: "gross", startMonth: "2026-09", endMonth: "2026-12" }]), "2026-11", 12);
    expect(n.byMonth[0]!.amount).toBeCloseTo(5300 * (18_731.04 / 21_200), 1);
    expect(n.byMonth[2]!.amount).toBe(0); // Jan 2027: nothing entered
  });
  it("take-home lines are used as entered", () => {
    expect(netIncome(profile([{ id: "n", name: "Job", amount: 3000, frequency: "monthly", kind: "salary" }]), "2026-11", 12).average).toBe(3000);
  });
});
