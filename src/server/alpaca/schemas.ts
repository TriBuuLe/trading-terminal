import { z } from "zod";

/** Alpaca sends money/qty as decimal strings. Keep them as strings; do math with Decimal. */
const dec = z.string();
const decN = z.string().nullable().optional();

export const accountSchema = z.looseObject({
  id: z.string(),
  account_number: z.string(),
  status: z.string(),
  currency: z.string(),
  cash: dec,
  portfolio_value: dec.optional(),
  equity: dec,
  last_equity: dec,
  buying_power: dec,
  daytrading_buying_power: decN,
  non_marginable_buying_power: decN,
  long_market_value: decN,
  short_market_value: decN,
  multiplier: z.string().optional(),
  daytrade_count: z.number().optional(),
  pattern_day_trader: z.boolean().optional(),
  trading_blocked: z.boolean().optional(),
  account_blocked: z.boolean().optional(),
  shorting_enabled: z.boolean().optional(),
  created_at: z.string().optional(),
});
export type Account = z.infer<typeof accountSchema>;

export const clockSchema = z.object({
  timestamp: z.string(),
  is_open: z.boolean(),
  next_open: z.string(),
  next_close: z.string(),
});
export type Clock = z.infer<typeof clockSchema>;

export const calendarDaySchema = z.looseObject({
  date: z.string(),
  open: z.string(),
  close: z.string(),
  session_open: z.string().optional(),
  session_close: z.string().optional(),
});
export const calendarSchema = z.array(calendarDaySchema);

export const assetSchema = z.looseObject({
  id: z.string(),
  class: z.string(),
  exchange: z.string(),
  symbol: z.string(),
  name: z.string(),
  status: z.string(),
  tradable: z.boolean(),
  marginable: z.boolean().optional(),
  shortable: z.boolean().optional(),
  easy_to_borrow: z.boolean().optional(),
  fractionable: z.boolean().optional(),
});
export type Asset = z.infer<typeof assetSchema>;
export const assetsSchema = z.array(assetSchema);

export const positionSchema = z.looseObject({
  asset_id: z.string(),
  symbol: z.string(),
  exchange: z.string().optional(),
  asset_class: z.string().optional(),
  avg_entry_price: dec,
  qty: dec,
  qty_available: decN,
  side: z.enum(["long", "short"]),
  market_value: decN,
  cost_basis: dec,
  unrealized_pl: decN,
  unrealized_plpc: decN,
  unrealized_intraday_pl: decN,
  unrealized_intraday_plpc: decN,
  current_price: decN,
  lastday_price: decN,
  change_today: decN,
});
export type Position = z.infer<typeof positionSchema>;
export const positionsSchema = z.array(positionSchema);

const baseOrder = z.looseObject({
  id: z.string(),
  client_order_id: z.string(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  filled_at: z.string().nullable().optional(),
  expired_at: z.string().nullable().optional(),
  canceled_at: z.string().nullable().optional(),
  failed_at: z.string().nullable().optional(),
  replaced_at: z.string().nullable().optional(),
  replaced_by: z.string().nullable().optional(),
  replaces: z.string().nullable().optional(),
  asset_id: z.string().optional(),
  symbol: z.string(),
  asset_class: z.string().optional(),
  notional: decN,
  qty: decN,
  filled_qty: dec,
  filled_avg_price: decN,
  order_class: z.string().optional(),
  type: z.string(),
  side: z.enum(["buy", "sell"]),
  time_in_force: z.string(),
  limit_price: decN,
  stop_price: decN,
  trail_price: decN,
  trail_percent: decN,
  status: z.string(),
  extended_hours: z.boolean().optional(),
});
export type Order = z.infer<typeof baseOrder> & { legs?: Order[] | null };
export const orderSchema: z.ZodType<Order> = baseOrder.extend({
  legs: z.lazy(() => z.array(orderSchema)).nullable().optional(),
});
export const ordersSchema = z.array(orderSchema);

export const fillActivitySchema = z.looseObject({
  id: z.string(),
  activity_type: z.literal("FILL"),
  transaction_time: z.string(),
  type: z.string(), // fill | partial_fill
  price: dec,
  qty: dec,
  side: z.string(), // buy | sell | sell_short
  symbol: z.string(),
  leaves_qty: dec.optional(),
  order_id: z.string(),
  cum_qty: dec.optional(),
  order_status: z.string().optional(),
});
export type FillActivity = z.infer<typeof fillActivitySchema>;
export const fillActivitiesSchema = z.array(fillActivitySchema);

export const portfolioHistorySchema = z.looseObject({
  timestamp: z.array(z.number()),
  equity: z.array(z.number().nullable()),
  profit_loss: z.array(z.number().nullable()),
  profit_loss_pct: z.array(z.number().nullable()),
  base_value: z.number().nullable(),
  base_value_asof: z.string().optional(),
  timeframe: z.string(),
});
export type PortfolioHistory = z.infer<typeof portfolioHistorySchema>;

// ---------- Market data ----------

export const tradeSchema = z.looseObject({ t: z.string(), p: z.number(), s: z.number(), x: z.string().optional() });
export const quoteSchema = z.looseObject({
  t: z.string(),
  ap: z.number(),
  as: z.number(),
  bp: z.number(),
  bs: z.number(),
});
export const barSchema = z.looseObject({
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
  n: z.number().optional(),
  vw: z.number().optional(),
});
export type Bar = z.infer<typeof barSchema>;

export const snapshotSchema = z.looseObject({
  latestTrade: tradeSchema.nullable().optional(),
  latestQuote: quoteSchema.nullable().optional(),
  minuteBar: barSchema.nullable().optional(),
  dailyBar: barSchema.nullable().optional(),
  prevDailyBar: barSchema.nullable().optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const snapshotsSchema = z.record(z.string(), snapshotSchema.nullable());

export const barsResponseSchema = z.object({
  bars: z.record(z.string(), z.array(barSchema)).nullable(),
  next_page_token: z.string().nullable().optional(),
});

export const latestQuotesSchema = z.object({ quotes: z.record(z.string(), quoteSchema) });

export const newsArticleSchema = z.looseObject({
  id: z.number(),
  headline: z.string(),
  author: z.string().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  summary: z.string().optional().nullable(),
  images: z.array(z.looseObject({ size: z.string(), url: z.string() })).optional(),
  symbols: z.array(z.string()),
  source: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
});
export type NewsArticle = z.infer<typeof newsArticleSchema>;
export const newsResponseSchema = z.object({
  news: z.array(newsArticleSchema),
  next_page_token: z.string().nullable().optional(),
});

export const moversSchema = z.looseObject({
  gainers: z.array(z.looseObject({ symbol: z.string(), percent_change: z.number(), change: z.number(), price: z.number() })),
  losers: z.array(z.looseObject({ symbol: z.string(), percent_change: z.number(), change: z.number(), price: z.number() })),
  market_type: z.string().optional(),
  last_updated: z.string(),
});
export const mostActivesSchema = z.looseObject({
  most_actives: z.array(z.looseObject({ symbol: z.string(), volume: z.number(), trade_count: z.number() })),
  last_updated: z.string(),
});
