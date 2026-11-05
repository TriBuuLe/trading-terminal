import { z } from "zod";
import { route } from "@/server/api";
import { getAssetInfo } from "@/server/orders";
import { body } from "@/server/req";
import { addSymbol, listWatchlists, removeSymbol, reorderSymbols } from "@/server/watchlists";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const idOf = async (p: Ctx["params"]) => z.coerce.number().int().positive().parse((await p).id);
const sym = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.\-/]{0,9}$/);

export const POST = route<Ctx>(async (req, { params }) => {
  const id = await idOf(params);
  const { symbol } = await body(req, z.object({ symbol: sym }));
  const asset = await getAssetInfo(symbol); // validate against Alpaca assets
  if (!asset) return Response.json({ error: `${symbol} is not a tradable US stock on Alpaca` }, { status: 404 });
  await addSymbol(id, asset.symbol);
  return Response.json(await listWatchlists(), { status: 201 });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const id = await idOf(params);
  const { symbol } = await body(req, z.object({ symbol: sym }));
  await removeSymbol(id, symbol);
  return Response.json(await listWatchlists());
});

/** Reorder: full ordered symbol list. */
export const PUT = route<Ctx>(async (req, { params }) => {
  const id = await idOf(params);
  const { symbols } = await body(req, z.object({ symbols: z.array(sym).max(500) }));
  await reorderSymbols(id, symbols);
  return Response.json(await listWatchlists());
});
