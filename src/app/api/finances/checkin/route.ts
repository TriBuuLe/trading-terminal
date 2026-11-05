import { route } from "@/server/api";
import { checkIn, thisMonth } from "@/server/finances";
import { searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const m = searchParams(req).get("month") ?? thisMonth();
  if (!/^\d{4}-\d{2}$/.test(m)) return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
  return Response.json(await checkIn(m));
});
