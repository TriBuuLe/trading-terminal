import { describe, expect, it } from "vitest";
import { rollForward, rollMonth } from "@/lib/planner/autoroll";
import type { Profile } from "@/lib/planner/types";

const base: Profile = {
  country: "US", region: "NC", age: 21, crossBorder: false,
  incomes: [{ id: "j", name: "Job", amount: 4000, frequency: "monthly", kind: "salary", startMonth: "2026-01" }],
  expenses: [{ id: "r", category: "Rent", monthly: 1000, kind: "need" }, { id: "f", category: "Fun", monthly: 200, kind: "want" }],
  debts: [{ id: "c", name: "Card", balance: 1200, aprPct: 12, minPayment: 100 }],
  accounts: [{ id: "chq", name: "Chequing", type: "CASH", balance: 1500 }],
  goals: [], risk: { horizonYears: 10, drawdownReaction: 3, incomeStability: 2, experience: 1 }, sandboxPct: 10, highInterestAprPct: 8,
  autoRoll: { enabled: true, cashAccountId: "chq", lastRolledMonth: "2026-10" },
};

describe("monthly auto-update", () => {
  it("one finished month, estimated from the plan (hand-computed)", () => {
    // Card: 1,200 + 1% interest (12) = 1,212 − 100 payment = 1,112
    // Chequing: 1,500 + 4,000 income − 1,200 spending − 100 card payment = 4,200
    // Net worth: 4,200 − 1,112 = 3,088
    const { profile, entry } = rollMonth(base, "2026-11");
    expect(entry).toEqual({ month: "2026-11", source: "estimated", income: 4000, spending: 1200, debtPayments: 100, debtInterest: 12, cashAfter: 4200, debtAfter: 1112, netWorth: 3088 });
    expect(profile.autoRoll!.lastRolledMonth).toBe("2026-11");
  });

  it("uses imported transactions for that month when available", () => {
    const { entry } = rollMonth(base, "2026-11", { income: 3900, spending: 1450 });
    expect(entry).toMatchObject({ source: "actual", income: 3900, spending: 1450, cashAfter: 1500 + 3900 - 1450 - 100 });
    // Only a credit card imported (no paycheck in the data): take-home from the plan (4,000) + the card's refunds/credits (25)
    const card = rollMonth(base, "2026-11", { income: 25, spending: 1450, hasPaycheck: false }).entry;
    expect(card).toMatchObject({ source: "actual", income: 4025, spending: 1450 });
  });

  it("only rolls months that have ENDED, and each month once (idempotent)", () => {
    // Today is Jan 2027 → finished months after Oct 2026: Nov, Dec
    const a = rollForward(base, "2027-01");
    expect(a.entries.map((e) => e.month)).toEqual(["2026-11", "2026-12"]);
    const again = rollForward(a.profile, "2027-01");
    expect(again.entries).toEqual([]); // running twice does nothing
    expect(rollForward(base, "2026-11").entries).toEqual([]); // November isn't over yet
  });

  it("does nothing when disabled or the account is gone", () => {
    expect(rollForward({ ...base, autoRoll: { ...base.autoRoll!, enabled: false } }, "2027-06").entries).toEqual([]);
    expect(rollForward({ ...base, accounts: [] }, "2027-06").entries).toEqual([]);
  });

  it("a paid-off debt stops taking payments", () => {
    const tiny = { ...base, debts: [{ id: "c", name: "Card", balance: 50, aprPct: 12, minPayment: 100 }] };
    const { entry } = rollMonth(tiny, "2026-11");
    expect(entry.debtPayments).toBe(50.5); // 50 + 0.50 interest, not the full 100
    expect(entry.debtAfter).toBe(0);
  });
});
