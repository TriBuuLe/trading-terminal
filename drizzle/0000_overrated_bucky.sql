CREATE TABLE "alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer,
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"price" double precision,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"threshold" double precision,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"repeat" boolean DEFAULT false NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"service" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"throttled" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_usage_service_minute_pk" PRIMARY KEY("service","minute")
);
--> statement-breakpoint
CREATE TABLE "demo_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"date" text NOT NULL,
	"account_number" text NOT NULL,
	"equity" numeric(24, 9) NOT NULL,
	"cash" numeric(24, 9) NOT NULL,
	"long_market_value" numeric(24, 9),
	"spy_close" double precision,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equity_snapshots_date_account_number_pk" PRIMARY KEY("date","account_number")
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" text PRIMARY KEY NOT NULL,
	"account_number" text NOT NULL,
	"order_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"qty" numeric(24, 9) NOT NULL,
	"price" numeric(24, 9) NOT NULL,
	"type" text NOT NULL,
	"transaction_time" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_order_id" text NOT NULL,
	"order_id" text,
	"account_number" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"order_type" text NOT NULL,
	"order_class" text DEFAULT 'simple' NOT NULL,
	"time_in_force" text NOT NULL,
	"qty" numeric(24, 9),
	"notional" numeric(24, 9),
	"limit_price" numeric(24, 9),
	"stop_price" numeric(24, 9),
	"take_profit" numeric(24, 9),
	"stop_loss" numeric(24, 9),
	"why" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quote_bid" double precision,
	"quote_ask" double precision,
	"quote_last" double precision,
	"quote_at" timestamp with time zone,
	"status" text DEFAULT 'submitting' NOT NULL,
	"reject_reason" text,
	"source" text DEFAULT 'ticket' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"account_number" text NOT NULL,
	"client_order_id" text NOT NULL,
	"parent_id" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"order_class" text,
	"time_in_force" text NOT NULL,
	"qty" numeric(24, 9),
	"notional" numeric(24, 9),
	"filled_qty" numeric(24, 9),
	"filled_avg_price" numeric(24, 9),
	"limit_price" numeric(24, 9),
	"stop_price" numeric(24, 9),
	"status" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"filled_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"name" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"watchlist_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_fired" ON "alert_events" USING btree ("fired_at");--> statement-breakpoint
CREATE INDEX "api_cache_expires" ON "api_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "fills_symbol_time" ON "fills" USING btree ("symbol","transaction_time");--> statement-breakpoint
CREATE INDEX "fills_order" ON "fills" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_client_order_id" ON "journal_entries" USING btree ("client_order_id");--> statement-breakpoint
CREATE INDEX "journal_order_id" ON "journal_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_symbol" ON "orders" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "orders_submitted" ON "orders" USING btree ("submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_unique" ON "watchlist_items" USING btree ("watchlist_id","symbol");