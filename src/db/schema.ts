/**
 * System of record for the outbound system.
 *
 * The unit of outreach is the person, not the message: one person has identities on
 * several channels, is enrolled in one coordinated sequence, and receives touches on
 * those channels. Every touch is tagged with the levers we test (variant attributes)
 * and every outcome links back to it, so "what works" can be answered from this
 * database alone.
 */
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Detections } from '../audit/types';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const channelEnum = pgEnum('channel', ['email', 'linkedin', 'instagram', 'direct_mail', 'phone']);

export const companyStatusEnum = pgEnum('company_status', [
  'new',
  'researched',
  'qualified',
  'disqualified',
  'in_sequence',
  'engaged',
  'client',
]);

/** A person's judgment of whether a company is worth pursuing; the fit score is calibrated against these. */
export const fitVerdictEnum = pgEnum('fit_verdict', ['good_fit', 'too_big', 'too_small', 'wrong_type']);

export const roleTypeEnum = pgEnum('role_type', ['owner', 'marketing_lead', 'executive', 'other']);

export const verificationEnum = pgEnum('verification', ['unverified', 'valid', 'risky', 'invalid']);

/** `observed` = we saw it directly; `likely` = inferred, must be worded with its caveat. */
export const confidenceEnum = pgEnum('confidence', ['observed', 'likely']);

export const experimentStatusEnum = pgEnum('experiment_status', ['draft', 'running', 'stopped', 'concluded']);

export const enrollmentStatusEnum = pgEnum('enrollment_status', [
  'active',
  'paused',
  'replied',
  'completed',
  'opted_out',
  'stopped',
]);

export const touchStatusEnum = pgEnum('touch_status', [
  'drafted',
  'approved',
  'rejected',
  'scheduled',
  'sent',
  'failed',
  'skipped',
]);

export const replyClassEnum = pgEnum('reply_class', [
  'positive',
  'not_now',
  'negative',
  'wrong_person',
  'auto_reply',
  'opt_out',
  'unclassified',
]);

export const outcomeStageEnum = pgEnum('outcome_stage', [
  'meeting_booked',
  'meeting_held',
  'proposal_sent',
  'won',
  'lost',
]);

export const suppressionScopeEnum = pgEnum('suppression_scope', [
  'email',
  'domain',
  'linkedin',
  'instagram',
  'company',
  'person',
]);

export const suppressionReasonEnum = pgEnum('suppression_reason', [
  'opt_out',
  'client',
  'past_client',
  'bounce',
  'prior_contact',
  'competitor',
  'manual',
]);

