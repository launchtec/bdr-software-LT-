CREATE TYPE "public"."fit_verdict" AS ENUM('good_fit', 'too_big', 'too_small', 'wrong_type');--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fit_verdict" "fit_verdict";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fit_note" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fit_marked_at" timestamp with time zone;