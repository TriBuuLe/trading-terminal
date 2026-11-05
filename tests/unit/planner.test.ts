import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS } from "@/lib/planner/assumptions";
import {
  averageIncome,
  cashFlow,
  cutSuggestions,
  deflate,
  emergencyFundTarget,
  feeDrag,
  goalMix,
  incomeInMonth,
  inflate,
  monthlyEquivalent,
  overrideWarning,
  payoff,
  requiredMonthly,
  riskScore,
} from "@/lib/planner/core";
import { simulate } from "@/lib/planner/montecarlo";
import { buildPlan } from "@/lib/planner/plan";
import type { Assumptions, Profile } from "@/lib/planner/types";

describe("income", () => {
  it("converts pay frequencies to monthly", () => {
    expect(monthlyEquivalent(2000, "biweekly")).toBeCloseTo((2000 * 26) / 12, 6); // 4333.33
    expect(monthlyEquivalent(1000, "weekly")).toBeCloseTo((1000 * 52) / 12, 6);
    expect(monthlyEquivalent(60000, "annual")).toBe(5000);
  });
  it("co-op terms: income only inside the window; 12-month average smooths it", () => {
    const coop = [{ id: "c", name: "Co-op", amount: 3000, frequency: "monthly" as const, kind: "coop" as const, startMonth: "2027-01", endMonth: "2027-04" }];
    expect(incomeInMonth(coop, "2026-12")).toBe(0);
    expect(incomeInMonth(coop, "2027-02")).toBe(3000);
    // 4 months × 3000 over 12 months = 1000/month
    expect(averageIncome(coop, "2027-01", 12)).toBe(1000);
  });
});

describe("cash flow", () => {
  const ex = [
    { id: "1", category: "Rent", monthly: 1200, kind: "need" as const },
    { id: "2", category: "Groceries", monthly: 400, kind: "need" as const },
    { id: "3", category: "Dining out", monthly: 300, kind: "want" as const },
    { id: "4", category: "Subscriptions", monthly: 60, kind: "want" as const },
  ];
  it("income → needs → wants → debt minimums → available", () => {
    const cf = cashFlow(3000, ex, [{ id: "d", name: "Card", balance: 2000, aprPct: 20, minPayment: 100 }]);
    expect(cf).toMatchObject({ needs: 1600, wants: 360, debtMinimums: 100, available: 940, guideline: { needs: 1500, wants: 900, savings: 600 } });
    expect(cf.savingsRatePct).toBeCloseTo(31.33, 2);
  });
  it("suggests cutting the biggest wants first, at most half of each", () => {
    // gap 200: dining 300 → cut 150; subscriptions 60 → cut 30 … still 20 short: stop after categories run out
    expect(cutSuggestions(ex, 200)).toEqual([
      { category: "Dining out", cut: 150 },
      { category: "Subscriptions", cut: 30 },
    ]);
    expect(cutSuggestions(ex, 100)).toEqual([{ category: "Dining out", cut: 100 }]);
  });
});

describe("required monthly contribution", () => {
  it("no return: straight line", () => {
    expect(requiredMonthly(12000, 0, 24, 0)).toBe(500);
  });
  it("12%/yr (1%/mo), 12 months, from 0: 788.49", () => {
    // PMT = 10000 × 0.01 / (1.01^12 − 1) = 100 / 0.126825 = 788.49
    expect(requiredMonthly(10000, 0, 12, 12)).toBe(788.49);
  });
  it("with a starting balance: 344.24", () => {
    // 5000 × 1.01^12 = 5634.13; (10000 − 5634.13) × 0.01 / 0.126825 = 344.24
    expect(requiredMonthly(10000, 5000, 12, 12)).toBe(344.24);
  });
  it("already funded → 0", () => {
    expect(requiredMonthly(1000, 2000, 12, 5)).toBe(0);
  });
});

