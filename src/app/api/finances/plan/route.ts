import { route } from "@/server/api";
import { getPlan } from "@/server/finances";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const r = await getPlan();
  if (!r) return Response.json({ plan: null });
  return Response.json({
    plan: r.plan,
    assumptions: r.assumptions,
    spending: r.spending,
    basis: r.basis,
    budgetBasisSetting: r.profile.budgetBasis ?? "planned",
    alternate: r.alternate,
  });
});
