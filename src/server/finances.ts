import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { finRecords, finTransactions, planVersions, settings } from "@/db/schema";
import { DEFAULT_ASSUMPTIONS } from "@/lib/planner/assumptions";
import { rollForward, type MonthActuals, type RollEntry } from "@/lib/planner/autoroll";
import { addMonths } from "@/lib/planner/core";
import { buildPlan, type Plan } from "@/lib/planner/plan";
import { analyzeSpending, type SpendingAnalysis } from "@/lib/planner/spending";
import { yearSummary, type YearSummary } from "@/lib/planner/summary";
import { creditPaychecks, ensureYearPlan, noteBalanceEdit, syncPayDates, withPlanExpenses } from "@/lib/planner/sync";
import { longTermGoals, plannedMonths, progress, type MonthActual } from "@/lib/planner/yearplan";
import { aheadFor, yearIncome } from "@/lib/planner/received";
import { monthEndBalances, type BalanceAnchor } from "@/lib/planner/balance";
import { suggestCategory, type MyRules } from "@/lib/planner/csv";
import { assumptionsSchema, profileSchema } from "@/lib/planner/schema";
import type { Assumptions, Profile } from "@/lib/planner/types";
import { etParts } from "@/lib/time";
import { decryptJson, encryptJson, parseKey } from "./crypto";
import { env } from "./env";

/**
 * Encrypted storage for the financial planner. Values are decrypted only here,
 * server-side, per request. Never log decrypted values.
 */
const key = () => parseKey(env().DATA_ENCRYPTION_KEY);
export const thisMonth = () => etParts(new Date()).date.slice(0, 7);

async function readProfile(): Promise<Profile | null> {
  const rows = await db().select().from(finRecords).where(eq(finRecords.key, "profile")).limit(1);
  return rows[0] ? profileSchema.parse(decryptJson(rows[0].ciphertext, "fin:profile", key())) : null;
}

async function writeProfile(p: Profile): Promise<void> {
  const valid = profileSchema.parse(withPlanExpenses(p));
  const ciphertext = encryptJson(valid, "fin:profile", key());
  await db()
    .insert(finRecords)
    .values({ key: "profile", ciphertext, updatedAt: new Date() })
    .onConflictDoUpdate({ target: finRecords.key, set: { ciphertext, updatedAt: new Date() } });
}

/** The saved profile. Makes sure this calendar year's plan exists (started from last year's, previous years kept). */
export async function getProfile(): Promise<Profile | null> {
  const p = await readProfile();
  if (!p) return null;
  const today = etParts(new Date()).date;
  const r = ensureYearPlan(p, Number(today.slice(0, 4)), today);
  if (r.changed) await writeProfile(r.profile);
  return withPlanExpenses(r.profile);
}

/**
 * Apply every finished month to the balances (income in; spending and debt
 * payments out), using imported transactions where a month has them. Runs in
 * a transaction that locks the profile row, so concurrent requests can't apply
 * a month twice. Returns the months applied.
 */
