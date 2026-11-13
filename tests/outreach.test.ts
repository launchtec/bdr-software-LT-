import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { InvalidIngestError } from '../src/db/ingest';
import { actOnTouch, editTouch, ingestOutreach, logReply, parseOutreachIngest, type OutreachIngest } from '../src/db/outreach';
import * as schema from '../src/db/schema';
import { findSuppression, type Db } from '../src/db/suppression';

let db: Db;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: './drizzle' });
  db = pglite as unknown as Db;
});

const sequence = {
  name: 'Test sequence',
  steps: [
    { step: 1, channel: 'email' as const, dayOffset: 0, purpose: 'The finding' },
    { step: 2, channel: 'facebook' as const, dayOffset: 2, purpose: 'Short nudge on another channel' },
  ],
};

function pkg(domain: string, over: Partial<OutreachIngest> = {}): OutreachIngest {
  return {
    domain,
    research: { whatTheyDo: 'Fences', sizeClues: ['Family-owned'] },
    person: { fullName: 'Pat Owner', firstName: 'Pat', title: 'Owner', roleType: 'owner', confidence: 'high', sourceUrl: `https://${domain}/about`, source: 'company_site' },
    identities: [
      { channel: 'email', value: ` Pat@${domain} ` },
      { channel: 'facebook', value: `https://www.Facebook.com/${domain.split('.')[0]}/?ref=x` },
    ],
    sequence,
    variant: { experiment: { name: 'Opener angle', hypothesis: 'A specific finding beats a general offer' }, name: 'finding-first', attributes: { angle: 'finding' } },
    messages: [
      { stepNo: 1, channel: 'email', subject: 'your Google ads', body: 'Hi Pat, first draft.' },
      { stepNo: 2, channel: 'facebook', body: 'Hi, short note.' },
    ],
    ...over,
  };
}

async function company(domain: string) {
  const [row] = await db.insert(schema.companies).values({ name: domain, domain, source: 'test' }).returning();
  return row!;
}
const touchesOf = async (personId: string) =>
  (await db.select().from(schema.touches).where(eq(schema.touches.personId, personId))).sort((a, b) => a.stepNo - b.stepNo);

describe('ingestOutreach', () => {
  it('stores the dossier, the person, their addresses and the drafts', async () => {
    const c = await company('acme.test');
    const result = await ingestOutreach(db, pkg('acme.test'));
    expect(result).toMatchObject({ companyId: c.id, draftsWritten: 2, draftsKept: 0 });

    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, c.id));
    expect(row?.research).toEqual({ whatTheyDo: 'Fences', sizeClues: ['Family-owned'] });
    expect(row?.researchedAt).toBeInstanceOf(Date);

    const [person] = await db.select().from(schema.people).where(eq(schema.people.companyId, c.id));
    expect(person).toMatchObject({ fullName: 'Pat Owner', roleType: 'owner', confidence: 'high' });

    const ids = await db.select().from(schema.identities).where(eq(schema.identities.personId, person!.id));
    expect(ids.map((i) => `${i.channel}:${i.value}`).sort()).toEqual(['email:pat@acme.test', 'facebook:facebook.com/acme']);

    const drafts = await touchesOf(person!.id);
    expect(drafts.map((t) => [t.stepNo, t.channel, t.status, t.body])).toEqual([
      [1, 'email', 'drafted', 'Hi Pat, first draft.'],
      [2, 'facebook', 'drafted', 'Hi, short note.'],
    ]);
    expect(drafts[0]?.attributes).toEqual({ angle: 'finding' });
    expect(drafts.every((t) => t.identityId !== null)).toBe(true);
  });

  it('replaces untouched drafts on re-send but never anything approved or sent', async () => {
    await company('resend.test');
    const first = await ingestOutreach(db, pkg('resend.test'));
    const [email, facebook] = await touchesOf(first!.personId!);
    await actOnTouch(db, email!.id, 'approve', 'jacob');

    const again = await ingestOutreach(
      db,
      pkg('resend.test', { messages: [{ stepNo: 1, channel: 'email', body: 'New email text.' }, { stepNo: 2, channel: 'facebook', body: 'New note.' }] }),
    );
    expect(again).toMatchObject({ draftsWritten: 1, draftsKept: 1 });
    const after = await touchesOf(first!.personId!);
    expect(after[0]).toMatchObject({ id: email!.id, status: 'approved', body: 'Hi Pat, first draft.' });
    expect(after[1]).toMatchObject({ id: facebook!.id, status: 'drafted', body: 'New note.' });
    expect(await db.select().from(schema.people).where(eq(schema.people.id, first!.personId!))).toHaveLength(1);
  });

  it('uses a stand-in when no name was found, and swaps in the real name later', async () => {
    const c = await company('noname.test');
    const first = await ingestOutreach(db, pkg('noname.test', { person: undefined }));
    let rows = await db.select().from(schema.people).where(eq(schema.people.companyId, c.id));
    expect(rows.map((p) => p.source)).toEqual(['placeholder']);

    const second = await ingestOutreach(db, pkg('noname.test'));
    rows = await db.select().from(schema.people).where(eq(schema.people.companyId, c.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first!.personId, fullName: 'Pat Owner' });
    expect(second!.personId).toBe(first!.personId);
  });

  it('reports an unknown company and rejects malformed packages', async () => {
    expect(await ingestOutreach(db, pkg('nowhere.test'))).toBeNull();
    expect(() => parseOutreachIngest({})).toThrow(InvalidIngestError);
    expect(() => parseOutreachIngest({ ...pkg('x.test'), sequence: undefined })).toThrow(/need a sequence/);
    expect(() => parseOutreachIngest({ ...pkg('x.test'), identities: [{ channel: 'fax', value: '1' }] })).toThrow(/identities/);
    expect(() => parseOutreachIngest({ ...pkg('x.test'), messages: [{ stepNo: 1, channel: 'email', body: 'a' }, { stepNo: 1, channel: 'email', body: 'b' }] })).toThrow(/messages/);
    expect(parseOutreachIngest(JSON.parse(JSON.stringify(pkg('x.test')))).messages).toHaveLength(2);
  });
});

