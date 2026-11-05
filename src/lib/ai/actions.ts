import { z } from "zod";
import { SPENDING_CATEGORY_NAMES, defaultKind } from "@/lib/planner/categories";
import type { Profile } from "@/lib/planner/types";
import { newYearPlan, type YearPlan } from "@/lib/planner/yearplan";

/**
 * Changes the assistant can PROPOSE. Nothing is applied until you click Apply;
 * then the change goes through the same save as My finances.
 */
const twelve = z.array(z.number().min(0).max(1e7)).length(12);
const amount = z.number().min(0).max(1e8);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// "Dining out (want)" or "dining out" → "Dining out"
const category = z.preprocess(
  (c) => (typeof c === "string" ? (SPENDING_CATEGORY_NAMES.find((n) => n.toLowerCase() === c.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase()) ?? c) : c),
  z.string().refine((c) => SPENDING_CATEGORY_NAMES.includes(c), "unknown category"),
);

export const actionSchema = z.discriminatedUnion("type", [
  // monthly = the amount for every month still ahead (months with statements keep their plan); months = exact Jan–Dec
  z.object({ type: z.literal("set_budget"), category, monthly: amount.optional(), annual: amount.optional(), months: twelve.optional(), kind: z.enum(["need", "want"]).optional(), why: z.string().max(300).optional() }),
  z.object({ type: z.literal("remove_budget"), category, why: z.string().max(300).optional() }),
  z.object({
    type: z.literal("set_targets"),
    saveMonthly: amount.optional(),
    saveMonths: twelve.optional(),
    investMonthly: amount.optional(),
    investMonths: twelve.optional(),
    saveAnnual: amount.optional(), // read as a yearly rate: / 12 per month ahead
    investAnnual: amount.optional(),
    why: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("set_income"),
    name: z.string().trim().min(1).max(60),
    amount: amount.optional(),
    frequency: z.enum(["hourly", "weekly", "biweekly", "semimonthly", "monthly", "annual", "once"]).optional(),
    basis: z.enum(["net", "gross"]).optional(),
    payDay: z.number().int().min(0).max(6).optional(),
    employmentStart: date.nullable().optional(),
    employmentEnd: date.nullable().optional(),
    firstPayDate: date.nullable().optional(),
    hoursPerWeek: z.number().min(0).max(100).optional(),
    kind: z.enum(["salary", "coop", "bonus", "other"]).optional(),
    why: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("set_goal"),
    name: z.string().trim().min(1).max(60),
    kind: z.enum(["emergency", "car", "house", "retirement", "long_term", "education", "net_worth", "other"]).optional(),
    target: amount.optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    monthlyContribution: amount.optional(),
    why: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal("set_balance"), account: z.string().trim().min(1).max(60), balance: z.number().min(-1e8).max(1e8), why: z.string().max(300).optional() }),
]);
export type Action = z.infer<typeof actionSchema>;

const fmt = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const rate = (monthly?: number, annual?: number) => monthly ?? (annual !== undefined ? Math.round((annual / 12) * 100) / 100 : undefined);
/** Set every month from `openFrom` on to `v`; earlier months (covered by statements) keep their plan. */
export const setAhead = (months: number[], v: number, openFrom: number) => months.map((x, k) => (k >= openFrom ? v : x));
const total = (m: number[]) => m.reduce((s, x) => s + x, 0);

export function describe(a: Action): string {
  switch (a.type) {
    case "set_budget":
      return `${a.category}: ${a.months ? `${fmt(total(a.months))} for the year (month by month)` : rate(a.monthly, a.annual) !== undefined ? `${fmt(rate(a.monthly, a.annual)!)}/mo for the months ahead` : "update"}${a.kind ? `, ${a.kind}` : ""}`;
    case "remove_budget":
      return `Remove ${a.category} from the budget`;
    case "set_targets":
      return [
        a.saveMonths ? `save ${fmt(total(a.saveMonths))} for the year` : rate(a.saveMonthly, a.saveAnnual) !== undefined ? `save ${fmt(rate(a.saveMonthly, a.saveAnnual)!)}/mo` : null,
        a.investMonths ? `invest ${fmt(total(a.investMonths))} for the year` : rate(a.investMonthly, a.investAnnual) !== undefined ? `invest ${fmt(rate(a.investMonthly, a.investAnnual)!)}/mo` : null,
      ]
        .filter(Boolean)
        .join(", ");
    case "set_income":
      return `Income “${a.name}”: ${[a.amount !== undefined && fmt(a.amount), a.frequency, a.payDay !== undefined && ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][a.payDay], a.employmentStart && `from ${a.employmentStart}`, a.employmentEnd && `to ${a.employmentEnd}`].filter(Boolean).join(" · ")}`;
    case "set_goal":
      return `Goal “${a.name}”: ${[a.target !== undefined && fmt(a.target), a.targetDate && `by ${a.targetDate}`, a.monthlyContribution !== undefined && `${fmt(a.monthlyContribution)}/mo`].filter(Boolean).join(" · ")}`;
    case "set_balance":
      return `${a.account} balance: ${fmt(a.balance)}`;
  }
}

