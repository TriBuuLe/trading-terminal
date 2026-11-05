import { z } from "zod";
import { importCsv } from "@/lib/planner/csv";
import { route } from "@/server/api";
import { myRules } from "@/server/finances";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

/** Parse a bank CSV and suggest categories. Nothing is stored until the user confirms. */
export const POST = route(async (req) => {
  const b = await body(req, z.object({ csv: z.string().min(1).max(5_000_000) }));
  try {
    return Response.json(importCsv(b.csv, await myRules()));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
});
