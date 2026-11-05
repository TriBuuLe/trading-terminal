import { z } from "zod";
import { orderRequestSchema } from "@/lib/orders";
import { route } from "@/server/api";
import { getAccount, listOrders } from "@/server/alpaca/trading";
import { toOrderRows } from "@/server/order-rows";
import { submitOrder, upsertOrders } from "@/server/orders";
import { body, searchParams } from "@/server/req";

export const dynamic = "force-dynamic";

const listQuery = z.object({
  status: z.enum(["open", "closed", "all"]).default("open"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const GET = route(async (req) => {
  const q = listQuery.parse(Object.fromEntries(searchParams(req)));
  const orders = await listOrders({ status: q.status, limit: q.limit });
  if (q.status !== "open" && orders.length) {
    // Keep our own copy (history survives paper-account resets).
    const a = await getAccount();
    await upsertOrders(orders, a.account_number);
  }
  return Response.json(await toOrderRows(orders));
});

export const POST = route(async (req) => {
  const o = await body(req, orderRequestSchema);
  const { order, journalId } = await submitOrder(o);
  return Response.json({ order: (await toOrderRows([order]))[0], journalId }, { status: 201 });
});
