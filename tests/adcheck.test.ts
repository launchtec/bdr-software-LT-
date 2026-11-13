import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdCheckError, parseSearchCreatives } from '../src/adcheck/google';
import { ingestAdCheck, InvalidIngestError, parseAdCheckIngest } from '../src/db/ingest';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/suppression';
import { findingState, type AdCheckRow, type Signal } from '../src/lib/queries';

const NOW = new Date('2026-11-13T12:00:00Z');
const seconds = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

/** Shaped like the Transparency Center's real response (fields trimmed to the ones we read). */
function body(creatives: { advertiser?: string; name?: string; format: number; first: string; last: string }[]) {
  return JSON.stringify({
    '1': creatives.map((c, i) => ({
      '1': c.advertiser ?? 'AR1',
      '2': `CR${i}`,
      '4': c.format,
      '6': { '1': seconds(c.first) },
      '7': { '1': seconds(c.last), '2': 890424000 },
      '12': c.name ?? 'Acme Fence LLC',
      '14': 'acme.test',
    })),
    '4': String(creatives.length),
    '5': String(creatives.length),
  });
}

describe('parseSearchCreatives', () => {
  it('reports an active advertiser with counts, formats and date range', () => {
    const check = parseSearchCreatives(
      'acme.test',
      body([
        { format: 1, first: '2026-10-02T00:00:00Z', last: '2026-11-13T08:00:00Z' },
        { format: 2, first: '2025-06-11T00:00:00Z', last: '2026-09-22T00:00:00Z' },
        { format: 3, first: '2026-01-01T00:00:00Z', last: '2026-11-01T00:00:00Z', advertiser: 'AR2', name: 'Acme Holdings' },
      ]),
      NOW,
    );
    expect(check).toMatchObject({
      platform: 'google',
      status: 'active',
      adCount: 3,
      formats: { text: 1, image: 1, video: 1 },
      firstShown: '2025-06-11',
      lastShown: '2026-11-13',
      sourceUrl: 'https://adstransparency.google.com/?region=US&domain=acme.test',
    });
    expect(check.advertisers).toEqual([
      { id: 'AR1', name: 'Acme Fence LLC' },
      { id: 'AR2', name: 'Acme Holdings' },
    ]);
  });

  it('reports a lapsed advertiser when nothing was shown in the last 30 days', () => {
    const lapsed = parseSearchCreatives('acme.test', body([{ format: 1, first: '2025-01-01T00:00:00Z', last: '2026-10-01T00:00:00Z' }]), NOW);
    expect(lapsed.status).toBe('lapsed');
    const edge = parseSearchCreatives('acme.test', body([{ format: 1, first: '2025-01-01T00:00:00Z', last: '2026-10-15T00:00:00Z' }]), NOW);
    expect(edge.status).toBe('active');
  });

  it('treats the empty object as "no ads"', () => {
    expect(parseSearchCreatives('quiet.test', '{}', NOW)).toMatchObject({ status: 'none', adCount: 0, lastShown: null, advertisers: [] });
  });

  it('uses the reported total when it exceeds the page of ads returned', () => {
    const raw = JSON.parse(body([{ format: 1, first: '2026-11-01T00:00:00Z', last: '2026-11-12T00:00:00Z' }]));
    raw['4'] = '40';
    raw['5'] = '212';
    expect(parseSearchCreatives('big.test', JSON.stringify(raw), NOW).adCount).toBe(212);
  });

  it('refuses to conclude anything from a response it cannot read', () => {
    expect(() => parseSearchCreatives('x.test', '<html>Sorry, unusual traffic</html>', NOW)).toThrow(AdCheckError);
    expect(() => parseSearchCreatives('x.test', '[]', NOW)).toThrow(AdCheckError);
    expect(() => parseSearchCreatives('x.test', '{"1":"nope"}', NOW)).toThrow(AdCheckError);
  });
});

describe('findingState', () => {
  const signal = (appliesWhen?: string) => ({ data: appliesWhen ? { appliesWhen } : null }) as unknown as Signal;
  const ads = (status: 'active' | 'lapsed' | 'none') => ({ status }) as unknown as AdCheckRow;

  it('always treats unconditional findings as usable', () => {
    expect(findingState(signal(), null)).toBe('usable');
    expect(findingState(signal(), ads('none'))).toBe('usable');
  });

  it('resolves Google-dependent findings from the Google check', () => {
    expect(findingState(signal('runs_google_ads'), null)).toBe('unconfirmed');
    expect(findingState(signal('runs_google_ads'), ads('active'))).toBe('usable');
    expect(findingState(signal('runs_google_ads'), ads('lapsed'))).toBe('not_applicable');
    expect(findingState(signal('runs_google_ads'), ads('none'))).toBe('not_applicable');
  });

  it('confirms "any ads" findings from Google ads but never rules them out, since Meta is unchecked', () => {
    expect(findingState(signal('runs_any_ads'), ads('active'))).toBe('usable');
    expect(findingState(signal('runs_any_ads'), ads('none'))).toBe('unconfirmed');
    expect(findingState(signal('runs_any_ads'), null)).toBe('unconfirmed');
  });

  it('leaves Meta-dependent findings unconfirmed', () => {
    expect(findingState(signal('runs_meta_ads'), ads('active'))).toBe('unconfirmed');
  });
});

describe('ad check ingest', () => {
  let db: Db;
  beforeAll(async () => {
    const pglite = drizzle(new PGlite(), { schema });
    await migrate(pglite, { migrationsFolder: './drizzle' });
    db = pglite as unknown as Db;
  });

  const check = parseSearchCreatives('www.acme.test', body([{ format: 1, first: '2026-10-02T00:00:00Z', last: '2026-11-13T08:00:00Z' }]), NOW);

  it('stores a check against the matching company and reports unknown domains', async () => {
    const [company] = await db.insert(schema.companies).values({ name: 'Acme', domain: 'acme.test', source: 'test' }).returning();
    const parsed = parseAdCheckIngest(JSON.parse(JSON.stringify(check)));
    expect(await ingestAdCheck(db, parsed)).toBe(true);
    const rows = await db.select().from(schema.adChecks).where(eq(schema.adChecks.companyId, company!.id));
    expect(rows[0]).toMatchObject({ platform: 'google', status: 'active', adCount: 1, lastShown: '2026-11-13' });

    expect(await ingestAdCheck(db, { ...parsed, domain: 'nobody.test' })).toBe(false);
  });

  it('rejects malformed checks', () => {
    expect(() => parseAdCheckIngest({ ...check, status: 'maybe' })).toThrow(InvalidIngestError);
    expect(() => parseAdCheckIngest({ ...check, adCount: -1 })).toThrow(InvalidIngestError);
    expect(() => parseAdCheckIngest({ ...check, lastShown: 'yesterday' })).toThrow(InvalidIngestError);
    expect(() => parseAdCheckIngest({ ...check, sourceUrl: 'javascript:alert(1)' })).toThrow(InvalidIngestError);
    expect(() => parseAdCheckIngest({ ...check, platform: 'meta' })).toThrow(InvalidIngestError);
  });
});
