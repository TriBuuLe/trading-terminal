import { z } from "zod";
import { route } from "@/server/api";
import { getPlan, listVersions, saveVersion } from "@/server/finances";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await listVersions()));

/** Save the current plan as a named version (headline numbers + profile snapshot). */
export const POST = route(async (req) => {
  const b = await body(req, z.object({ name: z.string().trim().min(1).max(80), note: z.string().max(500).optional() }));
  const r = await getPlan({ runs: 2000 });
  if (!r) return Response.json({ error: "Set up your finances first" }, { status: 400 });
  const id = await saveVersion(b.name, {
    note: b.note ?? null,
    profile: r.profile,
    headline: {
      monthlyIncome: r.plan.monthlyIncome,
      available: r.plan.cashFlow.available,
      goals: r.plan.goals.map((g) => ({ name: g.goal.name, required: g.requiredMonthly, allocated: g.allocatedMonthly, probability: g.sim.probability })),
      netWorthP50: r.plan.netWorth.sim.p50,
    },
  });
  return Response.json({ id }, { status: 201 });
});
