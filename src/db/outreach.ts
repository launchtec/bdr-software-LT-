/**
 * Outreach packages and the record of what happens to them.
 *
 * A package is everything prepared for one company: the research dossier, the person to
 * reach, where to reach them, and the drafted messages. Messages start as drafts; a
 * person approves, sends and logs the outcome, and every step is recorded here so the
 * results can be compared by channel, angle and source.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { InvalidIngestError } from './ingest';
import {
  channelEnum,
  companies,
  enrollments,
  experiments,
  identities,
  people,
  replies,
  replyClassEnum,
  sequences,
  touches,
  variants,
  type SequenceStep,
} from './schema';
import { normalizeDomain, normalizeEmail, suppress, type Db } from './suppression';

export type Channel = (typeof channelEnum.enumValues)[number];
export type ReplyClass = (typeof replyClassEnum.enumValues)[number];

export interface OutreachIngest {
  domain: string;
  research?: Record<string, unknown>;
  person?: {
    fullName: string;
    firstName?: string;
    title?: string;
    roleType?: 'owner' | 'marketing_lead' | 'executive' | 'other';
    confidence?: string;
    sourceUrl?: string;
    source: string;
  };
  /** Where this person or their company can be reached. */
  identities?: { channel: Channel; value: string; source?: string }[];
  sequence?: { name: string; description?: string; steps: SequenceStep[] };
  variant?: { experiment: { name: string; hypothesis: string }; name: string; attributes: Record<string, string> };
  messages?: { stepNo: number; channel: Channel; subject?: string; body: string; attributes?: Record<string, string> }[];
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isChannel = (v: unknown): v is Channel => typeof v === 'string' && (channelEnum.enumValues as readonly string[]).includes(v);

/** Checks the shape of one outreach package from an untrusted request body. */
export function parseOutreachIngest(raw: unknown): OutreachIngest {
  if (typeof raw !== 'object' || raw === null) throw new InvalidIngestError('Each item must be an object.');
  const item = raw as Record<string, any>;
  if (!isString(item.domain) || !normalizeDomain(item.domain).includes('.')) {
    throw new InvalidIngestError('Each item needs a company domain.');
  }
  const fail = (what: string): never => {
    throw new InvalidIngestError(`Malformed ${what} for ${item.domain}.`);
  };

  if (item.research !== undefined && (typeof item.research !== 'object' || item.research === null || Array.isArray(item.research))) {
    fail('research');
  }
  if (item.person !== undefined && !(isString(item.person?.fullName) && isString(item.person?.source))) fail('person');
  if (item.identities !== undefined) {
    if (!Array.isArray(item.identities) || !item.identities.every((i: any) => isChannel(i?.channel) && isString(i?.value))) {
      fail('identities');
    }
  }
  if (item.sequence !== undefined) {
    const ok =
      isString(item.sequence?.name) &&
      Array.isArray(item.sequence.steps) &&
      item.sequence.steps.every(
        (s: any) => Number.isInteger(s?.step) && isChannel(s?.channel) && Number.isInteger(s?.dayOffset) && isString(s?.purpose),
      );
    if (!ok) fail('sequence');
  }
  if (item.variant !== undefined) {
    const ok =
      isString(item.variant?.name) &&
      isString(item.variant?.experiment?.name) &&
      isString(item.variant?.experiment?.hypothesis) &&
      typeof item.variant.attributes === 'object' &&
      item.variant.attributes !== null;
    if (!ok) fail('variant');
  }
  if (item.messages !== undefined) {
    const ok =
      Array.isArray(item.messages) &&
      item.messages.every((m: any) => Number.isInteger(m?.stepNo) && isChannel(m?.channel) && isString(m?.body)) &&
      new Set(item.messages.map((m: any) => m.stepNo)).size === item.messages.length;
    if (!ok) fail('messages');
    if (item.messages.length > 0 && !item.sequence) throw new InvalidIngestError(`Messages for ${item.domain} need a sequence.`);
  }
  return item as OutreachIngest;
}