export async function applyAutoRoll(): Promise<RollEntry[]> {
  const k = key();
  return db().transaction(async (tx) => {
    const rows = await tx.select().from(finRecords).where(eq(finRecords.key, "profile")).for("update").limit(1);
    if (!rows[0]) return [];
    const p = profileSchema.parse(decryptJson(rows[0].ciphertext, "fin:profile", k));
    if (!p.autoRoll?.enabled) return [];
    // Actual income/spending per month from imported transactions (transfers excluded).
    const txRows = await tx.select().from(finTransactions);
    const byMonth = new Map<string, MonthActuals>();
    for (const r of txRows) {
      if (r.ciphertext === "pending") continue;
      const t = decryptJson<Omit<StoredTx, "id">>(r.ciphertext, `fin:tx:${r.id}`, k);
      if (t.category === "Transfers") continue;
      const m = byMonth.get(r.month) ?? { income: 0, spending: 0 };
      if (t.category === "Income") m.hasPaycheck = true;
      else m.hasPaycheck ??= false;
      if (t.amount > 0) m.income += t.amount;
      else m.spending += -t.amount;
      byMonth.set(r.month, m);
    }
    const { profile, entries } = rollForward(p, thisMonth(), (m) => byMonth.get(m) ?? null);
    if (!entries.length) return [];
    await tx.update(finRecords).set({ ciphertext: encryptJson(profile, "fin:profile", k), updatedAt: new Date() }).where(eq(finRecords.key, "profile"));
    const hist = await tx.select().from(finRecords).where(eq(finRecords.key, "networth_history")).limit(1);
    const prev = hist[0] ? decryptJson<RollEntry[]>(hist[0].ciphertext, "fin:networth_history", k) : [];
    const merged = [...prev.filter((e) => !entries.some((n) => n.month === e.month)), ...entries].sort((a, b) => a.month.localeCompare(b.month));
    const ciphertext = encryptJson(merged, "fin:networth_history", k);
    await tx
      .insert(finRecords)
      .values({ key: "networth_history", ciphertext, updatedAt: new Date() })
      .onConflictDoUpdate({ target: finRecords.key, set: { ciphertext, updatedAt: new Date() } });
    return entries;
  });
}

export async function netWorthHistory(): Promise<RollEntry[]> {
  const rows = await db().select().from(finRecords).where(eq(finRecords.key, "networth_history")).limit(1);
  return rows[0] ? decryptJson<RollEntry[]>(rows[0].ciphertext, "fin:networth_history", key()) : [];
}

/**
 * Save the profile: budget lines come from the year plans, first/last paycheck
 * dates from payroll deposits, and a newly typed balance for the synced account
 * resets the date deposits are counted from.
 */
export async function saveProfile(p: Profile): Promise<void> {
  const prev = await readProfile();
  const today = etParts(new Date()).date;
  const txs = await listTransactions();
  await writeProfile(syncPayDates(noteBalanceEdit(prev, profileSchema.parse(p), today), txs));
}

/** After an import: add new paycheck deposits to the synced account (once each) and refresh paycheck dates. */
async function afterImport(): Promise<{ credited: number; amount: number }> {
  const p = await readProfile();
  if (!p) return { credited: 0, amount: 0 };
  const txs = await listTransactions();
  const r = creditPaychecks(p, txs);
  await writeProfile(syncPayDates(r.profile, txs));
  return { credited: r.credited.length, amount: Math.round(r.credited.reduce((s, c) => s + c.amount, 0) * 100) / 100 };
}

export async function getAssumptions(): Promise<Assumptions> {
  const rows = await db().select().from(settings).where(eq(settings.key, "planner_assumptions")).limit(1);
  const parsed = rows[0] ? assumptionsSchema.safeParse(rows[0].value) : null;
  return parsed?.success ? parsed.data : DEFAULT_ASSUMPTIONS;
}