describe("debt payoff", () => {
  it("single loan: $1,200 at 12% APR, $100/month → 13 months, $84.78 interest", () => {
    // After 12 payments: 1200·1.01^12 − 100·(1.01^12 − 1)/0.01 = 1352.19 − 1268.25 = 83.94
    // Month 13: 83.94 + 0.84 interest = 84.78 paid. Total paid 1284.78 → interest 84.78.
    const r = payoff([{ id: "a", name: "Loan", balance: 1200, aprPct: 12, minPayment: 100 }], 0, "avalanche");
    expect(r.months).toBe(13);
    expect(r.totalInterest).toBeCloseTo(84.78, 1);
  });
  it("avalanche pays the highest rate first and saves interest vs snowball", () => {
    const debts = [
      { id: "1", name: "Card 24%", balance: 3000, aprPct: 24, minPayment: 60 },
      { id: "2", name: "Car 6%", balance: 800, aprPct: 6, minPayment: 40 },
    ];
    const av = payoff(debts, 200, "avalanche");
    const sb = payoff(debts, 200, "snowball");
    expect(av.order[0]).toBe("Card 24%");
    expect(sb.order[0]).toBe("Car 6%");
    expect(av.totalInterest).toBeLessThan(sb.totalInterest);
  });
});

describe("emergency fund, risk, mix, inflation, fees", () => {
  it("emergency fund scales with income stability", () => {
    expect(emergencyFundTarget(2000, 3)).toEqual({ months: 3, full: 6000, starter: 2000 });
    expect(emergencyFundTarget(2000, 2)).toEqual({ months: 4.5, full: 9000, starter: 2000 });
    expect(emergencyFundTarget(500, 1)).toEqual({ months: 6, full: 3000, starter: 1000 });
  });
  it("risk score range and override warning", () => {
    expect(riskScore({ horizonYears: 20, drawdownReaction: 4, incomeStability: 3, experience: 3 })).toBe(10);
    expect(riskScore({ horizonYears: 1, drawdownReaction: 1, incomeStability: 1, experience: 1 })).toBe(1);
    const timid = { horizonYears: 2, drawdownReaction: 1 as const, incomeStability: 1 as const, experience: 1 as const };
    expect(overrideWarning(timid, 9)).toMatch(/suggest a risk score of 1/);
    expect(overrideWarning(timid, 2)).toBeNull();
  });
  it("time-horizon matching: no stocks for money needed within 3 years", () => {
    expect(goalMix(2.9, 0.9)).toEqual({ equity: 0, bonds: 0, cash: 1 });
    expect(goalMix(5, 0.9)).toEqual({ equity: 0.3, bonds: 0.6, cash: 0.1 });
    expect(goalMix(30, 0.8)).toEqual({ equity: 0.8, bonds: 0.2, cash: 0 });
    expect(goalMix(30, 0.3).equity).toBe(0.3); // risk score caps it
  });
  it("inflation adjustment round-trips", () => {
    expect(inflate(100, 2, 2.5)).toBeCloseTo(105.0625, 6);
    expect(deflate(105.0625, 2, 2.5)).toBeCloseTo(100, 6);
  });
  it("fee drag: 0.25% over 30 years at 5% costs ~6.9% of the ending balance", () => {
    expect(feeDrag(5, 0.25, 30)).toBeCloseTo((1 - (1.0475 / 1.05) ** 30) * 100, 1);
  });
});

const flat: Assumptions = {
  ...DEFAULT_ASSUMPTIONS,
  classes: {
    equity: { ...DEFAULT_ASSUMPTIONS.classes.equity, realReturnPct: 0, volatilityPct: 0 },
    bonds: { ...DEFAULT_ASSUMPTIONS.classes.bonds, realReturnPct: 0, volatilityPct: 0 },
    cash: { ...DEFAULT_ASSUMPTIONS.classes.cash, realReturnPct: 0, volatilityPct: 0 },
  },
};
const sixty = () => ({ equity: 0.6, bonds: 0.4, cash: 0 });