function normalizeIdentity(channel: Channel, value: string): string {
  if (channel === 'email') return normalizeEmail(value);
  if (channel === 'phone' || channel === 'direct_mail') return value.trim();
  // Profile URLs: lower-case host and path, no scheme, query or trailing slash.
  return value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export interface OutreachResult {
  companyId: string;
  personId: string | null;
  draftsWritten: number;
  /** Messages left alone because a person had already approved or sent them. */
  draftsKept: number;
}

/**
 * Stores an outreach package. Safe to send again: research and contact details are
 * updated, drafts that nobody has acted on are replaced, and anything already approved
 * or sent is never touched. Returns null if the company is not in the database.
 */
export async function ingestOutreach(db: Db, input: OutreachIngest): Promise<OutreachResult | null> {
  const domain = normalizeDomain(input.domain);
  const company = (await db.select().from(companies).where(eq(companies.domain, domain)).limit(1))[0];
  if (!company) return null;

  if (input.research) {
    await db.update(companies).set({ research: input.research, researchedAt: new Date(), updatedAt: new Date() }).where(eq(companies.id, company.id));
  }

  const messages = input.messages ?? [];
  // Messages need someone to address; without a named person, they go to a stand-in for the owner.
  const personInput = input.person ?? (messages.length > 0 || input.identities?.length ? { fullName: 'Owner (name not found)', source: 'placeholder' } : null);
  if (!personInput) return { companyId: company.id, personId: null, draftsWritten: 0, draftsKept: 0 };

  const existingPeople = await db.select().from(people).where(eq(people.companyId, company.id));
  let person = existingPeople.find((p) => p.fullName.toLowerCase() === personInput.fullName.toLowerCase());
  // A real name replaces the stand-in rather than sitting beside it.
  const placeholder = existingPeople.find((p) => p.source === 'placeholder');
  const details = {
    fullName: personInput.fullName,
    firstName: 'firstName' in personInput ? personInput.firstName : undefined,
    title: 'title' in personInput ? personInput.title : undefined,
    roleType: ('roleType' in personInput ? personInput.roleType : undefined) ?? ('other' as const),
    confidence: 'confidence' in personInput ? personInput.confidence : undefined,
    sourceUrl: 'sourceUrl' in personInput ? personInput.sourceUrl : undefined,
    source: personInput.source,
  };
  if (person) {
    await db.update(people).set(details).where(eq(people.id, person.id));
  } else if (placeholder && personInput.source !== 'placeholder') {
    await db.update(people).set(details).where(eq(people.id, placeholder.id));
    person = placeholder;
  } else {
    [person] = await db.insert(people).values({ companyId: company.id, ...details }).returning();
  }
  const personId = person!.id;

  for (const identity of input.identities ?? []) {
    await db
      .insert(identities)
      .values({ personId, channel: identity.channel, value: normalizeIdentity(identity.channel, identity.value), source: identity.source })
      .onConflictDoNothing();
  }

  if (messages.length === 0 || !input.sequence) return { companyId: company.id, personId, draftsWritten: 0, draftsKept: 0 };

  const [sequence] = await db
    .insert(sequences)
    .values({ name: input.sequence.name, description: input.sequence.description, steps: input.sequence.steps })
    .onConflictDoUpdate({ target: sequences.name, set: { steps: input.sequence.steps, description: input.sequence.description } })
    .returning();

  let variantId: string | null = null;
  if (input.variant) {
    const [experiment] = await db
      .insert(experiments)
      .values({ name: input.variant.experiment.name, hypothesis: input.variant.experiment.hypothesis })
      .onConflictDoUpdate({ target: experiments.name, set: { hypothesis: input.variant.experiment.hypothesis } })
      .returning();
    const [variant] = await db
      .insert(variants)
      .values({ experimentId: experiment!.id, name: input.variant.name, attributes: input.variant.attributes })
      .onConflictDoUpdate({ target: [variants.experimentId, variants.name], set: { attributes: input.variant.attributes } })
      .returning();
    variantId = variant!.id;
  }

  const [enrollment] = await db
    .insert(enrollments)
    .values({ personId, sequenceId: sequence!.id, variantId })
    .onConflictDoUpdate({ target: [enrollments.personId, enrollments.sequenceId], set: { variantId } })
    .returning();

  const personIdentities = await db.select().from(identities).where(eq(identities.personId, personId));
  const existingTouches = await db.select().from(touches).where(eq(touches.enrollmentId, enrollment!.id));

  let draftsWritten = 0;
  let draftsKept = 0;
  for (const message of messages) {
    const existing = existingTouches.find((t) => t.stepNo === message.stepNo);
    const values = {
      channel: message.channel,
      identityId: personIdentities.find((i) => i.channel === message.channel)?.id ?? null,
      subject: message.subject ?? null,
      draftBody: message.body,
      body: message.body,
      attributes: { ...(input.variant?.attributes ?? {}), ...(message.attributes ?? {}) },
    };
    if (!existing) {
      await db.insert(touches).values({ enrollmentId: enrollment!.id, personId, stepNo: message.stepNo, ...values });
      draftsWritten += 1;
    } else if (existing.status === 'drafted' || existing.status === 'rejected') {
      await db.update(touches).set({ ...values, status: 'drafted' }).where(eq(touches.id, existing.id));
      draftsWritten += 1;
    } else {
      draftsKept += 1;
    }
  }
  return { companyId: company.id, personId, draftsWritten, draftsKept };
}

/** Saves a person's edit to a message that has not been sent. The original draft is kept for comparison. */
export async function editTouch(db: Db, touchId: string, edit: { subject?: string | null; body: string }): Promise<boolean> {
  const updated = await db
    .update(touches)
    .set({ body: edit.body, ...(edit.subject === undefined ? {} : { subject: edit.subject }) })
    .where(and(eq(touches.id, touchId), inArray(touches.status, ['drafted', 'approved', 'rejected'])))
    .returning({ id: touches.id });
  return updated.length > 0;
}

export type TouchAction = 'approve' | 'unapprove' | 'sent' | 'skip';

/** Moves a message through its life: approve, send, or skip. Returns false if the move is not allowed. */
export async function actOnTouch(db: Db, touchId: string, action: TouchAction, by: string): Promise<boolean> {
  const now = new Date();
  const moves: Record<TouchAction, { from: (typeof touches.$inferSelect.status)[]; set: Partial<typeof touches.$inferInsert> }> = {
    approve: { from: ['drafted', 'rejected'], set: { status: 'approved', reviewedBy: by, reviewedAt: now } },
    unapprove: { from: ['approved', 'skipped'], set: { status: 'drafted' } },
    sent: { from: ['drafted', 'approved'], set: { status: 'sent', sentAt: now, reviewedBy: by, reviewedAt: now } },
    skip: { from: ['drafted', 'approved'], set: { status: 'skipped', reviewedBy: by, reviewedAt: now } },
  };
  const move = moves[action];
  const updated = await db
    .update(touches)
    .set(move.set)
    .where(and(eq(touches.id, touchId), inArray(touches.status, move.from)))
    .returning({ id: touches.id });
  return updated.length > 0;
}

/**
 * Records a reply to a sent message and stops the rest of that person's sequence, on
 * every channel. An opt-out also puts the person, and every address we hold for them,
 * on the do-not-contact list.
 */
export async function logReply(
  db: Db,
  touchId: string,
  reply: { classification: ReplyClass; body?: string; by: string },
): Promise<boolean> {
  const touch = (await db.select().from(touches).where(eq(touches.id, touchId)).limit(1))[0];
  if (!touch || touch.status !== 'sent') return false;

  await db.insert(replies).values({
    personId: touch.personId,
    touchId: touch.id,
    channel: touch.channel,
    body: reply.body?.trim() || '(not recorded)',
    classification: reply.classification,
    classifiedBy: reply.by,
    receivedAt: new Date(),
  });

  if (reply.classification === 'opt_out') {
    await suppress(db, { scope: 'person', value: touch.personId, reason: 'opt_out', source: `reply on ${touch.channel}` });
    for (const identity of await db.select().from(identities).where(eq(identities.personId, touch.personId))) {
      if (identity.channel === 'email' || identity.channel === 'linkedin' || identity.channel === 'instagram') {
        await suppress(db, { scope: identity.channel, value: identity.value, reason: 'opt_out', source: `reply on ${touch.channel}` });
      }
    }
  }

  const stopped = reply.classification === 'opt_out' ? 'opted_out' : 'replied';
  await db
    .update(enrollments)
    .set({ status: stopped, statusReason: `Reply on ${touch.channel}: ${reply.classification}`, endedAt: new Date() })
    .where(eq(enrollments.id, touch.enrollmentId));
  await db
    .update(touches)
    .set({ status: 'skipped' })
    .where(and(eq(touches.enrollmentId, touch.enrollmentId), inArray(touches.status, ['drafted', 'approved', 'scheduled'])));
  return true;
}
