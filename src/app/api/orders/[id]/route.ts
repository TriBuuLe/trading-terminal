import { z } from "zod";
import { priceDecimalsOk } from "@/lib/orders";
import { route } from "@/server/api";
import { cancelOrder, replaceOrder } from "@/server/alpaca/trading";
import { explainRejection } from "@/lib/orders";
import { UpstreamError } from "@/server/http";
import { toOrderRows } from "@/server/order-rows";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  await cancelOrder(id);
  return Response.json({ ok: true });
});

const dec = z.string().trim().regex(/^\d+(\.\d+)?$/);
const replaceSchema = z
  .object({
    qty: dec.optional(),
    limitPrice: dec.refine(priceDecimalsOk, "no sub-penny prices").optional(),
    stopPrice: dec.refine(priceDecimalsOk, "no sub-penny prices").optional(),
    tif: z.enum(["day", "gtc"]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to change");

/** Modify an open order (Alpaca replaces it with a new order id). */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const b = await body(req, replaceSchema);
  try {
    const o = await replaceOrder(id, {
      qty: b.qty,
      limit_price: b.limitPrice,
      stop_price: b.stopPrice,
      time_in_force: b.tif,
    });
    return Response.json((await toOrderRows([o]))[0]);
  } catch (e) {
    if (e instanceof UpstreamError) {
      return Response.json({ error: explainRejection(e.message, e.status) }, { status: e.status >= 500 ? 502 : e.status });
    }
    throw e;
  }
});
