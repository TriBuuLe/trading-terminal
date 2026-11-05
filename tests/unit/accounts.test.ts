import { describe, expect, it } from "vitest";
import {
  assetLocation,
  checkRothContribution,
  fhsaRoom,
  fiveYearMet,
  hsaLimit,
  k401Limit,
  proposeBuys,
  rothLimit,
  rothTaxYearsOpen,
  rothWithdrawal,
  rrspDeductionLimit,
  rrspExcess,
  tfsaRoom,
} from "@/lib/accounts/engine";
import { defaultBook, MissingRuleError, rule } from "@/lib/accounts/rules";

const book = defaultBook();
const roth = (o: Partial<Parameters<typeof rothLimit>[1]> = {}) =>
  rothLimit(book, { taxYear: 2026, age: 30, filingStatus: "single", magi: 60_000, earnedIncome: 60_000, otherIraContributions: 0, ...o });

describe("Roth IRA contribution limit (IRS Pub 590-A Worksheet 2-2)", () => {
  it("reproduces the IRS's own 2025 worked example: MAGI $151,000 single → $6,540", () => {
    // line3 = 1,000; line5 = 1,000/15,000 = 0.067; line7 = 0.067 × 7,000 = 469; 7,000 − 469 = 6,531 → round UP to 6,540
    expect(roth({ taxYear: 2025, magi: 151_000 }).limit).toBe(6540);
  });
  it("2026 full limit, catch-up at 50, partial and full phase-out", () => {
    expect(roth().limit).toBe(7500);
    expect(roth({ age: 50 }).limit).toBe(8600);
    // (160,500 − 153,000)/15,000 = 0.5 → 7,500 × 0.5 = 3,750
    expect(roth({ magi: 160_500 }).limit).toBe(3750);
    expect(roth({ magi: 160_500 }).phaseOut).toBe("partial");
    expect(roth({ magi: 168_000 })).toMatchObject({ limit: 0, phaseOut: "full" });
    // MFJ range 242,000–252,000: 247,000 → 0.5 → 3,750
    expect(roth({ filingStatus: "mfj", magi: 247_000 }).limit).toBe(3750);
  });
  it("$200 minimum near the top of the range", () => {
    // (167,800 − 153,000)/15,000 = 0.98667 → 0.987 × 7,500 = 7,402.50 → 97.50 → round up 100 → raised to 200
    expect(roth({ magi: 167_800 }).limit).toBe(200);
  });
  it("capped by earned income and shared with other IRA contributions", () => {
    expect(roth({ earnedIncome: 3000 }).limit).toBe(3000); // e.g. a student's summer job
    expect(roth({ otherIraContributions: 2000 }).limit).toBe(5500);
  });
  it("flags an excess contribution and the 6%/year tax", () => {
    const c = checkRothContribution(book, { taxYear: 2026, age: 30, filingStatus: "single", magi: 60_000, earnedIncome: 60_000, otherIraContributions: 0, alreadyThisYear: 7000, amount: 1000 });
    expect(c).toMatchObject({ allowed: 500, excess: 500, excessTaxPerYear: 30, ok: false });
  });
  it("prior tax year stays open until the April filing deadline", () => {
    expect(rothTaxYearsOpen(new Date("2026-03-01T12:00:00Z"))).toEqual([2025, 2026]);
    expect(rothTaxYearsOpen(new Date("2026-04-16T12:00:00Z"))).toEqual([2026]);
  });
  it("5-year clock starts Jan 1 of the first contribution tax year", () => {
    expect(fiveYearMet(2021, 2026)).toBe(true);
    expect(fiveYearMet(2022, 2026)).toBe(false);
    expect(fiveYearMet(null, 2026)).toBe(false);
  });
});