describe("Monte Carlo", () => {
  it("is deterministic for a fixed seed", () => {
    const run = (seed: number) => simulate({ current: 10000, monthlyContribution: 200, months: 120, mixAt: sixty, assumptions: DEFAULT_ASSUMPTIONS, runs: 2000, seed });
    expect(run(7).p50).toBe(run(7).p50);
    expect(run(7).p50).not.toBe(run(8).p50);
  });
  it("with zero return and zero volatility equals simple saving", () => {
    const r = simulate({ current: 1000, monthlyContribution: 100, months: 12, mixAt: sixty, assumptions: flat, runs: 100 });
    expect(r.p10).toBeCloseTo(2200, 6);
    expect(r.p90).toBeCloseTo(2200, 6);
  });
  it("probability sanity: huge surplus ≈ 100%, impossible ≈ 0%", () => {
    const base = { current: 0, months: 60, mixAt: sixty, assumptions: DEFAULT_ASSUMPTIONS, runs: 5000 };
    expect(simulate({ ...base, monthlyContribution: 1000, target: 10_000 }).probability).toBeGreaterThan(0.99);
    expect(simulate({ ...base, monthlyContribution: 10, target: 100_000 }).probability).toBeLessThan(0.01);
  });
  it("p10 ≤ p50 ≤ p90 and bands start at the current value", () => {
    const r = simulate({ current: 5000, monthlyContribution: 100, months: 240, mixAt: sixty, assumptions: DEFAULT_ASSUMPTIONS, runs: 2000 });
    expect(r.p10).toBeLessThanOrEqual(r.p50);
    expect(r.p50).toBeLessThanOrEqual(r.p90);
    expect(r.bands[0]).toEqual({ year: 0, p10: 5000, p50: 5000, p90: 5000 });
    expect(r.bands).toHaveLength(21);
  });
});

const base: Profile = {
  country: "CA",
  region: "ON",
  age: 21,
  crossBorder: false,
  incomes: [{ id: "i", name: "Job", amount: 3000, frequency: "monthly", kind: "salary" }],
  expenses: [
    { id: "e1", category: "Rent", monthly: 1000, kind: "need" },
    { id: "e2", category: "Fun", monthly: 400, kind: "want" },
  ],
  debts: [],
  accounts: [],
  goals: [],
  risk: { horizonYears: 20, drawdownReaction: 3, incomeStability: 2, experience: 2 },
  sandboxPct: 10,
  highInterestAprPct: 8,
};

describe("priority waterfall", () => {
  it("fills the starter emergency fund first", () => {
    // available = 3000 − 1000 − 400 = 1600; starter = max(1000, 1000) = 1000 → 1000; then full EF gets the rest
    const p = buildPlan(base, DEFAULT_ASSUMPTIONS, "2026-11", { runs: 200 });
    expect(p.cashFlow.available).toBe(1600);
    expect(p.waterfall.map((s) => [s.key, s.monthly])).toEqual([
      ["starter_ef", 1000],
      ["match", 0],
      ["high_interest_debt", 0],
      ["full_ef", 600],
      ["goals", 0],
      ["invest", 0],
    ]);
  });
  it("high-interest debt comes before the full emergency fund", () => {
    const p = buildPlan(
      // essentials = rent 1000 + card minimum 100 → starter fund = 1100; savings 1500 covers it
      { ...base, accounts: [{ id: "a", name: "Savings", type: "HISA", balance: 1500 }], debts: [{ id: "d", name: "Card", balance: 5000, aprPct: 20, minPayment: 100 }] },
      DEFAULT_ASSUMPTIONS,
      "2026-11",
      { runs: 200 },
    );
    // available = 1600 − 100 min = 1500; starter met → all 1500 to the card
    expect(p.waterfall.find((s) => s.key === "starter_ef")!.status).toBe("done");
    expect(p.waterfall.find((s) => s.key === "high_interest_debt")!.monthly).toBe(1500);
    expect(p.waterfall.find((s) => s.key === "full_ef")!.monthly).toBe(0);
  });
  it("with the basics done, money flows to goals then long-term investing", () => {
    const p = buildPlan(
      {
        ...base,
        accounts: [{ id: "a", name: "Savings", type: "HISA", balance: 10_000 }],
        goals: [{ id: "g", name: "Car", kind: "car", target: 12_000, targetDate: "2028-11", priority: 1, current: 0 }],
      },
      DEFAULT_ASSUMPTIONS,
      "2026-11",
      { runs: 500 },
    );
    const car = p.goals[0]!;
    // 24 months away → short horizon → 100% cash at 0.5% real: PMT ≈ 12000·r/((1+r)^24−1), r = 0.005/12
    expect(car.band).toBe("short");
    expect(car.account.type).toBe("HISA");
    expect(car.requiredMonthly).toBeCloseTo(requiredMonthly(12_000, 0, 24, 0.5), 2);
    expect(car.allocatedMonthly).toBe(car.requiredMonthly);
    expect(p.waterfall.find((s) => s.key === "invest")!.monthly).toBeCloseTo(1600 - car.requiredMonthly, 2);
    expect(car.onTrack).toBe(true);
    expect(p.sandbox.monthly).toBeCloseTo((1600 - car.requiredMonthly) * 0.1, 2);
  });
  it("flags cross-border profiles", () => {
    expect(buildPlan({ ...base, crossBorder: true }, DEFAULT_ASSUMPTIONS, "2026-11", { runs: 100 }).crossBorderWarning).toMatch(/PFIC/);
  });
});

