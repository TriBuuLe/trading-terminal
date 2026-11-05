import { z } from "zod";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { route } from "@/server/api";
import { listAlerts } from "@/server/alerts";
import { getAssetInfo } from "@/server/orders";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await listAlerts()));

const createSchema = z
  .object({
    symbol: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.\-/]{0,9}$/),
    kind: z.enum(["above", "below", "pct_move", "earnings"]),
    threshold: z.number().positive(),
    note: z.string().trim().max(200).optional(),
    repeat: z.boolean().default(false),
  })
  .refine((a) => a.kind !== "earnings" || (Number.isInteger(a.threshold) && a.threshold <= 30), { message: "earnings: days ahead, 1–30", path: ["threshold"] })
  .refine((a) => a.kind !== "pct_move" || a.threshold <= 100, { message: "% move must be ≤ 100", path: ["threshold"] });

export const POST = route(async (req) => {
  const b = await body(req, createSchema);
  if (!(await getAssetInfo(b.symbol))) return Response.json({ error: `${b.symbol} is not a tradable US stock on Alpaca` }, { status: 404 });
  const [row] = await db().insert(alerts).values(b).returning();
  return Response.json(row, { status: 201 });
});