describe("Roth withdrawals (Pub 590-B ordering)", () => {
  const w = (o: Partial<Parameters<typeof rothWithdrawal>[1]>) =>
    rothWithdrawal(book, { amount: 12_000, contributionBasis: 10_000, accountValue: 13_000, age: 30, year: 2026, firstContributionTaxYear: 2022, marginalTaxPct: 22, ...o });
  it("contributions first, then earnings; non-qualified earnings taxed + 10% under 59½", () => {
    // 10,000 from contributions; 2,000 earnings × 22% = 440 tax + 10% = 200 → 640
    expect(w({})).toMatchObject({ fromContributions: 10_000, fromEarnings: 2000, qualified: false, incomeTax: 440, additionalTax: 200, totalCost: 640 });
  });
  it("withdrawing only contributions costs nothing", () => {
    expect(w({ amount: 8000 })).toMatchObject({ fromEarnings: 0, totalCost: 0 });
  });
  it("qualified at 59½ with the 5-year period met; over 59½ but under 5 years → tax, no 10%", () => {
    expect(w({ age: 60, firstContributionTaxYear: 2020 })).toMatchObject({ qualified: true, totalCost: 0 });
    expect(w({ age: 60, firstContributionTaxYear: 2023 })).toMatchObject({ qualified: false, incomeTax: 440, additionalTax: 0 });
  });
});

describe("TFSA room (CRA)", () => {
  it("someone 18+ since 2009 has $109,000 of cumulative limits through 2026", () => {
    // 4×5,000 + 2×5,500 + 10,000 + 3×5,500 + 4×6,000 + 6,500 + 3×7,000 = 109,000
    expect(tfsaRoom(book, { year: 2026, birthYear: 1980, contributionsByYear: {}, withdrawalsByYear: {} }).room).toBe(109_000);
  });
  it("carries forward unused room; withdrawals come back the NEXT January", () => {
    // Turned 18 in 2023: 6,500 + 7,000 + 7,000 + 7,000 = 27,500; − 15,000 contributed + 3,000 (2025 withdrawal) = 15,500
    // The 2026 withdrawal (1,000) isn't added back until 2027.
    const r = tfsaRoom(book, { year: 2026, birthYear: 2005, contributionsByYear: { 2024: 10_000, 2026: 5_000 }, withdrawalsByYear: { 2025: 3_000, 2026: 1_000 } });
    expect(r).toEqual({ room: 15_500, cumulativeLimits: 27_500, contributed: 15_000, addedBack: 3_000 });
  });
});

describe("RRSP (CRA)", () => {
  it("18% of last year's earned income up to the dollar limit, plus unused room", () => {
    expect(rrspDeductionLimit(book, { year: 2026, unusedRoom: 5000, prevYearEarnedIncome: 50_000 }).limit).toBe(14_000); // 5,000 + 9,000
    expect(rrspDeductionLimit(book, { year: 2026, unusedRoom: 0, prevYearEarnedIncome: 300_000 }).newRoom).toBe(33_810); // capped
  });
  it("1%/month on excess above the $2,000 cushion", () => {
    expect(rrspExcess(book, 17_000, 14_000)).toEqual({ excess: 1000, taxPerMonth: 10, cushion: 2000 });
    expect(rrspExcess(book, 15_500, 14_000).excess).toBe(0);
  });
});

describe("FHSA (CRA)", () => {
  it("$8,000 first year, carryforward of unused room capped at $8,000, $40,000 lifetime", () => {
    // y1 room 8,000 (put in 5,000 → carry 3,000); y2 room 11,000 (put in 8,000 → carry 3,000); y3 room 11,000,
    // nothing put in → 11,000 unused, so the carryforward into year 4 is capped at 8,000
    expect(fhsaRoom(book, [5000, 8000, 0])).toEqual({ room: 11_000, carryforward: 8000, lifetimeLeft: 27_000, byYear: [8000, 11_000, 11_000] });
    // nothing contributed: 8,000 → 16,000 → 16,000 (carryforward capped at 8,000)
    expect(fhsaRoom(book, [0, 0, 0]).byYear).toEqual([8000, 16_000, 16_000]);
  });
});

describe("401(k) and HSA (IRS 2026)", () => {
  it("401(k) limits with catch-ups", () => {
    expect(k401Limit(book, 2026, 30)).toBe(24_500);
    expect(k401Limit(book, 2026, 55)).toBe(32_500);
    expect(k401Limit(book, 2026, 61)).toBe(35_750); // 60–63 super catch-up
  });
  it("HSA limits", () => {
    expect(hsaLimit(book, 2026, "self", 40)).toBe(4400);
    expect(hsaLimit(book, 2026, "self", 56)).toBe(5400);
    expect(hsaLimit(book, 2026, "family", 40)).toBe(8750);
  });
  it("refuses to guess a year that wasn't verified", () => {
    expect(() => rule(book, "US", 2027, "ira.limit")).toThrow(MissingRuleError);
  });
});

