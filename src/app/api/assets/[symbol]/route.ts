import { route } from "@/server/api";
import { getAssetInfo } from "@/server/orders";

export const dynamic = "force-dynamic";

export const GET = route<{ params: Promise<{ symbol: string }> }>(async (_req, { params }) => {
  const { symbol } = await params;
  const a = await getAssetInfo(symbol);
  if (!a) return Response.json({ error: `${symbol.toUpperCase()} is not a tradable US stock on Alpaca` }, { status: 404 });
  return Response.json(a);
});
