import { route } from "@/server/api";
import { closePosition } from "@/server/alpaca/trading";
import { toOrderRows } from "@/server/order-rows";

export const dynamic = "force-dynamic";

/** Close the whole position with a market order. */
export const DELETE = route<{ params: Promise<{ symbol: string }> }>(async (_req, { params }) => {
  const { symbol } = await params;
  const order = await closePosition(symbol.toUpperCase());
  return Response.json((await toOrderRows([order]))[0]);
});
