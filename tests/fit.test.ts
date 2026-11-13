import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { detect } from '../src/audit/detect';
import { stackMaturity } from '../src/audit/maturity';
import type { PageCapture } from '../src/audit/types';
import { isFitVerdict, setFitVerdict } from '../src/db/fit';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/suppression';

let db: Db;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder: './drizzle' });
  db = pglite as unknown as Db;
});

describe('setFitVerdict', () => {
  it('records a verdict and note, keeps the note when re-marked without one, and clears', async () => {
    const [company] = await db.insert(schema.companies).values({ name: 'fit.test', domain: 'fit.test', source: 'test' }).returning();
    const read = async () => (await db.select().from(schema.companies).where(eq(schema.companies.id, company!.id)))[0]!;
    expect((await read()).fitVerdict).toBeNull();

    expect(await setFitVerdict(db, company!.id, 'too_big', '  Franchise, 12 locations  ')).toBe(true);
    let row = await read();
    expect(row).toMatchObject({ fitVerdict: 'too_big', fitNote: 'Franchise, 12 locations' });
    expect(row.fitMarkedAt).toBeInstanceOf(Date);

    await setFitVerdict(db, company!.id, 'good_fit');
    row = await read();
    expect(row).toMatchObject({ fitVerdict: 'good_fit', fitNote: 'Franchise, 12 locations' });

    await setFitVerdict(db, company!.id, null, '');
    row = await read();
    expect(row).toMatchObject({ fitVerdict: null, fitNote: null, fitMarkedAt: null });
  });

  it('reports a company that does not exist', async () => {
    expect(await setFitVerdict(db, '00000000-0000-4000-8000-000000000000', 'good_fit')).toBe(false);
  });

  it('only accepts known verdicts', () => {
    expect(isFitVerdict('too_big')).toBe(true);
    expect(isFitVerdict('clear')).toBe(false);
    expect(isFitVerdict(null)).toBe(false);
  });
});

describe('stackMaturity', () => {
  const rate = (requests: string[], html = '') => {
    const capture: PageCapture = {
      url: 'https://x.test/', finalUrl: 'https://x.test/', status: 200, title: '', html, requests,
      failedRequests: [], tagScripts: [], capturedAt: '2026-01-01T00:00:00.000Z',
    };
    return stackMaturity(detect([capture]));
  };
  const GA4 = 'https://www.google-analytics.com/g/collect?tid=G-ABCDEF0001&en=page_view';
  const ADS = 'https://www.googletagmanager.com/gtag/js?id=AW-123456789';
  const PIXEL = 'https://www.facebook.com/tr/?id=222222222222&ev=PageView';
  const CALLS = 'https://cdn.callrail.com/companies/1/a/12/swap.js';

  it('rates a site with analytics and two or more ad tools as built out', () => {
    expect(rate([GA4, ADS, CALLS])).toBe('built_out');
    expect(rate([GA4, ADS, PIXEL, CALLS])).toBe('built_out');
  });

  it('rates a site with nothing as bare', () => {
    expect(rate([])).toBe('bare');
  });

  it('rates everything in between as partial', () => {
    expect(rate([GA4])).toBe('partial');
    expect(rate([GA4, ADS])).toBe('partial');
    expect(rate([ADS, CALLS])).toBe('partial');
    expect(rate(['https://www.googletagmanager.com/gtm.js?id=GTM-ONLY001'])).toBe('partial');
  });
});
