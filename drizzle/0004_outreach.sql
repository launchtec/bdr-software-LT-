ALTER TYPE "public"."channel" ADD VALUE 'facebook';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "research" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "researched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "source_url" text;