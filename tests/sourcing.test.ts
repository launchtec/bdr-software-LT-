import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { ingestCompany, InvalidIngestError, parseCompanyIngest } from '../src/db/ingest';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/suppression';
import type { Prospect } from '../src/lib/queries';
import { shortlistReason } from '../src/lib/shortlist';
import { parseCard } from '../src/sourcing/maps';

describe('parseCard', () => {
  // Card text copied from real Maps results.
  it('reads name, rating, category, address, phone and site', () => {
    const listing = parseCard(
      {
        name: 'Denver Fence Guys',
        ratingLabel: '4.9 stars',
        text: 'Denver Fence Guys\nDenver Fence Guys\n4.9\nFence contractor · 10509 W 44th Ave Unit g\nOpen 24 hours · +1 720-606-2660\nWebsite\nDirections',
        website: 'https://denverfenceguys.com/fence-company-in-wheat-ridge-co/?utm_source=gmb',
        placeUrl: 'https://www.google.com/maps/place/Denver+Fence+Guys/data=x',
      },
      'fence company Arvada CO',
    );
    expect(listing).toEqual({
      name: 'Denver Fence Guys',
      category: 'Fence contractor',
      rating: 4.9,
      address: '10509 W 44th Ave Unit g',
      phone: '+1 720-606-2660',
      website: 'https://denverfenceguys.com/fence-company-in-wheat-ridge-co/',
      domain: 'denverfenceguys.com',
      placeUrl: 'https://www.google.com/maps/place/Denver+Fence+Guys/data=x',
      query: 'fence company Arvada CO',
    });
  });

  it('handles a listing with no address and one with no website', () => {
    const noAddress = parseCard(
      { name: 'Supreme Fencing Arvada LLC', ratingLabel: '5.0 stars', text: 'Supreme Fencing Arvada LLC Supreme Fencing Arvada LLC 5.0 Fence contractor Open 24 hours · +1 720-923-8952 Website Directions', website: 'https://supremearvadafencing.com/?utm_campaign=gmb', placeUrl: null },
      'q',
    );
    expect(noAddress).toMatchObject({ category: 'Fence contractor', address: null, phone: '+1 720-923-8952', domain: 'supremearvadafencing.com' });

    const noSite = parseCard(
      { name: 'Aspen Ridge Fence Co', ratingLabel: '3.5 stars', text: 'Aspen Ridge Fence Co Aspen Ridge Fence Co 3.5 Fence contractor · 4470 Lee St Open now · +1 303-424-1089 Directions', website: null, placeUrl: null },
      'q',
    );
    expect(noSite).toMatchObject({ rating: 3.5, address: '4470 Lee St', website: null, domain: null });
  });

  it('does not treat a social or directory page as the company site', () => {
    const listing = parseCard({ name: 'Joe Roofing', ratingLabel: null, text: 'Joe Roofing Roofing contractor', website: 'https://www.facebook.com/joeroofing', placeUrl: null }, 'q');
    expect(listing).toMatchObject({ rating: null, website: null, domain: null });
  });

  it('skips cards with no name', () => {
    expect(parseCard({ name: ' ', ratingLabel: null, text: '', website: null, placeUrl: null }, 'q')).toBeNull();
  });
});

