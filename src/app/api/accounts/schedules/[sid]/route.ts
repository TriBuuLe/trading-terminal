import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mockSchedules } from "@/db/schema";
import { route } from "@/server/api";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ sid: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const sid = z.coerce.number().int().positive().parse((await params).sid);
  const b = await body(req, z.object({ active: z.boolean() }));
  await db().update(mockSchedules).set({ active: b.active }).where(eq(mockSchedules.id, sid));
  return Response.json({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  await db().delete(mockSchedules).where(eq(mockSchedules.id, z.coerce.number().int().positive().parse((await params).sid)));
  return Response.json({ ok: true });
});