/**
 * Apply proposed changes to a profile (the current calendar year's plan for budget
 * / targets). `openFrom` = index of the first month not yet covered by a statement
 * (annual amounts then fill only the months ahead). Pure.
 */
export function applyActions(p: Profile, actions: Action[], year: number, today: string, openFrom = 0): Profile {
  let out: Profile = { ...p };
  const plan = (): YearPlan => out.yearPlans?.[String(year)] ?? newYearPlan(out, year, today);
  const setPlan = (pl: YearPlan) => (out = { ...out, yearPlans: { ...(out.yearPlans ?? {}), [String(year)]: pl } });
  for (const a of actions) {
    if (a.type === "set_budget") {
      const pl = plan();
      const existing = pl.budget.find((r) => r.category === a.category);
      const r = rate(a.monthly, a.annual);
      const months = a.months ?? (r !== undefined ? setAhead(existing?.months ?? Array.from({ length: 12 }, () => 0), r, openFrom) : undefined);
      const row = { category: a.category, kind: a.kind ?? existing?.kind ?? defaultKind(a.category), months: months ?? existing?.months ?? Array.from({ length: 12 }, () => 0) };
      setPlan({ ...pl, budget: existing ? pl.budget.map((r) => (r.category === a.category ? row : r)) : [...pl.budget, row] });
    } else if (a.type === "remove_budget") {
      const pl = plan();
      setPlan({ ...pl, budget: pl.budget.filter((r) => r.category !== a.category) });
    } else if (a.type === "set_targets") {
      const pl = plan();
      setPlan({
        ...pl,
        save: a.saveMonths ?? (rate(a.saveMonthly, a.saveAnnual) !== undefined ? setAhead(pl.save, rate(a.saveMonthly, a.saveAnnual)!, openFrom) : pl.save),
        invest: a.investMonths ?? (rate(a.investMonthly, a.investAnnual) !== undefined ? setAhead(pl.invest, rate(a.investMonthly, a.investAnnual)!, openFrom) : pl.invest),
      });
    } else if (a.type === "set_income") {
      const { type: _t, why: _w, ...fields } = a;
      const match = out.incomes.find((i) => i.name.toLowerCase() === a.name.toLowerCase());
      out = match
        ? { ...out, incomes: out.incomes.map((i) => (i === match ? { ...i, ...fields } : i)) }
        : { ...out, incomes: [...out.incomes, { id: Math.random().toString(36).slice(2, 10), amount: 0, frequency: "weekly", kind: "salary", basis: "net", ...fields }] };
    } else if (a.type === "set_goal") {
      const { type: _t, why: _w, ...fields } = a;
      const match = out.goals.find((g) => g.name.toLowerCase() === a.name.toLowerCase());
      out = match
        ? { ...out, goals: out.goals.map((g) => (g === match ? { ...g, ...fields } : g)) }
        : {
            ...out,
            goals: [...out.goals, { id: Math.random().toString(36).slice(2, 10), kind: "other", target: 0, targetDate: `${year + 1}-12`, priority: out.goals.length + 1, current: 0, ...fields }],
          };
    } else if (a.type === "set_balance") {
      out = { ...out, accounts: out.accounts.map((x) => (x.name.toLowerCase() === a.account.toLowerCase() ? { ...x, balance: a.balance } : x)) };
    }
  }
  return out;
}

/** Pull the ```actions JSON block out of a reply: valid actions, and what was dropped (with the reason). */
export function parseActions(reply: string): { text: string; actions: Action[]; rejected: string[] } {
  const m = /```actions\s*([\s\S]*?)```/i.exec(reply);
  if (!m) return { text: reply.trim(), actions: [], rejected: [] };
  const text = reply.replace(m[0], "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]!);
  } catch {
    return { text, actions: [], rejected: ["the proposed changes weren't valid JSON"] };
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const actions: Action[] = [];
  const rejected: string[] = [];
  for (const x of list) {
    const r = actionSchema.safeParse(x);
    if (r.success) actions.push(r.data);
    else rejected.push(`${(x as { type?: string })?.type ?? "change"}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  }
  return { text, actions, rejected };
}
