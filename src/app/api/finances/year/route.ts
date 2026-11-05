import { z } from "zod";
import { etParts } from "@/lib/time";
import { route } from "@/server/api";
import { getYearProgress } from "@/server/finances";

export const dynamic = "force-dynamic";

/** The year plan vs statements (?year=2026), and long-term goals. */
export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("year") ?? etParts(new Date()).date.slice(0, 4);
  return Response.json(await getYearProgress(z.coerce.number().int().min(2000).max(2100).parse(raw)));
});