describe('working a message', () => {
  it('keeps the original draft when a person edits, and locks the text once sent', async () => {
    await company('edit.test');
    const { personId } = (await ingestOutreach(db, pkg('edit.test')))!;
    const [email] = await touchesOf(personId!);

    expect(await editTouch(db, email!.id, { body: 'My rewrite.', subject: 'new subject' })).toBe(true);
    let [after] = await touchesOf(personId!);
    expect(after).toMatchObject({ body: 'My rewrite.', draftBody: 'Hi Pat, first draft.', subject: 'new subject' });

    expect(await actOnTouch(db, email!.id, 'sent', 'jacob')).toBe(true);
    [after] = await touchesOf(personId!);
    expect(after).toMatchObject({ status: 'sent', reviewedBy: 'jacob' });
    expect(after?.sentAt).toBeInstanceOf(Date);

    expect(await editTouch(db, email!.id, { body: 'Too late.' })).toBe(false);
    expect(await actOnTouch(db, email!.id, 'approve', 'jacob')).toBe(false);
    expect(await actOnTouch(db, email!.id, 'skip', 'jacob')).toBe(false);
  });

  it('allows skip and bring-back before sending', async () => {
    await company('skip.test');
    const { personId } = (await ingestOutreach(db, pkg('skip.test')))!;
    const [email] = await touchesOf(personId!);
    expect(await actOnTouch(db, email!.id, 'skip', 'jacob')).toBe(true);
    expect(await actOnTouch(db, email!.id, 'unapprove', 'jacob')).toBe(true);
    expect((await touchesOf(personId!))[0]?.status).toBe('drafted');
  });

  it('logging a reply stops the rest of the sequence on every channel', async () => {
    await company('reply.test');
    const { personId } = (await ingestOutreach(db, pkg('reply.test')))!;
    const [email, facebook] = await touchesOf(personId!);

    expect(await logReply(db, email!.id, { classification: 'positive', by: 'jacob' })).toBe(false); // not sent yet
    await actOnTouch(db, email!.id, 'sent', 'jacob');
    expect(await logReply(db, email!.id, { classification: 'positive', body: ' Sure, send it over. ', by: 'jacob' })).toBe(true);

    const [reply] = await db.select().from(schema.replies).where(eq(schema.replies.touchId, email!.id));
    expect(reply).toMatchObject({ classification: 'positive', body: 'Sure, send it over.', channel: 'email' });
    const [enrollment] = await db.select().from(schema.enrollments).where(eq(schema.enrollments.personId, personId!));
    expect(enrollment?.status).toBe('replied');
    expect((await touchesOf(personId!)).find((t) => t.id === facebook!.id)?.status).toBe('skipped');
    expect(await findSuppression(db, { email: 'pat@reply.test' })).toBeNull();
  });

  it('an opt-out also puts the person and their addresses on the do-not-contact list', async () => {
    await company('optout.test');
    const { personId } = (await ingestOutreach(db, pkg('optout.test')))!;
    const [email] = await touchesOf(personId!);
    await actOnTouch(db, email!.id, 'sent', 'jacob');
    await logReply(db, email!.id, { classification: 'opt_out', by: 'jacob' });

    expect((await db.select().from(schema.enrollments).where(eq(schema.enrollments.personId, personId!)))[0]?.status).toBe('opted_out');
    expect((await findSuppression(db, { email: 'PAT@optout.test' }))?.reason).toBe('opt_out');
    expect((await findSuppression(db, { personId: personId! }))?.scope).toBe('person');
  });
});
