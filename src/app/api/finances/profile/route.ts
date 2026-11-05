import { z } from "zod";
import { profileInputSchema } from "@/lib/planner/schema";
import { route } from "@/server/api";
import { getProfile, saveProfile } from "@/server/finances";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json({ profile: await getProfile() }));

export const PUT = route(async (req) => {
  const p = await body(req, profileInputSchema);
  await saveProfile(p);
  return Response.json({ ok: true });
});

/** Small settings changes without resending the whole profile. */
const patchSchema = z.object({
  budgetBasis: z.enum(["planned", "actual"]).optional(),
  /** Set one mapping: transaction category → budget line ("" = don't map, null = remove the mapping). */
  mapCategory: z.object({ from: z.string().trim().min(1).max(40), to: z.string().max(40).nullable() }).optional(),
});

export const PATCH = route(async (req) => {
  const b = await body(req, patchSchema);
  const p = await getProfile();
  if (!p) return Response.json({ error: "Set up your finances first" }, { status: 400 });
  const next = { ...p };
  if (b.budgetBasis) next.budgetBasis = b.budgetBasis;
  if (b.mapCategory) {
    const map = { ...(p.categoryMap ?? {}) };
    if (b.mapCategory.to === null) delete map[b.mapCategory.from];
    else map[b.mapCategory.from] = b.mapCategory.to;
    next.categoryMap = map;
  }
  await saveProfile(next);
  return Response.json({ ok: true });
});
