import { z } from "zod";
import { route } from "@/server/api";
import { addBalanceAnchor, addTransactions, deleteMonth, flipMonth, listTransactions, transactionMonths, updateTransactionCategory } from "@/server/finances";
import { body, searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM");

/** ?month=YYYY-MM for one month, ?months=1 for the list of months with counts. */
export const GET = route(async (req) => {
  const q = searchParams(req);
  if (q.get("months")) return Response.json(await transactionMonths());
  const month = q.get("month");
  return Response.json(await listTransactions(month ? monthSchema.parse(month) : undefined));
});

const txSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(200),
  amount: z.number().finite().min(-1e7).max(1e7),
  category: z.string().trim().min(1).max(40),
});

export const POST = route(async (req) => {
  const b = await body(
    req,
    z.object({
      rows: z.array(txSchema).min(1).max(5000),
      // The statement's own closing balance (Bank of America CSVs), kept to draw the checking balance
      balance: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), balance: z.number().finite(), source: z.literal("statement") }).nullable().optional(),
    }),
  );
  if (b.balance) await addBalanceAnchor(b.balance);
  return Response.json(await addTransactions(b.rows), { status: 201 });
});

/** Change one transaction's category, or flip the signs of a whole month. */
export const PATCH = route(async (req) => {
  const b = await body(req, z.union([z.object({ id: z.number().int().positive(), category: z.string().trim().min(1).max(40) }), z.object({ flipMonth: monthSchema })]));
  if ("flipMonth" in b) return Response.json({ flipped: await flipMonth(b.flipMonth) });
  await updateTransactionCategory(b.id, b.category);
  return Response.json({ ok: true });
});

export const DELETE = route(async (req) => {
  const month = monthSchema.parse(searchParams(req).get("month"));
  return Response.json({ deleted: await deleteMonth(month) });
});
