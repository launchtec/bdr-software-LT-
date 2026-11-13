CREATE TYPE "public"."ad_platform" AS ENUM('google', 'meta');--> statement-breakpoint
CREATE TYPE "public"."ad_status" AS ENUM('active', 'lapsed', 'none');--> statement-breakpoint
CREATE TABLE "ad_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" "ad_platform" NOT NULL,
	"status" "ad_status" NOT NULL,
	"ad_count" integer NOT NULL,
	"advertisers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"formats" jsonb,
	"first_shown" text,
	"last_shown" text,
	"source_url" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_checks" ADD CONSTRAINT "ad_checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_checks_company_idx" ON "ad_checks" USING btree ("company_id","platform","checked_at");