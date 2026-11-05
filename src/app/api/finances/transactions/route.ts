import { z } from "zod";
import { route } from "@/server/api";
import { addTransactions, listTransactions, updateTransactionCategory } from "@/server/finances";
import { body, searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const month = searchParams(req).get("month") ?? undefined;
  if (month && !/^\d{4}-\d{2}$/.test(month)) return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
  return Response.json(await listTransactions(month));
});

const txSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(200),
  amount: z.number().finite().min(-1e7).max(1e7),
  category: z.string().trim().min(1).max(40),
});

export const POST = route(async (req) => {
  const b = await body(req, z.object({ rows: z.array(txSchema).min(1).max(5000) }));
  return Response.json({ saved: await addTransactions(b.rows) }, { status: 201 });
});

export const PATCH = route(async (req) => {
  const b = await body(req, z.object({ id: z.number().int().positive(), category: z.string().trim().min(1).max(40) }));
  await updateTransactionCategory(b.id, b.category);
  return Response.json({ ok: true });
});
