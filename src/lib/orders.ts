import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Order ticket request (browser -> /api/orders) and the validation rules,
 * shared by the ticket (instant feedback) and the server (authoritative).
 *
 * Rules from Alpaca docs (verified Nov 2026):
 *  - `notional` (dollar amount): market orders, time_in_force=day only. (The
 *    fractional-trading page says limit/stop work too; the order API reference
 *    says market only. We follow the stricter one.)
 *  - Fractional qty: asset must be `fractionable`; time_in_force=day only.
 *  - Bracket: both take_profit.limit_price and stop_loss.stop_price required;
 *    TIF day|gtc; no extended hours; entry market or limit. We require whole
 *    shares (fractional brackets aren't documented as supported).
 *  - extended_hours: limit orders with day|gtc only.
 *  - Prices: no sub-penny increments (>= $1: 2 decimals; < $1: 4 decimals).
 */
export const ORDER_TAGS = ["momentum", "earnings", "dip-buy", "breakout", "swing", "long-term", "news", "hedge", "other"] as const;

const decStr = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a positive number");

export const orderRequestSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9.\-/]{0,9}$/, "invalid symbol"),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit", "stop", "stop_limit"]),
  sizeBy: z.enum(["shares", "dollars"]),
  qty: decStr.optional(),
  notional: decStr.optional(),
  limitPrice: decStr.optional(),
  stopPrice: decStr.optional(),
  tif: z.enum(["day", "gtc"]),
  extendedHours: z.boolean().default(false),
  bracket: z
    .object({
      takeProfit: decStr,
      stopLoss: decStr,
      stopLossLimit: decStr.optional(),
    })
    .optional(),
  why: z.string().trim().min(3, "say why in a few words").max(300),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  source: z.enum(["ticket", "palette"]).default("ticket"),
});
export type OrderRequest = z.infer<typeof orderRequestSchema>;

export interface AssetInfo {
  symbol: string;
  tradable: boolean;
  fractionable: boolean;
  shortable: boolean;
}

export function priceDecimalsOk(price: string): boolean {
  const d = new Decimal(price);
  const dp = d.decimalPlaces();
  return d.gte(1) ? dp <= 2 : dp <= 4;
}

