import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { finRecords, finTransactions, planVersions, settings } from "@/db/schema";
import { DEFAULT_ASSUMPTIONS } from "@/lib/planner/assumptions";
import { addMonths } from "@/lib/planner/core";
import { buildPlan, type Plan } from "@/lib/planner/plan";
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

export async function getProfile(): Promise<Profile | null> {
  const rows = await db().select().from(finRecords).where(eq(finRecords.key, "profile")).limit(1);
  if (!rows[0]) return null;
  return profileSchema.parse(decryptJson(rows[0].ciphertext, "fin:profile", key()));
}

export async function saveProfile(p: Profile): Promise<void> {
  const valid = profileSchema.parse(p);
  const ciphertext = encryptJson(valid, "fin:profile", key());
  await db()
    .insert(finRecords)
    .values({ key: "profile", ciphertext, updatedAt: new Date() })
    .onConflictDoUpdate({ target: finRecords.key, set: { ciphertext, updatedAt: new Date() } });
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

export async function getPlan(opts: { profile?: Profile; runs?: number } = {}): Promise<{ plan: Plan; profile: Profile; assumptions: Assumptions } | null> {
  const profile = opts.profile ?? (await getProfile());
  if (!profile) return null;
  const assumptions = await getAssumptions();
  return { plan: buildPlan(profile, assumptions, thisMonth(), { runs: opts.runs ?? 5000 }), profile, assumptions };
}

// ---------- transactions ----------

export interface StoredTx {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string;
}

export async function addTransactions(rows: Omit<StoredTx, "id">[]): Promise<number> {
  if (!rows.length) return 0;
  const k = key();
  // Insert first to get ids, then encrypt with the id as AAD.
  const inserted = await db()
    .insert(finTransactions)
    .values(rows.map((r) => ({ month: r.date.slice(0, 7), ciphertext: "pending" })))
    .returning({ id: finTransactions.id });
  await db().transaction(async (tx) => {
    for (const [i, r] of rows.entries()) {
      const id = inserted[i]!.id;
      await tx.update(finTransactions).set({ ciphertext: encryptJson(r, `fin:tx:${id}`, k) }).where(eq(finTransactions.id, id));
    }
  });
  return rows.length;
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
