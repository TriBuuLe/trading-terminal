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

/** Tradable US equities from Alpaca (/v2/assets), for symbol search/validation. Synced daily. */
export const assets = pgTable(
  "assets",
  {
    symbol: text("symbol").primaryKey(),
    name: text("name").notNull(),
    exchange: text("exchange").notNull(),
    tradable: boolean("tradable").notNull(),
    fractionable: boolean("fractionable").notNull().default(false),
    shortable: boolean("shortable").notNull().default(false),
    easyToBorrow: boolean("easy_to_borrow").notNull().default(false),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("assets_name").on(t.name)],
);

// ---------- financial planner (sensitive: encrypted at rest, AES-256-GCM) ----------

/** Encrypted JSON documents keyed by name ("profile", …). Only the key and timestamp are plaintext. */
export const finRecords = pgTable("fin_records", {
  key: text("key").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  updatedAt: tsz("updated_at").notNull().defaultNow(),
});

/** Imported/entered transactions. Only the month (YYYY-MM) is plaintext, for filtering. */
export const finTransactions = pgTable(
  "fin_transactions",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    ciphertext: text("ciphertext").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("fin_tx_month").on(t.month)],
);

/** Saved plan versions / scenarios (encrypted snapshot of profile + changes + headline results). */
export const planVersions = pgTable("plan_versions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ciphertext: text("ciphertext").notNull(),
  createdAt: createdAt(),
});

// ---------- mock tax-advantaged accounts (simulated broker) ----------

/** Year-versioned official limits/rules (seeded from src/lib/accounts/rules.ts, each with a source URL). */
export const accountRules = pgTable(
  "account_rules",
  {
    year: integer("year").notNull(),
    jurisdiction: text("jurisdiction", { enum: ["US", "CA"] }).notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    sourceUrl: text("source_url").notNull(),
    quote: text("quote").notNull(),
    verifiedAt: text("verified_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.jurisdiction, t.year, t.key] })],
);

/** Simulated accounts (paper money; separate from the Alpaca trading sandbox). */
export const mockAccounts = pgTable("mock_accounts", {
  id: serial("id").primaryKey(),
  type: text("type", { enum: ["ROTH_IRA", "TRADITIONAL_IRA", "401K", "HSA", "TFSA", "RRSP", "FHSA", "TAXABLE"] }).notNull(),
  name: text("name").notNull(),
  /** Roth 5-year clock: first tax year a contribution was made for. FHSA: year opened. */
  firstContributionTaxYear: integer("first_contribution_tax_year"),
  openedAt: tsz("opened_at").notNull().defaultNow(),
  closedAt: tsz("closed_at"),
});

/** Append-only ledger; balances/positions are replayed from it. */
export const mockTxns = pgTable(
  "mock_txns",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => mockAccounts.id, { onDelete: "cascade" }),
    at: tsz("at").notNull().defaultNow(),
    kind: text("kind", { enum: ["contribution", "withdrawal", "buy", "sell"] }).notNull(),
    taxYear: integer("tax_year"),
    symbol: text("symbol"),
    qty: money("qty"),
    price: money("price"),
    /** Cash change in the account (+ in, − out). */
    cash: money("cash").notNull(),
    /** Roth: change in contribution basis (contributions +, withdrawals of basis −). */
    basisDelta: money("basis_delta").notNull().default("0"),
    quotePrice: money("quote_price"),
    note: text("note"),
    source: text("source").notNull().default("manual"), // manual | fund | schedule
  },
  (t) => [index("mock_txns_account").on(t.accountId, t.at)],
);

/** Auto-contribution schedules (run by the daily cron on their day of month). */
export const mockSchedules = pgTable("mock_schedules", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => mockAccounts.id, { onDelete: "cascade" }),
  amount: money("amount").notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
  active: boolean("active").notNull().default(true),
  lastRunMonth: text("last_run_month"),
  createdAt: createdAt(),
});

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