export async function saveAssumptions(a: Assumptions | null): Promise<void> {
  if (a === null) {
    await db().delete(settings).where(eq(settings.key, "planner_assumptions"));
    return;
  }
  const v = assumptionsSchema.parse(a);
  await db()
    .insert(settings)
    .values({ key: "planner_assumptions", value: v, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
}

export interface PlanResult {
  plan: Plan;
  profile: Profile;
  assumptions: Assumptions;
  spending: SpendingAnalysis;
  /** Which budget the plan used. "actual" needs at least one complete month of transactions. */
  basis: "planned" | "actual";
  /** Headline numbers with the OTHER budget, for comparison. */
  alternate: { basis: "planned" | "actual"; available: number; shortfall: number; goals: { name: string; probability: number | null }[] } | null;
}

export async function getSpending(profile: Profile): Promise<SpendingAnalysis> {
  const txs = await listTransactions();
  // Categories are one fixed list now, so each transaction category is its own row (older manual mappings are ignored).
  return analyzeSpending({ expenses: profile.expenses, txs, today: etParts(new Date()).date });
}

/** One calendar year: take-home, spending, where it went, what needs attention. */
export async function getYearSummary(year: number): Promise<YearSummary | null> {
  const profile = await getProfile();
  if (!profile) return null;
  const txs = await listTransactions();
  return yearSummary({ profile, txs, year, today: etParts(new Date()).date });
}

export async function getPlan(opts: { profile?: Profile; runs?: number } = {}): Promise<PlanResult | null> {
  const profile = opts.profile ?? (await getProfile());
  if (!profile) return null;
  const assumptions = await getAssumptions();
  const spending = await getSpending(profile);
  const hasActual = spending.completeMonths.length > 0;
  const basis = profile.budgetBasis === "actual" && hasActual ? "actual" : "planned";
  const withActual = { ...profile, expenses: spending.actualBasisExpenses };
  const today = etParts(new Date()).date;
  const year = Number(today.slice(0, 4));
  const txs = await listTransactions();
  const s = yearSummary({ profile, txs, year, today });
  const status = new Map(s.months.map((m) => [m.month, m.status]));
  const monthlyIncome = Math.round((yearIncome(profile, txs, year, (m) => status.get(m) ?? "none").total / 12) * 100) / 100;
  const plan = buildPlan(basis === "actual" ? withActual : profile, assumptions, thisMonth(), { runs: opts.runs ?? 5000, monthlyIncome });
  let alternate: PlanResult["alternate"] = null;
  if (hasActual) {
    const other = buildPlan(basis === "actual" ? profile : withActual, assumptions, thisMonth(), { runs: 1000, monthlyIncome });
    alternate = {
      basis: basis === "actual" ? "planned" : "actual",
      available: other.cashFlow.available,
      shortfall: other.feasibility.shortfall,
      goals: other.goals.map((g) => ({ name: g.goal.name, probability: g.sim.probability })),
    };
  }
  return { plan, profile, assumptions, spending, basis, alternate };
}

// ---------- transactions ----------

export interface StoredTx {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string;
}

const txKey = (t: { date: string; description: string; amount: number }) => `${t.date}|${t.description.toLowerCase()}|${t.amount.toFixed(2)}`;

/**
 * Save confirmed transactions, skipping ones already saved (same date,
 * description and amount, counted, so two identical coffees the same day still
 * count twice if the file has them twice). Re-uploading a file is harmless.
 */
export async function addTransactions(rows: Omit<StoredTx, "id">[]): Promise<{ saved: number; duplicates: number; paychecksCredited?: number; creditedAmount?: number }> {
  if (!rows.length) return { saved: 0, duplicates: 0 };
  const k = key();
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))];
  const existing = new Map<string, number>();
  for (const m of months) for (const t of await listTransactions(m)) existing.set(txKey(t), (existing.get(txKey(t)) ?? 0) + 1);
  const fresh = rows.filter((r) => {
    const c = existing.get(txKey(r)) ?? 0;
    if (c > 0) {
      existing.set(txKey(r), c - 1);
      return false;
    }
    return true;
  });
  if (fresh.length) {
    await db().transaction(async (tx) => {
      // Insert first to get ids, then encrypt with the id as AAD.
      const inserted = await tx
        .insert(finTransactions)
        .values(fresh.map((r) => ({ month: r.date.slice(0, 7), ciphertext: "pending" })))
        .returning({ id: finTransactions.id });
      for (const [i, r] of fresh.entries()) {
        const id = inserted[i]!.id;
        await tx.update(finTransactions).set({ ciphertext: encryptJson(r, `fin:tx:${id}`, k) }).where(eq(finTransactions.id, id));
      }
    });
  }
  const synced = fresh.length ? await afterImport() : { credited: 0, amount: 0 };
  return { saved: fresh.length, duplicates: rows.length - fresh.length, paychecksCredited: synced.credited, creditedAmount: synced.amount };
}