/** Returns a list of human-readable problems; empty means OK to submit. */
export function validateOrder(
  o: OrderRequest,
  asset: AssetInfo | null,
  ctx: { positionQty?: string | null } = {},
): string[] {
  const errs: string[] = [];
  if (!asset) return [`${o.symbol} isn't a tradable US stock on Alpaca`];
  if (!asset.tradable) errs.push(`${o.symbol} is not tradable right now`);

  const needsLimit = o.type === "limit" || o.type === "stop_limit";
  const needsStop = o.type === "stop" || o.type === "stop_limit";
  if (needsLimit && !o.limitPrice) errs.push("Limit price is required");
  if (needsStop && !o.stopPrice) errs.push("Stop price is required");
  if (!needsLimit && o.limitPrice) errs.push("Limit price only applies to limit / stop-limit orders");
  if (!needsStop && o.stopPrice) errs.push("Stop price only applies to stop / stop-limit orders");

  for (const [label, p] of [
    ["Limit", o.limitPrice],
    ["Stop", o.stopPrice],
    ["Take-profit", o.bracket?.takeProfit],
    ["Stop-loss", o.bracket?.stopLoss],
    ["Stop-loss limit", o.bracket?.stopLossLimit],
  ] as const) {
    if (p === undefined) continue;
    if (new Decimal(p).lte(0)) errs.push(`${label} price must be above 0`);
    else if (!priceDecimalsOk(p)) errs.push(`${label} price: no sub-penny prices (2 decimals at or above $1, 4 below)`);
  }

  // Size
  let fractional = false;
  if (o.sizeBy === "shares") {
    if (!o.qty) errs.push("Enter a quantity");
    else {
      const q = new Decimal(o.qty);
      if (q.lte(0)) errs.push("Quantity must be above 0");
      if (q.decimalPlaces() > 9) errs.push("Quantity: at most 9 decimals");
      fractional = !q.isInteger();
    }
    if (o.notional) errs.push("Use either shares or dollars, not both");
  } else {
    if (!o.notional) errs.push("Enter a dollar amount");
    else {
      const n = new Decimal(o.notional);
      if (n.lt(1)) errs.push("Dollar amount must be at least $1");
      if (n.decimalPlaces() > 2) errs.push("Dollar amount: cents at most");
    }
    if (o.qty) errs.push("Use either shares or dollars, not both");
    if (o.type !== "market") errs.push("Dollar-amount orders must be market orders (Alpaca rule)");
    fractional = true;
  }

  if (fractional) {
    if (!asset.fractionable) errs.push(`${o.symbol} doesn't support fractional shares; use whole shares`);
    if (o.tif !== "day") errs.push("Fractional / dollar orders must be DAY orders (Alpaca rule)");
  }

  if (o.extendedHours) {
    if (o.type !== "limit") errs.push("Extended-hours orders must be limit orders");
    if (o.bracket) errs.push("Bracket orders can't run in extended hours");
  }

  // Selling without a long position = short sale.
  const pos = ctx.positionQty ? new Decimal(ctx.positionQty) : new Decimal(0);
  if (o.side === "sell" && pos.lte(0) && !asset.shortable) {
    errs.push(`${o.symbol} can't be shorted (not shortable on Alpaca)`);
  }
  if (o.side === "sell" && pos.lte(0) && fractional) {
    errs.push("Fractional short selling isn't supported");
  }

  if (o.bracket) {
    if (fractional) errs.push("Bracket orders need whole shares");
    if (o.type !== "market" && o.type !== "limit") errs.push("Bracket entry must be market or limit");
    const tp = new Decimal(o.bracket.takeProfit);
    const sl = new Decimal(o.bracket.stopLoss);
    if (o.side === "buy" && !tp.gt(sl)) errs.push("For a buy bracket, take-profit must be above stop-loss");
    if (o.side === "sell" && !tp.lt(sl)) errs.push("For a sell bracket, take-profit must be below stop-loss");
    if (o.type === "limit" && o.limitPrice) {
      const lp = new Decimal(o.limitPrice);
      if (o.side === "buy" && !(tp.gt(lp) && sl.lt(lp))) errs.push("Buy bracket: stop-loss < entry < take-profit");
      if (o.side === "sell" && !(tp.lt(lp) && sl.gt(lp))) errs.push("Sell bracket: take-profit < entry < stop-loss");
    }
    if (o.bracket.stopLossLimit) {
      const sll = new Decimal(o.bracket.stopLossLimit);
      if (o.side === "buy" && sll.gt(sl)) errs.push("Stop-loss limit should be at or below the stop-loss trigger");
      if (o.side === "sell" && sll.lt(sl)) errs.push("Stop-loss limit should be at or above the stop-loss trigger");
    }
  }
  return errs;
}

export interface PreviewInput {
  order: Pick<OrderRequest, "side" | "type" | "sizeBy" | "qty" | "notional" | "limitPrice" | "stopPrice" | "bracket">;
  /** Reference price: ask for buys / bid for sells when available, else last. */
  refPrice: number | null;
  equity: string | null;
  buyingPower: string | null;
}

export interface Preview {
  estPrice: Decimal | null;
  estShares: Decimal | null;
  estCost: Decimal | null;
  pctOfEquity: Decimal | null;
  buyingPowerAfter: Decimal | null;
  riskToStop: Decimal | null;
  riskPctOfEquity: Decimal | null;
  rewardToTarget: Decimal | null;
}

