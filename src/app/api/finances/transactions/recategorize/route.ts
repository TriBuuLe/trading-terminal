import { z } from "zod";
import { route } from "@/server/api";
import { recategorizePreview, setCategories } from "@/server/finances";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

/** Saved transactions the current category rules would place differently. */
export const GET = route(async () => Response.json(await recategorizePreview()));

/** Apply the changes the user confirmed. */
export const POST = route(async (req) => {
  const b = await body(req, z.object({ changes: z.array(z.object({ id: z.number().int().positive(), category: z.string().trim().min(1).max(40) })).min(1).max(5000) }));
  return Response.json({ updated: await setCategories(b.changes) });
});
