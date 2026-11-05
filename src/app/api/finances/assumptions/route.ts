import { DEFAULT_ASSUMPTIONS } from "@/lib/planner/assumptions";
import { assumptionsSchema } from "@/lib/planner/schema";
import { route } from "@/server/api";
import { getAssumptions, saveAssumptions } from "@/server/finances";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json({ assumptions: await getAssumptions(), defaults: DEFAULT_ASSUMPTIONS }));
export const PUT = route(async (req) => {
  await saveAssumptions(await body(req, assumptionsSchema));
  return Response.json({ ok: true });
});
export const DELETE = route(async () => {
  await saveAssumptions(null);
  return Response.json({ ok: true });
});