/** Pre-trade preview. Pure; Decimal math so totals don't drift. */
export function previewOrder({ order: o, refPrice, equity, buyingPower }: PreviewInput): Preview {
  const px =
    o.type === "limit" || o.type === "stop_limit"
      ? o.limitPrice
        ? new Decimal(o.limitPrice)
        : null
      : o.type === "stop"
        ? o.stopPrice
          ? new Decimal(o.stopPrice)
          : null
        : refPrice !== null && refPrice > 0
          ? new Decimal(refPrice)
          : null;

  let shares: Decimal | null = null;
  let cost: Decimal | null = null;
  if (o.sizeBy === "shares" && o.qty && /^\d+(\.\d+)?$/.test(o.qty)) {
    shares = new Decimal(o.qty);
    cost = px ? shares.mul(px) : null;
  } else if (o.sizeBy === "dollars" && o.notional && /^\d+(\.\d+)?$/.test(o.notional)) {
    cost = new Decimal(o.notional);
    shares = px && px.gt(0) ? cost.div(px).toDecimalPlaces(6, Decimal.ROUND_DOWN) : null;
  }

  const eq = equity ? new Decimal(equity) : null;
  const bp = buyingPower ? new Decimal(buyingPower) : null;
  const pct = cost && eq && eq.gt(0) ? cost.div(eq).mul(100) : null;
  const bpAfter = bp && cost ? (o.side === "buy" ? bp.minus(cost) : bp) : null;

  let risk: Decimal | null = null;
  let reward: Decimal | null = null;
  if (o.bracket && px && shares) {
    const sl = new Decimal(o.bracket.stopLoss);
    const tp = new Decimal(o.bracket.takeProfit);
    risk = (o.side === "buy" ? px.minus(sl) : sl.minus(px)).mul(shares);
    reward = (o.side === "buy" ? tp.minus(px) : px.minus(tp)).mul(shares);
  }
  const riskPct = risk && eq && eq.gt(0) ? risk.div(eq).mul(100) : null;

  return {
    estPrice: px,
    estShares: shares,
    estCost: cost,
    pctOfEquity: pct,
    buyingPowerAfter: bpAfter,
    riskToStop: risk,
    riskPctOfEquity: riskPct,
    rewardToTarget: reward,
  };
}

/**
 * Turn Alpaca rejection text into a plain-language explanation.
 * Alpaca returns e.g. 403 {"code":40310000,"message":"insufficient buying power"}
 * and 403 "trade denied due to pattern day trading protection".
 */
export function explainRejection(message: string, status?: number): string {
  const m = message.toLowerCase();
  if (m.includes("pattern day")) {
    return (
      "Blocked by the Pattern Day Trader rule: accounts under $25,000 equity can make at most 3 day trades " +
      "(buy and sell the same stock the same day) in 5 business days. Alpaca's paper account enforces this like a real broker. " +
      "Hold overnight, or wait for the window to roll."
    );
  }
  if (m.includes("insufficient buying power") || m.includes("buying power")) {
    return "Not enough buying power for this order (open orders also reserve buying power). Reduce the size or cancel other open orders.";
  }
  if (m.includes("insufficient qty") || m.includes("insufficient quantity")) {
    return "You don't have enough shares available to sell (some may be held by another open order, e.g. a bracket leg).";
  }
  if (m.includes("market is closed") || m.includes("market hours") || m.includes("not open")) {
    return "The market is closed for this order type. Use a DAY/GTC order to queue it for the next open, or a limit order with extended hours.";
  }
  if (m.includes("cannot replace order in accepted status") || m.includes("pending_new")) {
    return "This order is queued for the next market open and can't be modified until then. Cancel it and place a new one instead.";
  }
  if (m.includes("not fractionable")) return "This stock doesn't support fractional shares. Use whole shares.";
  if (m.includes("sub-penny")) return "Price has too many decimals (no sub-penny prices).";
  if (m.includes("wash trade") || m.includes("potential wash")) {
    return "Rejected as a potential wash trade: you have an opposite-side open order on this stock. Cancel it first.";
  }
  if (m.includes("not shortable") || m.includes("cannot be sold short")) return "This stock can't be shorted right now.";
  return status ? `Alpaca rejected the order (HTTP ${status}): ${message}` : `Alpaca rejected the order: ${message}`;
}
