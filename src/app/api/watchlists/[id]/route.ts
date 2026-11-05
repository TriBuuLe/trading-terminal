import { z } from "zod";
import { route } from "@/server/api";
import { body } from "@/server/req";
import { deleteWatchlist, listWatchlists, updateWatchlist } from "@/server/watchlists";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const idOf = async (p: Ctx["params"]) => z.coerce.number().int().positive().parse((await p).id);

export const PATCH = route<Ctx>(async (req, { params }) => {
  const id = await idOf(params);
  const b = await body(req, z.object({ name: z.string().trim().min(1).max(40).optional(), isActive: z.literal(true).optional() }));
  await updateWatchlist(id, b);
  return Response.json(await listWatchlists());
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const id = await idOf(params);
  const lists = await listWatchlists();
  if (lists.length <= 1) return Response.json({ error: "Keep at least one watchlist" }, { status: 400 });
  await deleteWatchlist(id);
  const rest = await listWatchlists();
  if (!rest.some((l) => l.isActive) && rest[0]) await updateWatchlist(rest[0].id, { isActive: true });
  return Response.json(await listWatchlists());
});