/** Flip the sign of every transaction in a month (fix a credit-card import saved the wrong way round). */
export async function flipMonth(month: string): Promise<number> {
  const k = key();
  const rows = await listTransactions(month);
  const mine = await myRules();
  await db().transaction(async (tx) => {
    for (const t of rows) {
      const { id, ...rest } = t;
      // Re-suggest the category if it was the automatic one: flipping the sign changes what the row is.
      const auto = rest.category === suggestCategory(rest.description, rest.amount, mine).category;
      const category = auto ? suggestCategory(rest.description, -rest.amount, mine).category : rest.category;
      await tx.update(finTransactions).set({ ciphertext: encryptJson({ ...rest, amount: -rest.amount, category }, `fin:tx:${id}`, k) }).where(eq(finTransactions.id, id));
    }
  });
  return rows.length;
}

export async function deleteMonth(month: string): Promise<number> {
  const r = await db().delete(finTransactions).where(eq(finTransactions.month, month)).returning({ id: finTransactions.id });
  return r.length;
}

export async function transactionMonths(): Promise<{ month: string; count: number }[]> {
  const rows = await db().execute<{ month: string; count: number }>(sql`select month, count(*)::int as count from fin_transactions group by month order by month desc`);
  return [...rows];
}

export async function listTransactions(month?: string): Promise<StoredTx[]> {
  const k = key();
  const rows = await db()
    .select()
    .from(finTransactions)
    .where(month ? eq(finTransactions.month, month) : sql`true`)
    .orderBy(desc(finTransactions.month), desc(finTransactions.id));
  return rows.filter((r) => r.ciphertext !== "pending").map((r) => ({ id: r.id, ...decryptJson<Omit<StoredTx, "id">>(r.ciphertext, `fin:tx:${r.id}`, k) }));
}

export async function updateTransactionCategory(id: number, category: string): Promise<void> {
  const k = key();
  const row = (await db().select().from(finTransactions).where(eq(finTransactions.id, id)).limit(1))[0];
  if (!row) throw new Error("transaction not found");
  const tx = decryptJson<Omit<StoredTx, "id">>(row.ciphertext, `fin:tx:${id}`, k);
  await db().update(finTransactions).set({ ciphertext: encryptJson({ ...tx, category }, `fin:tx:${id}`, k) }).where(eq(finTransactions.id, id));
}

/** Your saved category rules (part of the encrypted profile). */
export async function myRules(): Promise<MyRules> {
  const p = await getProfile();
  return { rules: p?.categoryRules ?? [], peerOutCategory: p?.peerOutCategory };
}

/** Transactions whose automatic category under the CURRENT rules differs from the saved one (e.g. after a new category is added). */
export async function recategorizePreview(): Promise<{ id: number; date: string; description: string; amount: number; from: string; to: string }[]> {
  const mine = await myRules();
  return (await listTransactions()).flatMap((t) => {
    const s = suggestCategory(t.description, t.amount, mine);
    return s.confidence === "rule" && s.category !== t.category ? [{ id: t.id, date: t.date, description: t.description, amount: t.amount, from: t.category, to: s.category }] : [];
  });
}

/** Apply several category changes at once. */
export async function setCategories(changes: { id: number; category: string }[]): Promise<number> {
  const k = key();
  return db().transaction(async (tx) => {
    let n = 0;
    for (const c of changes) {
      const row = (await tx.select().from(finTransactions).where(eq(finTransactions.id, c.id)).limit(1))[0];
      if (!row || row.ciphertext === "pending") continue;
      const t = decryptJson<Omit<StoredTx, "id">>(row.ciphertext, `fin:tx:${c.id}`, k);
      await tx.update(finTransactions).set({ ciphertext: encryptJson({ ...t, category: c.category }, `fin:tx:${c.id}`, k) }).where(eq(finTransactions.id, c.id));
      n++;
    }
    return n;
  });
}

