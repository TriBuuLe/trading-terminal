import { z } from "zod";
import { route } from "@/server/api";
import { etParts } from "@/lib/time";
import { getYearSummary } from "@/server/finances";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("year") ?? etParts(new Date()).date.slice(0, 4);
  const year = z.coerce.number().int().min(2000).max(2100).parse(raw);
  return Response.json({ summary: await getYearSummary(year) });
});
