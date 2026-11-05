import { describe, parseActions, type Action } from "@/lib/ai/actions";
import { ungroundedAmounts, wrongMath } from "@/lib/ai/grounding";
import { createRedactor } from "@/lib/ai/redact";
import { SPENDING_CATEGORIES } from "@/lib/planner/categories";
import { nextPaycheck } from "@/lib/planner/core";
import { detectPaychecks } from "@/lib/planner/paychecks";
import { proposeWants } from "@/lib/planner/propose";
import { etParts } from "@/lib/time";
import { getProfile, getYearProgress, getYearSummary, listTransactions } from "../finances";
import { generate } from "./gemini";

/**
 * The finance assistant: everything the app has computed about your money goes
 * into one context (redacted), the model answers from it, and any configuration
 * it suggests comes back as proposed changes for you to apply.
 */
const r2 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

export async function financeContext() {
  const profile = await getProfile();
  if (!profile) return null;
  const today = etParts(new Date()).date;
  const year = Number(today.slice(0, 4));
  const [s, y, txs] = await Promise.all([getYearSummary(year), getYearProgress(year), listTransactions()]);
  const plan = profile.yearPlans?.[String(year)] ?? null;
  const pays = detectPaychecks(txs);
  const income = y?.planned?.reduce((t, m) => t + m.income, 0) ?? 0;
  const proposal = plan
    ? proposeWants({
        budget: plan.budget,
        income,
        debtMinimumsYear: profile.debts.reduce((t, d) => t + Math.min(d.minPayment, d.balance), 0) * 12,
        goalsNeedYear: (y?.longTerm ?? []).reduce((t, g) => t + g.neededPerMonth, 0) * 12,
        statementAvg: (c) => s?.categories.find((x) => x.category === c)?.avgPerMonth ?? null,
      })
    : null;
  return {
    today,
    year,
    owner: { callThem: profile.preferredName ?? null },
    about: { country: profile.country, region: profile.region, age: profile.age },
    categories: SPENDING_CATEGORIES.map((c) => c.name),
    accounts: profile.accounts.map((a) => ({ name: a.name, type: a.type, balance: a.balance })),
    debts: profile.debts.map((d) => ({ name: d.name, balance: d.balance, aprPct: d.aprPct, minPayment: d.minPayment })),
    netWorth: y?.netWorth ?? null,
    incomeLines: profile.incomes.map((i) => ({
      name: i.name,
      amount: i.amount,
      frequency: i.frequency,
      basis: i.basis ?? "net",
      payDay: i.payDay,
      employmentStart: i.employmentStart,
      employmentEnd: i.employmentEnd,
      firstPayDate: i.firstPayDate,
      lastPayDate: i.lastPayDate,
      months: i.startMonth || i.endMonth ? `${i.startMonth ?? ""}..${i.endMonth ?? ""}` : undefined,
    })),
    nextExpectedPaycheck: nextPaycheck(profile.incomes, today),
    payrollDepositsFound: pays.map((x) => ({ employer: x.employer, frequency: x.frequency, payDay: x.payDay, latestAmount: x.amount, deposits: x.count, first: x.first, last: x.last, ongoing: x.ongoing })),
    yearPlan: plan && {
      budget: plan.budget.map((b) => ({ category: b.category, kind: b.kind, annual: r2(b.months.reduce((t, v) => t + v, 0)), months: b.months })),
      saveMonths: plan.save,
      investMonths: plan.invest,
      decemberGoals: y?.progress?.goals,
    },
    plannedByMonth: y?.planned?.map((m) => ({ month: m.month, takeHome: r2(m.income), spending: r2(m.spending), save: m.save, invest: m.invest, unassigned: r2(m.unassigned) })),
    planVsStatements: y?.progress && {
      months: y.progress.months.map((m) => ({ month: m.month, status: m.status, actual: m.actual })),
      toDate: y.progress.toDate,
      missingStatements: y.progress.missing,
      remaining: y.progress.remaining,
    },
    statements: s && {
      fullMonths: s.fullMonths,
      moneyIn: s.income.actual,
      paychecks: s.income.paychecks,
      incomeSources: s.income.sources.map((x) => ({ source: x.label, kind: x.kind, total: x.total, count: x.count })),
      spent: s.spending.actual,
      avgSpentPerFullMonth: s.spending.avgPerMonth,
      byCategory: s.categories.map((c) => ({
        category: c.category,
        total: c.total,
        avgPerFullMonth: c.avgPerMonth,
        budgetPerMonth: c.budgetPerMonth,
        status: c.status,
        sharePct: c.sharePct,
        topMerchants: c.merchants.slice(0, 5).map((m) => ({ merchant: m.name, total: m.total, count: m.count })),
      })),
      investments: { sentAllTime: s.investments.allTime.sent, backAllTime: s.investments.allTime.back, netInvested: s.investments.allTime.net },
      dataChecks: s.dataChecks,
    },
    wantsProposal: proposal && { ...proposal },
    longTermGoals: y?.longTerm.map((g) => ({ name: g.goal.name, kind: g.goal.kind, by: g.by, current: g.current, target: g.target, projected: g.projected, gap: g.gap, pacePerMonth: g.pacePerMonth, neededPerMonth: g.neededPerMonth })),
  };
}

