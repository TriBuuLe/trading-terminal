import { describe, expect, it } from "vitest";
import { creditPaychecks, ensureYearPlan, noteBalanceEdit, syncPayDates, withPlanExpenses } from "@/lib/planner/sync";
import type { Profile } from "@/lib/planner/types";

const base: Profile = {
  country: "US", region: "NC", age: 21, crossBorder: false,
  incomes: [{ id: "ibm", name: "IBM", amount: 1325.47, frequency: "weekly", kind: "coop", basis: "net", payDay: 5, employmentStart: "2026-09-08", employmentEnd: "2026-12-11" }],
  expenses: [{ id: "r", category: "Rent", monthly: 880, kind: "need" }],
  debts: [], accounts: [{ id: "c", name: "Chequing", type: "CASH", balance: 3094.33 }], goals: [],
  risk: { horizonYears: 10, drawdownReaction: 3, incomeStability: 2, experience: 1 }, sandboxPct: 10, highInterestAprPct: 8,
  cashSync: { enabled: true, accountId: "c", balanceAsOf: "2026-11-05", credited: [] },
};
const pay = (id: number, date: string, amount = 1325.47) => ({ id, date, description: "IBM 3141 DES:PAYROLL ID:1000", amount, category: "Income" });

describe("paycheck deposits update the chequing balance", () => {
  it("adds deposits after the balance date, once each; older ones are already in the balance", () => {
    const txs = [pay(1, "2026-10-30"), pay(2, "2026-11-06"), { id: 3, date: "2026-11-07", description: "Zelle payment from MAX", amount: 20, category: "Income" }];
    const r = creditPaychecks(base, txs);
    expect(r.credited).toEqual([{ id: 2, date: "2026-11-06", amount: 1325.47 }]); // Oct 30 is before Nov 5; Zelle isn't a paycheck
    expect(r.profile.accounts[0]!.balance).toBe(4419.8); // 3,094.33 + 1,325.47
    // Importing the same statement again: nothing more
    const again = creditPaychecks(r.profile, txs);
    expect(again.credited).toEqual([]);
    expect(again.profile.accounts[0]!.balance).toBe(4419.8);
  });

  it("does nothing when off; typing a new balance moves the balance date to today", () => {
    expect(creditPaychecks({ ...base, cashSync: { ...base.cashSync!, enabled: false } }, [pay(2, "2026-11-06")]).credited).toEqual([]);
    const edited = { ...base, accounts: [{ ...base.accounts[0]!, balance: 3500 }] };
    expect(noteBalanceEdit(base, edited, "2026-11-20").cashSync!.balanceAsOf).toBe("2026-11-20");
    expect(noteBalanceEdit(base, base, "2026-11-20").cashSync!.balanceAsOf).toBe("2026-11-05");
  });
});

describe("first / last paycheck from deposits", () => {
  it("fills them from the employer's payroll deposits", () => {
    const fridays = ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"];
    const p = syncPayDates(base, [...fridays.map((d, k) => pay(k, d)), { id: 9, date: "2026-10-06", description: "UBER", amount: -5, category: "Transportation" }]);
    expect(p.incomes[0]).toMatchObject({ firstPayDate: "2026-09-11", lastPayDate: null, payDatesFromDeposits: true }); // still coming
  });
});

describe("a fresh plan each January", () => {
  it("creates this year's plan from your budget; next year copies it; old plans stay", () => {
    const a = ensureYearPlan(base, 2026, "2026-11-05");
    expect(a.changed).toBe(true);
    expect(a.profile.yearPlans!["2026"]!.budget).toEqual([{ category: "Rent", kind: "need", months: Array.from({ length: 12 }, () => 880) }]);
    expect(ensureYearPlan(a.profile, 2026, "2026-11-06").changed).toBe(false);
    const b = ensureYearPlan({ ...a.profile, accounts: [{ ...base.accounts[0]!, balance: 7000 }] }, 2027, "2027-01-02");
    expect(Object.keys(b.profile.yearPlans!)).toEqual(["2026", "2027"]);
    expect(b.profile.yearPlans!["2027"]!.opening.accounts[0]!.balance).toBe(7000);
    expect(withPlanExpenses(b.profile).expenses).toEqual([
      { id: "y2026:Rent:1", category: "Rent", kind: "need", monthly: 880, startMonth: "2026-01", endMonth: "2026-12" },
      { id: "y2027:Rent:1", category: "Rent", kind: "need", monthly: 880, startMonth: "2027-01", endMonth: "2027-12" },
    ]);
  });

  it("the old month-end estimate turns into deposit-based updates", () => {
    const old = { ...base, cashSync: undefined, autoRoll: { enabled: true, cashAccountId: "c", lastRolledMonth: "2026-10" } };
    const r = ensureYearPlan(old, 2026, "2026-11-05").profile;
    expect(r.autoRoll!.enabled).toBe(false);
    expect(r.cashSync).toEqual({ enabled: true, accountId: "c", balanceAsOf: "2026-11-05", credited: [] });
  });
});
