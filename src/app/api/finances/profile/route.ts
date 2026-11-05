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
