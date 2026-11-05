import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { alertEvents } from "@/db/schema";
import { route } from "@/server/api";
import { recentEvents } from "@/server/alerts";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await recentEvents()));

/** Mark events seen (dismiss the earnings banner). */
export const PATCH = route(async (req) => {
  const b = await body(req, z.object({ ids: z.array(z.number().int().positive()).max(500) }));
  if (b.ids.length) await db().update(alertEvents).set({ seen: true }).where(inArray(alertEvents.id, b.ids));
  return Response.json({ ok: true });
});