/** This month's actual spending by category vs the plan. */
export async function checkIn(month = thisMonth()) {
  const res = await getPlan({ runs: 1000 });
  const txs = await listTransactions(month);
  const spentByCat = new Map<string, number>();
  let income = 0;
  for (const t of txs) {
    if (t.category === "Transfers") continue;
    if (t.amount > 0) income += t.amount;
    else spentByCat.set(t.category, (spentByCat.get(t.category) ?? 0) + -t.amount);
  }
  const spent = [...spentByCat.values()].reduce((a, b) => a + b, 0);
  const planned = res ? res.profile.expenses.reduce((a, e) => a + e.monthly, 0) : 0;
  const categories = new Set([...spentByCat.keys(), ...(res?.profile.expenses.map((e) => e.category) ?? [])]);
  return {
    month,
    hasTransactions: txs.length > 0,
    income: Math.round(income * 100) / 100,
    spent: Math.round(spent * 100) / 100,
    planned,
    saved: Math.round((income - spent) * 100) / 100,
    plannedSaving: res ? res.plan.cashFlow.available : null,
    byCategory: [...categories]
      .map((c) => ({ category: c, actual: Math.round((spentByCat.get(c) ?? 0) * 100) / 100, planned: res?.profile.expenses.find((e) => e.category === c)?.monthly ?? 0 }))
      .sort((a, b) => b.actual - a.actual),
    previousMonth: addMonths(month, -1),
  };
}

// ---------- plan versions ----------

export async function saveVersion(name: string, payload: unknown): Promise<number> {
  const [row] = await db().insert(planVersions).values({ name, ciphertext: "pending" }).returning({ id: planVersions.id });
  await db().update(planVersions).set({ ciphertext: encryptJson(payload, `fin:ver:${row!.id}`, key()) }).where(eq(planVersions.id, row!.id));
  return row!.id;
}

export async function listVersions() {
  const k = key();
  const rows = await db().select().from(planVersions).orderBy(desc(planVersions.createdAt));
  return rows.filter((r) => r.ciphertext !== "pending").map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString(), data: decryptJson<unknown>(r.ciphertext, `fin:ver:${r.id}`, k) }));
}

// ---------- export / delete ----------

export async function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    profile: await getProfile(),
    assumptions: await getAssumptions(),
    transactions: await listTransactions(),
    planVersions: await listVersions(),
    netWorthHistory: await netWorthHistory(),
  };
}

export async function deleteAll(): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(finTransactions);
    await tx.delete(planVersions);
    await tx.delete(finRecords);
    await tx.delete(settings).where(eq(settings.key, "planner_assumptions"));
  });
}

/**
 * This year's plan vs your statements, plus long-term goals. Net worth = accounts −
 * debts, plus money moved to investing when no investment account is entered.
 */