const SYSTEM = `You are Folio's personal finance assistant. You talk to ONE person: the owner of this data ("you"). CONTEXT (JSON) holds their data, computed by the app from their profile and imported bank/card statements.

Identity:
- Address the owner as CONTEXT.owner.callThem if set, otherwise just "you". Never give the owner any other name.
- "Person A", "Person B"… are OTHER people (who the owner sent money to or got money from via Zelle etc.). They are never the owner.
- You have no memory beyond this conversation. Never say you've "noted" or "saved" something. To remember the owner's name, propose a set_name change.

Honesty:
- If something isn't in CONTEXT, say you don't have it. Don't guess, don't fill gaps.
- Planned income = CONTEXT.plannedByMonth / incomeLines (what the plan expects). Received income = CONTEXT.statements.incomeSources (deposits). Say which one you mean.
- Only write "a × b = c" when it's exactly true. A total of several different deposits is a sum, not latest amount × count.

Rules:
- Use only numbers from CONTEXT, or arithmetic on them that you show (e.g. "$502 × 12 = $6,024"). Never invent transactions, balances or rates.
- Be precise with labels: "budget" = their plan; "actual" = from statements; an average × 12 is an "estimate", not actual annual spending. Months with no statement are unknown, not zero.
- "Cash saved" excludes money moved to investing; don't count invested money twice.
- Be concise: short paragraphs or bullets with the key numbers. No disclaimers beyond one short line when giving a recommendation.
- People appear as "Person A", "Person B" (redacted); refer to them that way.
- Needs (rent etc.) are the user's to set; for wants you may propose cuts using wantsProposal and their spending.
- Only when the user asks you to set up, configure, change or fix something, end your reply with ONE fenced block (never for questions, greetings or explanations; never invent goals):
\`\`\`actions
[ ...changes... ]
\`\`\`
Allowed changes (JSON objects; months arrays have exactly 12 numbers, Jan..Dec; amounts in dollars):
  {"type":"set_budget","category":"<one of CONTEXT.categories names>","monthly":N} (N = dollars per month for every month still ahead) or "months":[12 numbers] for exact Jan..Dec; optional "kind":"need"|"want"; optional "why"
  {"type":"remove_budget","category":"..."}
  {"type":"set_targets","saveMonthly":N,"investMonthly":N}  (dollars per month for every month still ahead; or "saveMonths"/"investMonths":[12])
  {"type":"set_income","name":"<existing income line name or new>","amount":N,"frequency":"weekly|biweekly|hourly|semimonthly|monthly|annual|once","payDay":0-6 (5=Friday),"employmentStart":"YYYY-MM-DD","employmentEnd":"YYYY-MM-DD","basis":"net|gross","kind":"salary|coop|bonus|other"}
  {"type":"set_goal","name":"...","kind":"net_worth|retirement|long_term|house|emergency|car|education|other","target":N,"targetDate":"YYYY-MM","monthlyContribution":N}
  {"type":"set_balance","account":"<account name>","balance":N}
  {"type":"set_name","name":"<first name the owner wants to be called>"}
  Monthly amounts apply to the months still ahead (CONTEXT.planVsStatements.remaining.months); months with statements keep their plan. When you state a year total, show how it adds up (so far + months ahead x monthly).
  Only include fields you change. The user reviews and applies each change; say so briefly. Never claim a change was made.`;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export async function askAssistant(messages: ChatTurn[]): Promise<{ reply: string; actions: { action: Action; summary: string }[]; rejected: string[]; ungrounded: string[]; wrongMath: string[]; model: string }> {
  const ctx = await financeContext();
  if (!ctx) return { reply: "Set up your finances first (My finances).", actions: [], rejected: [], ungrounded: [], wrongMath: [], model: "" };
  const red = createRedactor();
  const contextJson = red.redact(JSON.stringify(ctx));
  const transcript = messages
    .slice(-12)
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${red.redact(m.text)}`)
    .join("\n\n");
  const { text, model } = await generate({ system: SYSTEM, input: `CONTEXT:\n${contextJson}\n\nCONVERSATION:\n${transcript}\n\nASSISTANT:`, temperature: 0.1 });
  const parsed = parseActions(text);
  const reply = red.restore(parsed.text);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";
  return {
    reply,
    actions: parsed.actions.map((a) => ({ action: a, summary: red.restore(describe(a)) })),
    rejected: parsed.rejected,
    ungrounded: ungroundedAmounts(parsed.text, JSON.parse(contextJson), red.redact(lastUser)),
    wrongMath: wrongMath(parsed.text),
    model,
  };
}
