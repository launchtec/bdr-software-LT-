import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFromCaptures } from '../src/audit';
import { saveAuditSignals } from '../src/audit/persist';
import * as schema from '../src/db/schema';
import {
  findSuppression,
  normalizeDomain,
  normalizeInstagram,
  normalizeLinkedin,
  suppress,
  type Db,
} from '../src/db/suppression';

let db: Db;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: './drizzle' });
  db = pglite as unknown as Db;
});

async function addCompany(domain: string) {
  const [company] = await db.insert(schema.companies).values({ name: domain, domain, source: 'test' }).returning();
  return company!;
}

describe('schema', () => {
  it('applies the migration and links a person to identities on several channels', async () => {
    const company = await addCompany('acme-roofing.test');
    const [person] = await db
      .insert(schema.people)
      .values({ companyId: company.id, fullName: 'Pat Owner', roleType: 'owner', source: 'company_site' })
      .returning();

    await db.insert(schema.identities).values([
      { personId: person!.id, channel: 'email', value: 'pat@acme-roofing.test' },
      { personId: person!.id, channel: 'linkedin', value: 'linkedin.com/in/pat-owner' },
      { personId: person!.id, channel: 'instagram', value: 'acmeroofing' },
    ]);

    const rows = await db.select().from(schema.identities).where(eq(schema.identities.personId, person!.id));
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'instagram', 'linkedin']);
    expect(company.status).toBe('new');
    expect(company.country).toBe('US');
  });

  it('refuses the same company domain or the same identity twice', async () => {
    await addCompany('dupe.test');
    await expect(addCompany('dupe.test')).rejects.toThrow();

    const company = await addCompany('two-people.test');
    const people = await db
      .insert(schema.people)
      .values([
        { companyId: company.id, fullName: 'A', source: 'test' },
        { companyId: company.id, fullName: 'B', source: 'test' },
      ])
      .returning();
    await db.insert(schema.identities).values({ personId: people[0]!.id, channel: 'email', value: 'shared@two-people.test' });
    await expect(
      db.insert(schema.identities).values({ personId: people[1]!.id, channel: 'email', value: 'shared@two-people.test' }),
    ).rejects.toThrow();
  });

  it('removes people, identities and signals when a company is deleted', async () => {
    const company = await addCompany('gone.test');
    const [person] = await db.insert(schema.people).values({ companyId: company.id, fullName: 'X', source: 'test' }).returning();
    await db.insert(schema.identities).values({ personId: person!.id, channel: 'email', value: 'x@gone.test' });

    await db.delete(schema.companies).where(eq(schema.companies.id, company.id));
    expect(await db.select().from(schema.people).where(eq(schema.people.companyId, company.id))).toEqual([]);
    expect(await db.select().from(schema.identities).where(eq(schema.identities.value, 'x@gone.test'))).toEqual([]);
  });
});

describe('suppression', () => {
  it('normalizes values', () => {
    expect(normalizeDomain('https://www.Example.com/contact?x=1')).toBe('example.com');
    expect(normalizeDomain('someone@Example.com')).toBe('example.com');
    expect(normalizeLinkedin('https://www.linkedin.com/in/Jane-Doe/?utm=x')).toBe('linkedin.com/in/jane-doe');
    expect(normalizeLinkedin('uk.linkedin.com/in/jane-doe')).toBe('linkedin.com/in/jane-doe');
    expect(normalizeInstagram('@Handle')).toBe('handle');
    expect(normalizeInstagram('https://www.instagram.com/Handle/?hl=en')).toBe('handle');
  });

  it('blocks by email, by the email\'s domain, and by profile, in any formatting', async () => {
    await suppress(db, { scope: 'email', value: ' Opted.Out@Example.com ', reason: 'opt_out' });
    await suppress(db, { scope: 'domain', value: 'https://www.client.com/', reason: 'client' });
    await suppress(db, { scope: 'linkedin', value: 'https://www.linkedin.com/in/Jane-Doe/', reason: 'opt_out' });

    expect((await findSuppression(db, { email: 'opted.out@example.com' }))?.reason).toBe('opt_out');
    expect((await findSuppression(db, { email: 'anyone@client.com' }))?.reason).toBe('client');
    expect((await findSuppression(db, { domain: 'CLIENT.com' }))?.reason).toBe('client');
    expect((await findSuppression(db, { linkedin: 'linkedin.com/in/jane-doe' }))?.scope).toBe('linkedin');

    expect(await findSuppression(db, { email: 'someone.else@example.com' })).toBeNull();
    expect(await findSuppression(db, {})).toBeNull();
  });

  it('is idempotent and keeps the first reason', async () => {
    await suppress(db, { scope: 'email', value: 'twice@example.com', reason: 'bounce' });
    await suppress(db, { scope: 'email', value: 'TWICE@example.com', reason: 'manual' });
    const rows = await db.select().from(schema.suppressions).where(eq(schema.suppressions.value, 'twice@example.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('bounce');
  });
});

describe('saveAuditSignals', () => {
  const capture = (html: string) => ({
    url: 'https://signals.test/',
    finalUrl: 'https://signals.test/',
    status: 200,
    title: 'Signals',
    html,
    requests: [],
    failedRequests: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
  });

  it('stores findings with evidence and replaces them on re-audit', async () => {
    const company = await addCompany('signals.test');

    const first = auditFromCaptures('https://signals.test/', [capture(`<script>ga('create', 'UA-1111111-1');</script>`)]);
    expect(await saveAuditSignals(db, company.id, first)).toBe(first.findings.length);

    let rows = await db.select().from(schema.signals).where(eq(schema.signals.companyId, company.id));
    const uaOnly = rows.find((r) => r.code === 'analytics.ua_only');
    expect(uaOnly).toMatchObject({ collector: 'site_audit', confidence: 'observed' });
    expect(uaOnly?.evidence.length).toBeGreaterThan(0);

    const second = auditFromCaptures('https://signals.test/', [capture('<p>rebuilt</p>')]);
    await saveAuditSignals(db, company.id, second);
    rows = await db.select().from(schema.signals).where(eq(schema.signals.companyId, company.id));
    expect(rows.map((r) => r.code).sort()).toEqual(second.findings.map((f) => f.code).sort());
    expect(rows.some((r) => r.code === 'analytics.ua_only')).toBe(false);
  });
});