import { profileInputSchema, profileProblems } from "@/lib/planner/schema";

describe("profile validation", () => {
  it("rejects an income that ends before it starts (it would silently count as $0)", () => {
    const bad = { ...base, incomes: [{ id: "c", name: "Co-op", amount: 5300, frequency: "monthly" as const, kind: "coop" as const, startMonth: "2027-09", endMonth: "2026-12" }] };
    expect(profileProblems(bad)).toHaveLength(1);
    expect(profileInputSchema.safeParse(bad).success).toBe(false);
    const ok = { ...bad, incomes: [{ ...bad.incomes[0]!, startMonth: "2026-09", endMonth: "2026-12" }] };
    expect(profileProblems(ok)).toHaveLength(0);
    expect(profileInputSchema.safeParse(ok).success).toBe(true);
  });
});

import { incomeTimeline, isActive } from "@/lib/planner/core";

describe("repeating co-op terms", () => {
  const term = (start: string, end: string, repeats = true) => ({ id: "t", name: "Co-op", amount: 5300, frequency: "monthly" as const, kind: "coop" as const, startMonth: start, endMonth: end, repeatsYearly: repeats });
  it("a Sep–Dec term counts every fall once it starts", () => {
    const t = term("2026-09", "2026-12");
    expect(isActive(t, "2026-11")).toBe(true);
    expect(isActive(t, "2027-03")).toBe(false);
    expect(isActive(t, "2027-10")).toBe(true);
    expect(isActive(t, "2026-08")).toBe(false); // before the first term
    // From Nov 2026: Nov, Dec 2026 + Sep, Oct 2027 = 4 months × 5,300 / 12 = 1,766.67
    expect(averageIncome([t], "2026-11", 12)).toBeCloseTo(1766.67, 2);
  });
  it("wraps across New Year (Nov–Feb)", () => {
    const t = term("2026-11", "2027-02");
    expect(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"].map((m) => isActive(t, m))).toEqual([true, true, true, true, false]);
  });
  it("three back-to-back yearly terms cover the whole year", () => {
    const streams = [term("2026-01", "2026-04"), { ...term("2026-05", "2026-08"), id: "b", amount: 4000 }, { ...term("2026-09", "2026-12"), id: "c", amount: 3000 }];
    // every month has one term: (4×5,300 + 4×4,000 + 4×3,000) / 12 = 4,100
    expect(averageIncome(streams, "2026-11", 12)).toBeCloseTo(4100, 6);
    expect(incomeTimeline(streams, "2026-11", 12).every((m) => m.amount > 0)).toBe(true);
  });
  it("a one-off term that already ended counts nothing", () => {
    expect(averageIncome([term("2026-05", "2026-08", false)], "2026-11", 12)).toBe(0);
  });
});
