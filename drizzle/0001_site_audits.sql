CREATE TYPE "public"."audit_status" AS ENUM('ok', 'not_auditable');--> statement-breakpoint
CREATE TABLE "site_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" "audit_status" NOT NULL,
	"error" text,
	"page_title" text,
	"detections" jsonb,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audited_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_audits_company_idx" ON "site_audits" USING btree ("company_id","audited_at");