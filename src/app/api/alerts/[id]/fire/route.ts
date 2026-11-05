import { z } from "zod";
import { route } from "@/server/api";
import { fireAlert } from "@/server/alerts";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Called by the browser's alert evaluator. Idempotent: returns fired=false if already fired / cooling down. */
export const POST = route<Ctx>(async (req, { params }) => {
  const id = z.coerce.number().int().positive().parse((await params).id);
  const b = await body(req, z.object({ price: z.number().nullable(), message: z.string().trim().min(1).max(300) }));
  return Response.json({ fired: await fireAlert(id, b.price, b.message) });
});