describe('ingestCompany', () => {
  let db: Db;
  beforeAll(async () => {
    const pglite = drizzle(new PGlite(), { schema });
    await migrate(pglite, { migrationsFolder: './drizzle' });
    db = pglite as unknown as Db;
  });

  it('adds a new company with its source details', async () => {
    const input = parseCompanyIngest({
      name: 'Acme Fence', websiteUrl: 'https://www.acmefence.test/arvada/', segment: 'home_services', city: 'Arvada', region: 'CO',
      source: 'google_maps', sourceRef: { category: 'Fence contractor', rating: 4.7 },
    });
    const result = await ingestCompany(db, input);
    expect(result.created).toBe(true);
    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, result.id));
    expect(row).toMatchObject({ name: 'Acme Fence', domain: 'acmefence.test', city: 'Arvada', source: 'google_maps', status: 'new' });
    expect(row?.sourceRef).toEqual({ category: 'Fence contractor', rating: 4.7 });
  });

  it('fills in a known company without overwriting what it already had', async () => {
    const [existing] = await db
      .insert(schema.companies)
      .values({ name: 'known.test', domain: 'known.test', source: 'web_search', segment: 'home_services', sourceRef: { rating: 4.1 } })
      .returning();
    const result = await ingestCompany(db, { name: 'Known Roofing', websiteUrl: 'https://known.test/', source: 'google_maps', city: 'Aurora', sourceRef: { rating: 4.9, category: 'Roofer' } });
    expect(result).toEqual({ id: existing!.id, created: false });
    const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, existing!.id));
    expect(row).toMatchObject({ name: 'Known Roofing', source: 'web_search', city: 'Aurora' });
    expect(row?.sourceRef).toEqual({ rating: 4.1, category: 'Roofer' });

    await ingestCompany(db, { name: 'Different Name', websiteUrl: 'https://known.test/', source: 'google_maps' });
    expect((await db.select().from(schema.companies).where(eq(schema.companies.id, existing!.id)))[0]?.name).toBe('Known Roofing');
  });

  it('rejects malformed companies', () => {
    expect(() => parseCompanyIngest({ name: 'x', source: 'y' })).toThrow(InvalidIngestError);
    expect(() => parseCompanyIngest({ name: 'x', websiteUrl: 'ftp://x.test', source: 'y' })).toThrow(InvalidIngestError);
    expect(() => parseCompanyIngest({ name: 'x', websiteUrl: 'https://x.test', source: 'y', sourceRef: [] })).toThrow(InvalidIngestError);
  });
});

describe('shortlistReason', () => {
  const detections = (builtOut: boolean) =>
    ({
      gtm: [], googleTag: [], tagLoaderFailed: false, universalAnalytics: [], metaMaxPageViews: {}, ga4MaxPageViews: {},
      ga4: builtOut ? [{ id: 'G-1', evidence: [] }] : [],
      googleAds: builtOut ? [{ id: 'AW-1', evidence: [] }] : [],
      metaPixel: builtOut ? [{ id: '1', evidence: [] }] : [],
      metaPixelLibrary: false, otherAdPixels: [], callTracking: [], googleCallConversion: false, leadTools: [],
      consentManagers: [], platform: null, marketingVendors: [], vendorCredits: [], phoneNumbers: [], formCount: 0,
    });
  const gap = { data: { appliesWhen: 'runs_google_ads' } };
  const base = (over: Record<string, unknown> = {}): Prospect =>
    ({
      company: { fitVerdict: null },
      audit: { status: 'ok', detections: detections(false) },
      googleAds: { status: 'active', adCount: 10 },
      signals: [gap],
      ...over,
    }) as unknown as Prospect;

  it('shortlists an advertiser with a confirmed gap and a modest setup', () => {
    expect(shortlistReason(base())).toEqual({ shortlisted: true, reason: 'Running Google ads with a tracking gap' });
    expect(shortlistReason(base({ company: { fitVerdict: 'good_fit' } })).shortlisted).toBe(true);
  });

  it('leaves out everything else, with the reason', () => {
    expect(shortlistReason(base({ company: { fitVerdict: 'too_big' } })).reason).toBe('Marked as not a fit');
    expect(shortlistReason(base({ googleAds: null })).reason).toBe('Ads not checked');
    expect(shortlistReason(base({ googleAds: { status: 'lapsed', adCount: 4 } })).reason).toBe('Not running Google ads now');
    expect(shortlistReason(base({ audit: { status: 'not_auditable', detections: null } })).reason).toBe('Site could not be audited');
    expect(shortlistReason(base({ googleAds: { status: 'active', adCount: 700 } })).reason).toBe('Large ad operation');
    expect(shortlistReason(base({ audit: { status: 'ok', detections: detections(true) } })).reason).toBe('Setup already built out');
    expect(shortlistReason(base({ signals: [{ data: null }] })).reason).toBe('No confirmed gap in ad tracking');
  });
});