export async function getYearProgress(year: number) {
  const profile = await getProfile();
  if (!profile) return null;
  const today = etParts(new Date()).date;
  const plan = profile.yearPlans?.[String(year)] ?? null;
  const txs = await listTransactions();
  const s = yearSummary({ profile, txs, year, today });
  const hasInvestAccount = profile.accounts.some((a) => !["CASH", "HISA"].includes(a.type) && a.balance > 0);
  const netWorth =
    profile.accounts.reduce((t, a) => t + a.balance, 0) - profile.debts.reduce((t, d) => t + d.balance, 0) + (hasInvestAccount ? 0 : s.investments.allTime.net);
  const actuals: MonthActual[] = s.months.map((m) => ({ month: m.month, income: m.income, spent: m.spent, invested: m.invested, status: m.status }));
  const incomeNow = yearIncome(profile, txs, year, (m) => s.months.find((x) => x.month === m)?.status ?? "none");
  return {
    year,
    plan,
    planned: plan ? plannedMonths(plan, profile) : null,
    progress: plan ? progress(plan, profile, actuals, today, { incomeAhead: incomeNow.ahead }) : null,
    income: incomeNow,
    // Actual spending per category and month (complete statement months only), for "so far" in the budget
    actualSpend: Object.fromEntries(
      s.categories.map((c) => [
        c.category,
        s.months.map((m) => (m.status === "full" ? Math.round(c.txs.filter((x) => x.date.startsWith(m.month)).reduce((t, x) => t + x.amount, 0) * 100) / 100 : null)),
      ]),
    ),
    balance: await (async () => {
      // Checking balance: month ends rebuilt from the newest statement balance; today = what you entered; Dec 31 = today + paychecks after today − your budget for the rest of the year
      const anchors = await getBalanceAnchors();
      const anchor = anchors.at(-1) ?? null;
      const cashAccounts = profile.accounts.filter((a) => a.type === "CASH" || a.type === "HISA");
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const monthEnd = monthEndBalances(year, anchor, txs);
      // Start: the balance you entered; if you haven't entered one, the last balance from your statements (never $0 by default)
      const lastData = txs.map((t) => t.date).sort().at(-1) ?? null;
      const start = cashAccounts.length
        ? { date: profile.cashSync?.balanceAsOf ?? today, cash: r2(cashAccounts.reduce((t, a) => t + a.balance, 0)), source: "entered" as const }
        : anchor && lastData
          ? { date: lastData, cash: monthEnd.filter((v): v is number => v !== null).at(-1) ?? anchor.balance, source: "statements" as const }
          : null;
      if (!start) return { anchor, monthEnd, today: null, projected: null };
      const incomeAfter = profile.incomes.reduce((t, i) => t + aheadFor(i, start.date, year).amount, 0);
      const fromMonth = Number(start.date.slice(5, 7)) - (start.source === "statements" ? 0 : 1); // statements: the months after the data
      const budgetRest = plan ? plan.budget.reduce((t, r) => t + r.months.slice(fromMonth).reduce((x, y) => x + y, 0), 0) : 0;
      return {
        anchor,
        monthEnd,
        today: start,
        // Only project when there's something to project: income still to come or a budget
        projected: incomeAfter > 0 || budgetRest > 0 ? { date: `${year}-12-31`, cash: r2(start.cash + incomeAfter - budgetRest), incomeAfterToday: r2(incomeAfter), budgetRest: r2(budgetRest) } : null,
      };
    })(),
    soFar: { months: s.fullMonths, received: s.income.actual, spent: s.spending.actual, invested: s.investments.year.net, saved: s.saved.actual },
    longTerm: longTermGoals(profile, profile.yearPlans?.[today.slice(0, 4)] ?? plan, netWorth, today),
    netWorth: Math.round(netWorth * 100) / 100,
    years: Object.keys(profile.yearPlans ?? {}).sort(),
  };
}

// ---------- checking balance (from statements) ----------

/** Balances the bank printed on your statements (newest last). */
export async function getBalanceAnchors(): Promise<BalanceAnchor[]> {
  const rows = await db().select().from(finRecords).where(eq(finRecords.key, "balance_anchors")).limit(1);
  return rows[0] ? decryptJson<BalanceAnchor[]>(rows[0].ciphertext, "fin:balance_anchors", key()) : [];
}

export async function addBalanceAnchor(a: BalanceAnchor): Promise<void> {
  const list = [...(await getBalanceAnchors()).filter((x) => x.date !== a.date), a].sort((x, y) => x.date.localeCompare(y.date));
  const ciphertext = encryptJson(list, "fin:balance_anchors", key());
  await db()
    .insert(finRecords)
    .values({ key: "balance_anchors", ciphertext, updatedAt: new Date() })
    .onConflictDoUpdate({ target: finRecords.key, set: { ciphertext, updatedAt: new Date() } });
}
