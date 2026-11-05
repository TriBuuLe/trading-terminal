import { route } from "@/server/api";
import { fillsForSymbol } from "@/server/sync";
import { searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

/** My fills for one symbol (for chart markers). */
export const GET = route(async (req) => {
  const symbol = (searchParams(req).get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-/]{0,9}$/.test(symbol)) return Response.json({ error: "symbol required" }, { status: 400 });
  const rows = await fillsForSymbol(symbol);
  return Response.json(rows.map((f) => ({ id: f.id, side: f.side, qty: f.qty, price: f.price, time: f.transactionTime.toISOString(), orderId: f.orderId })));
});
