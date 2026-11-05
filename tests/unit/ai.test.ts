import { describe, expect, it } from "vitest";
import { applyActions, describe as describeAction, parseActions, setAhead } from "@/lib/ai/actions";
import { ungroundedAmounts } from "@/lib/ai/grounding";
import { createRedactor } from "@/lib/ai/redact";
import type { Profile } from "@/lib/planner/types";

describe("redaction before anything goes to a cloud model", () => {
  it("people become Person A/B; numbers and emails go; names come back in the reply", () => {
    const r = createRedactor();
    const s = r.redact("Zelle payment to Akshit Kurani for July Rent; Zelle payment to Hau Le | card 4111 1111 1111 1111 | me@x.com | IBM 3141 DES:PAYROLL ID:1000200669");
    expect(s).not.toMatch(/Akshit|Kurani|Hau Le|4111|me@x\.com|1000200669/);
    expect(s).toMatch(/Zelle payment to Person A for July Rent/);
    expect(s).toMatch(/Person B/);
    expect(s).toMatch(/IBM/); // employers stay
    expect(r.restore("Person A was paid $1,052; Person B $1,500")).toBe("Akshit Kurani was paid $1,052; Hau Le $1,500");
  });
});

describe("proposed changes", () => {
  const profile: Profile = {
    country: "US", region: "NC", age: 21, crossBorder: false,
    incomes: [{ id: "i", name: "IBM", amount: 5300, frequency: "monthly", kind: "coop" }],
    expenses: [{ id: "r", category: "Rent", monthly: 880, kind: "need" }],
    debts: [], accounts: [{ id: "c", name: "Chequing", type: "CASH", balance: 5000 }], goals: [],
    risk: { horizonYears: 10, drawdownReaction: 3, incomeStability: 2, experience: 1 }, sandboxPct: 10, highInterestAprPct: 8,
  };

  it("parses the ```actions block, keeps valid changes, explains rejected ones", () => {
    const reply = 'Here is a plan.\n```actions\n[{"type":"set_budget","category":"Dining out","monthly":250,"kind":"want"},{"type":"set_budget","category":"Pizza","monthly":10},{"type":"set_targets","saveMonthly":500,"investMonthly":200}]\n```';
    const r = parseActions(reply);
    expect(r.text).toBe("Here is a plan.");
    expect(r.actions.map((a) => a.type)).toEqual(["set_budget", "set_targets"]);
    expect(r.rejected[0]).toMatch(/set_budget: category unknown category/);
    expect(r.actions.map(describeAction)).toEqual(["Dining out: $250/mo for the months ahead, want", "save $500/mo, invest $200/mo"]);
  });

  it("applies to this year's plan, income, goals and balances", () => {
    const { actions } = parseActions(
      '```actions\n[{"type":"set_budget","category":"Dining out","monthly":250},{"type":"set_targets","saveMonthly":500},{"type":"set_income","name":"IBM","amount":1325.47,"frequency":"weekly","payDay":5},{"type":"set_goal","name":"Net worth 50k","kind":"net_worth","target":50000,"targetDate":"2028-12"},{"type":"set_balance","account":"chequing","balance":3094.33}]\n```',
    );
    const p = applyActions(profile, actions, 2026, "2026-11-05");
    const plan = p.yearPlans!["2026"]!;
    expect(plan.budget.find((b) => b.category === "Dining out")).toEqual({ category: "Dining out", kind: "want", months: Array.from({ length: 12 }, () => 250) });
    expect(plan.budget.find((b) => b.category === "Rent")!.months[0]).toBe(880); // the rest of the plan is kept
    expect(plan.save.reduce((s, x) => s + x, 0)).toBe(6000);
    expect(p.incomes[0]).toMatchObject({ name: "IBM", amount: 1325.47, frequency: "weekly", payDay: 5 });
    expect(p.goals[0]).toMatchObject({ name: "Net worth 50k", kind: "net_worth", target: 50000 });
    expect(p.accounts[0]!.balance).toBe(3094.33);
  });
});

describe("number check", () => {
  const context = { dining: { avgPerMonth: 502.4, total: 4563.87 }, income: 41884.59 };
  it("amounts from the data, ×12 / ÷12 of it, or differences the reply shows are fine; others are flagged", () => {
    expect(ungroundedAmounts("Dining averages $502/month, about $6,029 a year; total $4,563.87.", context)).toEqual([]);
    expect(ungroundedAmounts("Cut dining from $502 to $300: that's $202 a month.", context, "make dining $300")).toEqual([]);
    expect(ungroundedAmounts("You spent $9,999 on dining.", context)).toEqual(["$9,999"]);
  });
});

describe("mid-year amounts", () => {
  it("a monthly amount applies to the months still ahead; months with statements keep their plan", () => {
    expect(setAhead(Array.from({ length: 12 }, () => 400), 251, 10)).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 251, 251]);
    expect(setAhead(Array.from({ length: 12 }, () => 0), 100, 0)).toEqual(Array.from({ length: 12 }, () => 100));
  });
  it('"Dining out (want)" is accepted as Dining out; an "annual" figure is read as a yearly rate', () => {
    const { actions } = parseActions('```actions\n[{"type":"set_budget","category":"Dining out (want)","annual":3012}]\n```');
    expect(actions[0]).toMatchObject({ category: "Dining out" });
    expect(describeAction(actions[0]!)).toBe("Dining out: $251/mo for the months ahead");
  });
});
