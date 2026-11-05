import { z } from "zod";

/** Validation for the financial profile (request bodies and decrypted records). */
const money = z.number().finite().min(0).max(1e9);
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM");
const id = z.string().min(1).max(40);

export const incomeSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  amount: money,
  frequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly", "annual"]),
  kind: z.enum(["salary", "coop", "bonus", "other"]),
  startMonth: ym.nullable().optional(),
  endMonth: ym.nullable().optional(),
  annualRaisePct: z.number().min(0).max(50).optional(),
  repeatsYearly: z.boolean().optional(),
});
export const expenseSchema = z.object({ id, category: z.string().trim().min(1).max(40), monthly: money, kind: z.enum(["need", "want"]) });
export const debtSchema = z.object({ id, name: z.string().trim().min(1).max(60), balance: money, aprPct: z.number().min(0).max(100), minPayment: money });
export const accountSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  type: z.enum(["CASH", "HISA", "TFSA", "RRSP", "FHSA", "ROTH_IRA", "TRADITIONAL_IRA", "401K", "HSA", "TAXABLE"]),
  balance: money,
});
export const goalSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["emergency", "car", "house", "retirement", "long_term", "education", "other"]),
  target: money,
  targetDate: ym,
  priority: z.number().int().min(1).max(10),
  current: money,
});
export const riskSchema = z.object({
  horizonYears: z.number().min(0).max(80),
  drawdownReaction: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  incomeStability: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  experience: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const profileSchema = z.object({
  country: z.enum(["CA", "US"]),
  region: z.string().trim().max(40),
  age: z.number().int().min(14).max(110),
  crossBorder: z.boolean(),
  incomes: z.array(incomeSchema).max(30),
  expenses: z.array(expenseSchema).max(80),
  debts: z.array(debtSchema).max(30),
  accounts: z.array(accountSchema).max(30),
  goals: z.array(goalSchema).max(30),
  risk: riskSchema,
  riskOverride: z.number().int().min(1).max(10).nullable().optional(),
  employerMatchPct: z.number().min(0).max(20).optional(),
  sandboxPct: z.number().min(0).max(50),
  highInterestAprPct: z.number().min(0).max(50),
  tax: z
    .object({
      usEarnedIncome: z.number().min(0).max(1e8).optional(),
      filingStatus: z.enum(["single", "hoh", "mfj", "mfs"]).optional(),
      magi: z.number().min(0).max(1e9).optional(),
      marginalTaxPct: z.number().min(0).max(70).optional(),
      hsaCoverage: z.enum(["self", "family", "none"]).optional(),
      caPrevYearEarnedIncome: z.number().min(0).max(1e8).optional(),
      rrspUnusedRoom: z.number().min(0).max(1e7).optional(),
      tfsaRoomOverride: z.number().min(0).max(1e7).nullable().optional(),
      birthYear: z.number().int().min(1900).max(2100).optional(),
    })
    .optional(),
});

/** Problems that would make the plan silently wrong (shown in the editor, enforced on save). */
export function profileProblems(p: z.infer<typeof profileSchema>): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  for (const i of p.incomes) {
    // (A repeating term may wrap across New Year, e.g. Nov–Feb.)
    if (!i.repeatsYearly && i.startMonth && i.endMonth && i.endMonth < i.startMonth) {
      out.push({ path: `income:${i.id}`, message: `“${i.name}” ends (${i.endMonth}) before it starts (${i.startMonth}), so it never counts. Fix the dates.` });
    }
  }
  return out;
}

/** Stricter schema for saving. (Reading stays lenient so an older bad save can still be opened and fixed.) */
export const profileInputSchema = profileSchema.superRefine((p, ctx) => {
  for (const pr of profileProblems(p)) ctx.addIssue({ code: "custom", message: pr.message, path: [pr.path] });
});

export const assumptionsSchema = z.object({
  inflationPct: z.number().min(0).max(15),
  inflationSource: z.string(),
  classes: z.object({
    equity: z.object({ key: z.literal("equity"), label: z.string(), realReturnPct: z.number().min(-5).max(15), volatilityPct: z.number().min(0).max(60), source: z.string() }),
    bonds: z.object({ key: z.literal("bonds"), label: z.string(), realReturnPct: z.number().min(-5).max(10), volatilityPct: z.number().min(0).max(40), source: z.string() }),
    cash: z.object({ key: z.literal("cash"), label: z.string(), realReturnPct: z.number().min(-5).max(5), volatilityPct: z.number().min(0).max(10), source: z.string() }),
  }),
  stockBondCorrelation: z.number().min(-1).max(1),
  correlationSource: z.string(),
});
