import { z } from "zod";
import { route } from "@/server/api";
import { getHistory, RANGES } from "@/server/portfolio";
import { searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const range = z.enum(RANGES).default("ALL").parse(searchParams(req).get("range") ?? undefined);
  return Response.json(await getHistory(range));
});
