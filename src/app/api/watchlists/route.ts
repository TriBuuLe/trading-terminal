import { z } from "zod";
import { route } from "@/server/api";
import { body } from "@/server/req";
import { createWatchlist, listWatchlists } from "@/server/watchlists";

export const dynamic = "force-dynamic";

export const GET = route(async () => Response.json(await listWatchlists()));

export const POST = route(async (req) => {
  const b = await body(req, z.object({ name: z.string().trim().min(1).max(40) }));
  await createWatchlist(b.name);
  return Response.json(await listWatchlists(), { status: 201 });
});
