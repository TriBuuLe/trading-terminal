import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tsz("created_at").notNull().defaultNow();
/** Exact decimal for money/qty. Drizzle returns these as strings; do math with Decimal. */
const money = (name: string) => numeric(name, { precision: 24, scale: 9 });

/** Key/value settings (JSON values). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
});

export const watchlists = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: createdAt(),
});

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    watchlistId: integer("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("watchlist_items_unique").on(t.watchlistId, t.symbol)],
);

/**
 * One row per submitted order: the "why", tags, and the quote at submit time
 * (for measured slippage). Linked to Alpaca orders via clientOrderId/orderId.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: serial("id").primaryKey(),
    clientOrderId: text("client_order_id").notNull(),
    orderId: text("order_id"),
    accountNumber: text("account_number"),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    orderType: text("order_type").notNull(),
    orderClass: text("order_class").notNull().default("simple"),
    timeInForce: text("time_in_force").notNull(),
    qty: money("qty"),
    notional: money("notional"),
    limitPrice: money("limit_price"),
    stopPrice: money("stop_price"),
    takeProfit: money("take_profit"),
    stopLoss: money("stop_loss"),
    why: text("why").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    quoteBid: doublePrecision("quote_bid"),
    quoteAsk: doublePrecision("quote_ask"),
    quoteLast: doublePrecision("quote_last"),
    quoteAt: tsz("quote_at"),
    status: text("status").notNull().default("submitting"),
    rejectReason: text("reject_reason"),
    source: text("source").notNull().default("ticket"), // ticket | palette | demo
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("journal_client_order_id").on(t.clientOrderId), index("journal_order_id").on(t.orderId)],
);

/** Copy of every Alpaca order, so history survives paper-account resets. */
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(), // Alpaca order id
    accountNumber: text("account_number").notNull(),
    clientOrderId: text("client_order_id").notNull(),
    parentId: text("parent_id"), // bracket legs point at their parent
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    type: text("type").notNull(),
    orderClass: text("order_class"),
    timeInForce: text("time_in_force").notNull(),
    qty: money("qty"),
    notional: money("notional"),
    filledQty: money("filled_qty"),
    filledAvgPrice: money("filled_avg_price"),
    limitPrice: money("limit_price"),
    stopPrice: money("stop_price"),
    status: text("status").notNull(),
    submittedAt: tsz("submitted_at"),
    filledAt: tsz("filled_at"),
    canceledAt: tsz("canceled_at"),
    raw: jsonb("raw").notNull(),
    syncedAt: tsz("synced_at").notNull().defaultNow(),
  },
  (t) => [index("orders_symbol").on(t.symbol), index("orders_submitted").on(t.submittedAt)],
);

/** Copy of every FILL activity. */
export const fills = pgTable(
  "fills",
  {
    id: text("id").primaryKey(), // Alpaca activity id
    accountNumber: text("account_number").notNull(),
    orderId: text("order_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(), // buy | sell | sell_short
    qty: money("qty").notNull(),
    price: money("price").notNull(),
    type: text("type").notNull(), // fill | partial_fill
    transactionTime: tsz("transaction_time").notNull(),
    raw: jsonb("raw").notNull(),
    syncedAt: tsz("synced_at").notNull().defaultNow(),
  },
  (t) => [index("fills_symbol_time").on(t.symbol, t.transactionTime), index("fills_order").on(t.orderId)],
);

/** Our own end-of-day equity snapshots, complementing Alpaca portfolio history. */
export const equitySnapshots = pgTable(
  "equity_snapshots",
  {
    date: text("date").notNull(), // YYYY-MM-DD (America/New_York)
    accountNumber: text("account_number").notNull(),
    equity: money("equity").notNull(),
    cash: money("cash").notNull(),
    longMarketValue: money("long_market_value"),
    spyClose: doublePrecision("spy_close"),
    takenAt: tsz("taken_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.date, t.accountNumber] })],
);

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  kind: text("kind", { enum: ["above", "below", "pct_move", "earnings"] }).notNull(),
  threshold: doublePrecision("threshold"), // price for above/below, % for pct_move, days for earnings
  note: text("note"),
  active: boolean("active").notNull().default(true),
  repeat: boolean("repeat").notNull().default(false),
  lastFiredAt: tsz("last_fired_at"),
  createdAt: createdAt(),
});

export const alertEvents = pgTable(
  "alert_events",
  {
    id: serial("id").primaryKey(),
    alertId: integer("alert_id").references(() => alerts.id, { onDelete: "set null" }),
    symbol: text("symbol").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    price: doublePrecision("price"),
    firedAt: tsz("fired_at").notNull().defaultNow(),
    seen: boolean("seen").notNull().default(false),
  },
  (t) => [index("alert_events_fired").on(t.firedAt)],
);

// ---------- infrastructure ----------

/** Shared API response cache (survives across serverless invocations). */
export const apiCache = pgTable(
  "api_cache",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    storedAt: tsz("stored_at").notNull().defaultNow(),
    expiresAt: tsz("expires_at").notNull(),
  },
  (t) => [index("api_cache_expires").on(t.expiresAt)],
);

/** Token buckets shared by every instance; updated atomically in SQL. */
export const rateLimits = pgTable("rate_limits", {
  name: text("name").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
  /** Set after an upstream 429: nobody calls that service until this time. */
  blockedUntil: tsz("blocked_until"),
});

/** Per-minute upstream request counter (for the budget display and verification). */
export const apiUsage = pgTable(
  "api_usage",
  {
    service: text("service").notNull(),
    minute: tsz("minute").notNull(),
    count: integer("count").notNull().default(0),
    throttled: integer("throttled").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.service, t.minute] })],
);

/** Orders/positions in DEMO_MODE (never sent anywhere). */
export const demoState = pgTable("demo_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
});
