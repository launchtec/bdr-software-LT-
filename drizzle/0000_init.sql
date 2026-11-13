CREATE TYPE "public"."channel" AS ENUM('email', 'linkedin', 'instagram', 'direct_mail', 'phone');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('new', 'researched', 'qualified', 'disqualified', 'in_sequence', 'engaged', 'client');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('observed', 'likely');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'paused', 'replied', 'completed', 'opted_out', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('draft', 'running', 'stopped', 'concluded');--> statement-breakpoint
CREATE TYPE "public"."outcome_stage" AS ENUM('meeting_booked', 'meeting_held', 'proposal_sent', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."reply_class" AS ENUM('positive', 'not_now', 'negative', 'wrong_person', 'auto_reply', 'opt_out', 'unclassified');--> statement-breakpoint
CREATE TYPE "public"."role_type" AS ENUM('owner', 'marketing_lead', 'executive', 'other');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('opt_out', 'client', 'past_client', 'bounce', 'prior_contact', 'competitor', 'manual');--> statement-breakpoint
CREATE TYPE "public"."suppression_scope" AS ENUM('email', 'domain', 'linkedin', 'instagram', 'company', 'person');--> statement-breakpoint
CREATE TYPE "public"."touch_status" AS ENUM('drafted', 'approved', 'rejected', 'scheduled', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."verification" AS ENUM('unverified', 'valid', 'risky', 'invalid');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"website_url" text,
	"segment" text,
	"city" text,
	"region" text,
	"country" text DEFAULT 'US' NOT NULL,
	"source" text NOT NULL,
	"source_ref" jsonb,
	"fit_score" integer,
	"tier" text,
	"status" "company_status" DEFAULT 'new' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"variant_id" uuid,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"touch_id" uuid,
	"channel" "channel",
	"type" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text NOT NULL,
	"primary_metric" text DEFAULT 'positive_reply_rate' NOT NULL,
	"status" "experiment_status" DEFAULT 'draft' NOT NULL,
	"conclusion" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"value" text NOT NULL,
	"verification" "verification" DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid,
	"stage" "outcome_stage" NOT NULL,
	"value_usd" numeric(12, 2),
	"attributed_touch_id" uuid,
	"notes" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"role_type" "role_type" DEFAULT 'other' NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"touch_id" uuid,
	"channel" "channel" NOT NULL,
	"body" text NOT NULL,
	"classification" "reply_class" DEFAULT 'unclassified' NOT NULL,
	"classified_by" text,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"collector" text NOT NULL,
	"confidence" "confidence" NOT NULL,
	"statement" text NOT NULL,
	"caveat" text,
	"evidence" jsonb NOT NULL,
	"data" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "suppression_scope" NOT NULL,
	"value" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"step_no" integer NOT NULL,
	"identity_id" uuid,
	"signal_id" uuid,
	"status" "touch_status" DEFAULT 'drafted' NOT NULL,
	"subject" text,
	"draft_body" text,
	"body" text,
	"attributes" jsonb,
	"model" text,
	"prompt_version" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_touch_id_touches_id_fk" FOREIGN KEY ("touch_id") REFERENCES "public"."touches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_attributed_touch_id_touches_id_fk" FOREIGN KEY ("attributed_touch_id") REFERENCES "public"."touches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_touch_id_touches_id_fk" FOREIGN KEY ("touch_id") REFERENCES "public"."touches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_domain_uq" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_person_sequence_uq" ON "enrollments" USING btree ("person_id","sequence_id");--> statement-breakpoint
CREATE INDEX "events_touch_idx" ON "events" USING btree ("touch_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_name_uq" ON "experiments" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_channel_value_uq" ON "identities" USING btree ("channel","value");--> statement-breakpoint
CREATE INDEX "identities_person_idx" ON "identities" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "outcomes_company_idx" ON "outcomes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "people_company_idx" ON "people" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "replies_person_idx" ON "replies" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sequences_name_uq" ON "sequences" USING btree ("name");--> statement-breakpoint
CREATE INDEX "signals_company_code_idx" ON "signals" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_scope_value_uq" ON "suppressions" USING btree ("scope","value");--> statement-breakpoint
CREATE UNIQUE INDEX "touches_enrollment_step_uq" ON "touches" USING btree ("enrollment_id","step_no");--> statement-breakpoint
CREATE INDEX "touches_person_idx" ON "touches" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_experiment_name_uq" ON "variants" USING btree ("experiment_id","name");