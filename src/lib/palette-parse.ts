import type { OrderRequest } from "./orders";

/**
 * Parse quick-order text from the command palette, e.g.
 *   "buy 10 AAPL limit 180"   "sell 5 tsla"   "buy $500 MSFT"
 *   "buy 10 AAPL stop 170"    "sell 3 NVDA stop 120 limit 119.5"
 * Returns a ticket prefill (the user still reviews and confirms in the ticket).
 */
export type ParsedOrder = Pick<OrderRequest, "side" | "symbol" | "type" | "sizeBy"> & {
  qty?: string;
  notional?: string;
  limitPrice?: string;
  stopPrice?: string;
};

const NUM = String.raw`(\d+(?:\.\d+)?)`;

export function parseOrderText(input: string): ParsedOrder | null {
  const t = input.trim().replace(/\s+/g, " ");
  const m = new RegExp(String.raw`^(buy|sell|b|s)\s+(\$?)${NUM}\s+(?:shares?\s+(?:of\s+)?)?([a-z][a-z0-9.\-/]{0,9})(.*)$`, "i").exec(t);
  if (!m) return null;
  const side = m[1]!.toLowerCase().startsWith("b") ? "buy" : "sell";
  const dollars = m[2] === "$";
  const amount = m[3]!;
  const symbol = m[4]!.toUpperCase();
  const rest = m[5]!.toLowerCase();

  const limit = new RegExp(String.raw`(?:limit|lmt|@)\s*\$?${NUM}`).exec(rest)?.[1];
  const stop = new RegExp(String.raw`(?:stop|stp)\s*\$?${NUM}`).exec(rest)?.[1];
  const type: OrderRequest["type"] = limit && stop ? "stop_limit" : limit ? "limit" : stop ? "stop" : "market";
  return {
    side,
    symbol,
    type,
    sizeBy: dollars ? "dollars" : "shares",
    ...(dollars ? { notional: amount } : { qty: amount }),
    ...(limit ? { limitPrice: limit } : {}),
    ...(stop ? { stopPrice: stop } : {}),
  };
}