export const companies = pgTable(
  'companies',
  {
    id: id(),
    name: text('name').notNull(),
    /** Registrable domain, lower-case, no scheme or `www.`. */
    domain: text('domain'),
    websiteUrl: text('website_url'),
    segment: text('segment'),
    city: text('city'),
    region: text('region'),
    country: text('country').notNull().default('US'),
    /** Which sourcing signal put this company on the list (e.g. `google_maps`, `ad_library`). */
    source: text('source').notNull(),
    sourceRef: jsonb('source_ref').$type<Record<string, unknown>>(),
    fitScore: integer('fit_score'),
    /** `A` = full cross-channel sequence, `B` = email only. */
    tier: text('tier'),
    status: companyStatusEnum('status').notNull().default('new'),
    fitVerdict: fitVerdictEnum('fit_verdict'),
    fitNote: text('fit_note'),
    fitMarkedAt: timestamp('fit_marked_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('companies_domain_uq').on(t.domain)],
);

export const people = pgTable(
  'people',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    title: text('title'),
    roleType: roleTypeEnum('role_type').notNull().default('other'),
    /** Where the name came from (company site, license record, state filing, LinkedIn...). */
    source: text('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('people_company_idx').on(t.companyId)],
);

/** One row per way of reaching a person: an email address, a LinkedIn URL, an Instagram handle... */
export const identities = pgTable(
  'identities',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    channel: channelEnum('channel').notNull(),
    /** Normalized value; see `src/db/suppression.ts` for the normalizers. */
    value: text('value').notNull(),
    verification: verificationEnum('verification').notNull().default('unverified'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    source: text('source'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('identities_channel_value_uq').on(t.channel, t.value), index('identities_person_idx').on(t.personId)],
);

/**
 * A finding about a company, always with the evidence that supports it.
 * A message may only state something that exists here.
 */
export const signals = pgTable(
  'signals',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Stable machine code, e.g. `analytics.ua_only`. */
    code: text('code').notNull(),
    /** Which collector produced it, e.g. `site_audit`. */
    collector: text('collector').notNull(),
    confidence: confidenceEnum('confidence').notNull(),
    /** Plain-language sentence that is safe to say to the prospect. */
    statement: text('statement').notNull(),
    /** What this check cannot see; must travel with `likely` findings. */
    caveat: text('caveat'),
    evidence: jsonb('evidence').$type<string[]>().notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('signals_company_code_idx').on(t.companyId, t.code)],
);

export const auditStatusEnum = pgEnum('audit_status', ['ok', 'not_auditable']);

/**
 * One visit by the site audit: what was installed, or why the site could not be audited.
 * Findings derived from it live in `signals`.
 */
export const siteAudits = pgTable(
  'site_audits',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    status: auditStatusEnum('status').notNull(),
    /** Why the site could not be audited, when status is `not_auditable`. */
    error: text('error'),
    pageTitle: text('page_title'),
    detections: jsonb('detections').$type<Detections>(),
    limitations: jsonb('limitations').$type<string[]>().notNull().default([]),
    auditedAt: timestamp('audited_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('site_audits_company_idx').on(t.companyId, t.auditedAt)],
);

export const adPlatformEnum = pgEnum('ad_platform', ['google', 'meta']);
export const adStatusEnum = pgEnum('ad_status', ['active', 'lapsed', 'none']);

/** What a public ad library says about a company's advertising, as of one check. */
export const adChecks = pgTable(
  'ad_checks',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    platform: adPlatformEnum('platform').notNull(),
    status: adStatusEnum('status').notNull(),
    adCount: integer('ad_count').notNull(),
    advertisers: jsonb('advertisers')
      .$type<{ id: string; name: string; adCount?: number; lastShown?: string | null; thirdParty?: boolean }[]>()
      .notNull()
      .default([]),
    formats: jsonb('formats').$type<Record<string, number>>(),
    /** YYYY-MM-DD */
    firstShown: text('first_shown'),
    lastShown: text('last_shown'),
    sourceUrl: text('source_url').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ad_checks_company_idx').on(t.companyId, t.platform, t.checkedAt)],
);

export const experiments = pgTable(
  'experiments',
  {
    id: id(),
    name: text('name').notNull(),
    hypothesis: text('hypothesis').notNull(),
    primaryMetric: text('primary_metric').notNull().default('positive_reply_rate'),
    status: experimentStatusEnum('status').notNull().default('draft'),
    conclusion: text('conclusion'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('experiments_name_uq').on(t.name)],
);

/** One arm of an experiment. `attributes` holds the levers being tested (angle, offer, channel mix...). */
export const variants = pgTable(
  'variants',
  {
    id: id(),
    experimentId: uuid('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    attributes: jsonb('attributes').$type<Record<string, string>>().notNull(),
    weight: integer('weight').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('variants_experiment_name_uq').on(t.experimentId, t.name)],
);

export interface SequenceStep {
  step: number;
  channel: (typeof channelEnum.enumValues)[number];
  /** Days after enrollment start. */
  dayOffset: number;
  /** What this touch adds that earlier ones did not. */
  purpose: string;
}

export const sequences = pgTable(
  'sequences',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    steps: jsonb('steps').$type<SequenceStep[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sequences_name_uq').on(t.name)],
);

/** A person running through a sequence. Pausing here pauses every channel at once. */
export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    sequenceId: uuid('sequence_id')
      .notNull()
      .references(() => sequences.id),
    variantId: uuid('variant_id').references(() => variants.id),
    status: enrollmentStatusEnum('status').notNull().default('active'),
    statusReason: text('status_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('enrollments_person_sequence_uq').on(t.personId, t.sequenceId)],
);

/** One outreach action on one channel. */
export const touches = pgTable(
  'touches',
  {
    id: id(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    channel: channelEnum('channel').notNull(),
    stepNo: integer('step_no').notNull(),
    identityId: uuid('identity_id').references(() => identities.id),
    /** The finding this message leads with. */
    signalId: uuid('signal_id').references(() => signals.id),
    status: touchStatusEnum('status').notNull().default('drafted'),
    subject: text('subject'),
    /** The draft as generated, kept so human edits can be measured and learned from. */
    draftBody: text('draft_body'),
    /** The text that was (or will be) sent. */
    body: text('body'),
    /** Experiment tags copied from the variant plus per-message ones (length, tone...). */
    attributes: jsonb('attributes').$type<Record<string, string>>(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('touches_enrollment_step_uq').on(t.enrollmentId, t.stepNo), index('touches_person_idx').on(t.personId)],
);

export const replies = pgTable(
  'replies',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** The touch this answers, when it can be determined. */
    touchId: uuid('touch_id').references(() => touches.id, { onDelete: 'set null' }),
    channel: channelEnum('channel').notNull(),
    body: text('body').notNull(),
    classification: replyClassEnum('classification').notNull().default('unclassified'),
    /** `model` or the reviewer's name; human corrections overwrite the model's label. */
    classifiedBy: text('classified_by'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('replies_person_idx').on(t.personId)],
);

/** Raw provider events (delivered, bounced, connection accepted...) for audit and debugging. */
export const events = pgTable(
  'events',
  {
    id: id(),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'cascade' }),
    touchId: uuid('touch_id').references(() => touches.id, { onDelete: 'set null' }),
    channel: channelEnum('channel'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_touch_idx').on(t.touchId), index('events_type_idx').on(t.type)],
);

/** Business results, from booked meeting through to closed revenue. */
export const outcomes = pgTable(
  'outcomes',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),
    stage: outcomeStageEnum('stage').notNull(),
    valueUsd: numeric('value_usd', { precision: 12, scale: 2 }),
    attributedTouchId: uuid('attributed_touch_id').references(() => touches.id, { onDelete: 'set null' }),
    notes: text('notes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outcomes_company_idx').on(t.companyId)],
);

/**
 * Do-not-contact list. Checked before every touch on every channel: an opt-out on one
 * channel suppresses the person everywhere.
 */
export const suppressions = pgTable(
  'suppressions',
  {
    id: id(),
    scope: suppressionScopeEnum('scope').notNull(),
    /** Normalized value for the scope (email, domain, profile URL, handle, or row id). */
    value: text('value').notNull(),
    reason: suppressionReasonEnum('reason').notNull(),
    source: text('source'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('suppressions_scope_value_uq').on(t.scope, t.value)],
);
