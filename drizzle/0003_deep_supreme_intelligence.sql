CREATE TABLE "account_rules" (
	"year" integer NOT NULL,
	"jurisdiction" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"source_url" text NOT NULL,
	"quote" text NOT NULL,
	"verified_at" text NOT NULL,
	CONSTRAINT "account_rules_jurisdiction_year_key_pk" PRIMARY KEY("jurisdiction","year","key")
);
--> statement-breakpoint
CREATE TABLE "mock_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"first_contribution_tax_year" integer,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mock_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"amount" numeric(24, 9) NOT NULL,
	"day_of_month" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_txns" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"tax_year" integer,
	"symbol" text,
	"qty" numeric(24, 9),
	"price" numeric(24, 9),
	"cash" numeric(24, 9) NOT NULL,
	"basis_delta" numeric(24, 9) DEFAULT '0' NOT NULL,
	"quote_price" numeric(24, 9),
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mock_schedules" ADD CONSTRAINT "mock_schedules_account_id_mock_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mock_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_txns" ADD CONSTRAINT "mock_txns_account_id_mock_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mock_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mock_txns_account" ON "mock_txns" USING btree ("account_id","at");