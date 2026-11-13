import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { companies, enrollments, identities, people, replies, touches } from '@/db/schema';

export type Touch = typeof touches.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Identity = typeof identities.$inferSelect;
export type Reply = typeof replies.$inferSelect;

export interface OutreachMessage {
  touch: Touch;
  /** Where to send it, when we have an address for this channel. */
  identity: Identity | null;
  reply: Reply | null;
}

export interface OutreachCase {
  company: typeof companies.$inferSelect;
  person: Person;
  enrollment: typeof enrollments.$inferSelect;
  messages: OutreachMessage[];
}

/** A link a person can click to reach the address on its channel. */
export function identityLink(identity: Identity | null): string | null {
  if (!identity) return null;
  if (identity.channel === 'email') return `mailto:${identity.value}`;
  if (identity.channel === 'phone') return `tel:${identity.value}`;
  if (identity.channel === 'direct_mail') return null;
  return `https://${identity.value}`;
}

async function load(companyId?: string): Promise<OutreachCase[]> {
  const db = getDb();
  const companyRows = companyId
    ? await db.select().from(companies).where(eq(companies.id, companyId))
    : await db.select().from(companies).orderBy(asc(companies.name));
  if (companyRows.length === 0) return [];

  const peopleRows = await db.select().from(people).where(inArray(people.companyId, companyRows.map((c) => c.id)));
  if (peopleRows.length === 0) return [];
  const personIds = peopleRows.map((p) => p.id);

  const [enrollmentRows, touchRows, identityRows, replyRows] = await Promise.all([
    db.select().from(enrollments).where(inArray(enrollments.personId, personIds)),
    db.select().from(touches).where(inArray(touches.personId, personIds)).orderBy(asc(touches.stepNo)),
    db.select().from(identities).where(inArray(identities.personId, personIds)),
    db.select().from(replies).where(inArray(replies.personId, personIds)),
  ]);

  const cases: OutreachCase[] = [];
  for (const enrollment of enrollmentRows) {
    const person = peopleRows.find((p) => p.id === enrollment.personId)!;
    const company = companyRows.find((c) => c.id === person.companyId)!;
    const messages = touchRows
      .filter((t) => t.enrollmentId === enrollment.id)
      .map((touch) => ({
        touch,
        identity:
          identityRows.find((i) => i.id === touch.identityId) ??
          identityRows.find((i) => i.personId === person.id && i.channel === touch.channel) ??
          null,
        reply: replyRows.find((r) => r.touchId === touch.id) ?? null,
      }));
    if (messages.length > 0) cases.push({ company, person, enrollment, messages });
  }
  return cases.sort((a, b) => a.company.name.localeCompare(b.company.name));
}

export const listOutreach = () => load();
export const getOutreachForCompany = (companyId: string) => load(companyId);

/** Everyone we know at a company, with their addresses. */
export async function getPeople(companyId: string): Promise<{ person: Person; identities: Identity[] }[]> {
  const db = getDb();
  const peopleRows = await db.select().from(people).where(eq(people.companyId, companyId));
  if (peopleRows.length === 0) return [];
  const identityRows = await db.select().from(identities).where(inArray(identities.personId, peopleRows.map((p) => p.id)));
  return peopleRows.map((person) => ({ person, identities: identityRows.filter((i) => i.personId === person.id) }));
}
