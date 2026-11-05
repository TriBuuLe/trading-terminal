CREATE TABLE "assets" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"exchange" text NOT NULL,
	"tradable" boolean NOT NULL,
	"fractionable" boolean DEFAULT false NOT NULL,
	"shortable" boolean DEFAULT false NOT NULL,
	"easy_to_borrow" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assets_name" ON "assets" USING btree ("name");