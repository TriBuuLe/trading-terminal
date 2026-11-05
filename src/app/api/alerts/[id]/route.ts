import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { route } from "@/server/api";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const idOf = async (p: Ctx["params"]) => z.coerce.number().int().positive().parse((await p).id);

export const PATCH = route<Ctx>(async (req, { params }) => {
  const id = await idOf(params);
  const b = await body(req, z.object({ active: z.boolean() }));
  // Re-activating clears the cooldown so it can fire again.
  const [row] = await db().update(alerts).set({ active: b.active, ...(b.active ? { lastFiredAt: null } : {}) }).where(eq(alerts.id, id)).returning();
  return row ? Response.json(row) : Response.json({ error: "not found" }, { status: 404 });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await db().delete(alerts).where(eq(alerts.id, await idOf(params)));
  return Response.json({ ok: true });
});