describe("asset location (whole household)", () => {
  it("bonds to tax-deferred, stocks to Roth then taxable; combined hits the target", () => {
    const r = assetLocation(
      [
        { id: "roth", type: "ROTH_IRA", balance: 20_000 },
        { id: "trad", type: "TRADITIONAL_IRA", balance: 30_000 },
        { id: "tax", type: "TAXABLE", balance: 50_000 },
        { id: "cash", type: "HISA", balance: 5_000 }, // not part of the invested portfolio
      ],
      { us_equity: 0.6, intl_equity: 0.2, bonds: 0.2 },
    );
    const by = Object.fromEntries(r.perAccount.map((a) => [a.accountId, a.holdings]));
    expect(by).toEqual({
      roth: { us_equity: 20_000 },
      trad: { bonds: 20_000, intl_equity: 10_000 },
      tax: { us_equity: 40_000, intl_equity: 10_000 },
    });
    expect(r.combined).toEqual({ us_equity: 60_000, intl_equity: 20_000, bonds: 20_000 });
  });
});

describe("Fund my Roth: proposed buys", () => {
  it("fills the most underweight holdings first", () => {
    // after = 9,000 + 3,000 = 12,000 → targets VTI 7,200 (−1,200), VXUS 2,400 (−2,400), BND 2,400 (have 3,000)
    // deficits 3,600 ≥ cash 3,000 → VTI 1,000, VXUS 2,000
    const r = proposeBuys(3000, { VTI: 6000, BND: 3000 }, { VTI: 0.6, VXUS: 0.2, BND: 0.2 }, { VTI: 250, VXUS: 50, BND: 75 });
    expect(r.buys).toEqual([
      { symbol: "VTI", dollars: 1000, qty: 4, price: 250 },
      { symbol: "VXUS", dollars: 2000, qty: 40, price: 50 },
    ]);
    expect(r.leftover).toBe(0);
  });
  it("cash beyond the deficits is split by target weight", () => {
    expect(proposeBuys(100, {}, { A: 0.5, B: 0.5 }, { A: 10, B: 10 }).buys.map((b) => b.qty)).toEqual([5, 5]);
  });
});

import { wrapperValue } from "@/lib/accounts/projection";
import { DEFAULT_ASSUMPTIONS } from "@/lib/planner/assumptions";

describe("Roth/TFSA wrapper value", () => {
  it("flat 5% stocks, no volatility: tax-free vs taxable after dividend drag and capital-gains tax (hand-computed)", () => {
    const flat = {
      ...DEFAULT_ASSUMPTIONS,
      inflationPct: 0,
      classes: {
        equity: { ...DEFAULT_ASSUMPTIONS.classes.equity, realReturnPct: 5, volatilityPct: 0 },
        bonds: { ...DEFAULT_ASSUMPTIONS.classes.bonds, realReturnPct: 0, volatilityPct: 0 },
        cash: { ...DEFAULT_ASSUMPTIONS.classes.cash, realReturnPct: 0, volatilityPct: 0 },
      },
    };
    // $10,000 lump sum, 10 years, 100% stocks. Tax-free: 10,000 × 1.05^10 = 16,288.95
    // Taxable: return 5% − 2% yield × 25% = 4.5% → 10,000 × 1.045^10 = 15,529.69; gain 5,529.69 × 15% = 829.45 → 14,700.24
    const r = wrapperValue({ current: 10_000, monthly: 0, years: 10, mix: { equity: 1, bonds: 0, cash: 0 }, assumptions: flat, dividendYieldPct: 2, dividendTaxPct: 25, capitalGainsTaxPct: 15, runs: 50 });
    expect(r.taxFreeP50).toBeCloseTo(16_288.95, 0);
    expect(r.taxableP50AfterTax).toBeCloseTo(14_700.24, 0);
    expect(r.wrapperWorth).toBeCloseTo(1_588.71, 0);
  });
});
