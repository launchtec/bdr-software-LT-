import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditFromCaptures } from '../src/audit';
import { ingestAudit, InvalidIngestError, parseAuditIngest } from '../src/db/ingest';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/suppression';
import { checkBasicAuth, checkBearer } from '../src/lib/auth';

let db: Db;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: './drizzle' });
  db = pglite as unknown as Db;
});

function audit(url: string, html: string) {
  return auditFromCaptures(url, [
    { url, finalUrl: url, status: 200, title: 'Acme Roofing | Denver', html, requests: [], failedRequests: [], tagScripts: [], capturedAt: '2026-01-01T00:00:00.000Z' },
  ]);
}

describe('ingestAudit', () => {
  it('creates the company, stores the audit snapshot and its findings', async () => {
    const result = audit('https://www.acme-roofing.test/', `<script>ga('create', 'UA-1111111-1');</script>`);
    const id = await ingestAudit(db, { url: 'https://www.acme-roofing.test/', segment: 'home_services', source: 'web_search', audit: result });

    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
    expect(company).toMatchObject({ domain: 'acme-roofing.test', name: 'acme-roofing.test', status: 'researched', segment: 'home_services', source: 'web_search' });

    const audits = await db.select().from(schema.siteAudits).where(eq(schema.siteAudits.companyId, id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ status: 'ok', pageTitle: 'Acme Roofing | Denver' });
    expect(audits[0]?.detections?.universalAnalytics[0]?.id).toBe('UA-1111111-1');

    const signals = await db.select().from(schema.signals).where(eq(schema.signals.companyId, id));
    expect(signals.map((s) => s.code)).toContain('analytics.ua_only');
  });

  it('updates the same company on a second audit instead of duplicating it', async () => {
    const url = 'https://again.test/';
    const first = await ingestAudit(db, { url, audit: audit(url, `<script>ga('create', 'UA-2222222-1');</script>`) });
    const second = await ingestAudit(db, { url: 'http://www.again.test/contact', name: 'Again Co', audit: audit(url, '<p>rebuilt</p>') });
    expect(second).toBe(first);

    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, first));
    expect(company?.name).toBe('Again Co');
    expect(await db.select().from(schema.siteAudits).where(eq(schema.siteAudits.companyId, first))).toHaveLength(2);
    const codes = (await db.select().from(schema.signals).where(eq(schema.signals.companyId, first))).map((s) => s.code);
    expect(codes).not.toContain('analytics.ua_only');
  });

  it('records a site that could not be audited without claiming anything about it', async () => {
    const id = await ingestAudit(db, { url: 'https://blocked.test/', error: 'did not load (HTTP 403)' });
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
    expect(company?.status).toBe('new');
    const [row] = await db.select().from(schema.siteAudits).where(eq(schema.siteAudits.companyId, id));
    expect(row).toMatchObject({ status: 'not_auditable', error: 'did not load (HTTP 403)', detections: null });
    expect(await db.select().from(schema.signals).where(eq(schema.signals.companyId, id))).toEqual([]);
  });
});

describe('parseAuditIngest', () => {
  const good = audit('https://ok.test/', '<p>x</p>');

  it('accepts a well-formed item and survives a JSON round trip', () => {
    const parsed = parseAuditIngest(JSON.parse(JSON.stringify({ url: 'https://ok.test/', audit: good })));
    expect(parsed.audit?.findings.length).toBe(good.findings.length);
  });

  it('rejects malformed items', () => {
    expect(() => parseAuditIngest(null)).toThrow(InvalidIngestError);
    expect(() => parseAuditIngest({ url: '' })).toThrow(InvalidIngestError);
    expect(() => parseAuditIngest({ url: 'localhost' })).toThrow(InvalidIngestError);
    expect(() => parseAuditIngest({ url: 'https://ok.test/' })).toThrow(/audit or an error/);
    expect(() => parseAuditIngest({ url: 'https://ok.test/', audit: { ...good, findings: [{ code: 'x' }] } })).toThrow(/Malformed/);
    expect(() => parseAuditIngest({ url: 'https://ok.test/', audit: { ...good, auditedAt: 'yesterday' } })).toThrow(/Malformed/);
  });
});

describe('auth', () => {
  const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

  it('accepts the right password with any username', () => {
    expect(checkBasicAuth(basic('jacob', 's3cret:with:colons'), 's3cret:with:colons')).toBe(true);
    expect(checkBasicAuth(basic('', 's3cret'), 's3cret')).toBe(true);
  });

  it('rejects wrong, missing or malformed credentials, and an unset password', () => {
    expect(checkBasicAuth(basic('jacob', 'wrong'), 's3cret')).toBe(false);
    expect(checkBasicAuth(null, 's3cret')).toBe(false);
    expect(checkBasicAuth('Basic !!!', 's3cret')).toBe(false);
    expect(checkBasicAuth('Bearer s3cret', 's3cret')).toBe(false);
    expect(checkBasicAuth(basic('jacob', ''), '')).toBe(false);
  });

  it('checks bearer tokens', () => {
    expect(checkBearer('Bearer tok-123', 'tok-123')).toBe(true);
    expect(checkBearer('Bearer tok-124', 'tok-123')).toBe(false);
    expect(checkBearer(null, 'tok-123')).toBe(false);
    expect(checkBearer('Bearer ', '')).toBe(false);
  });
});
