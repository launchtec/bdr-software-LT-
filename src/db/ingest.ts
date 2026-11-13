/**
 * Stores audit results sent by an audit worker. The worker (which needs a headless
 * browser) and the web app (which does not) only meet here.
 */
import { eq } from 'drizzle-orm';
import { saveAuditSignals } from '../audit/persist';
import type { SiteAudit } from '../audit/types';
import { adChecks, companies, siteAudits } from './schema';
import { normalizeDomain, type Db } from './suppression';

export interface AuditIngest {
  /** The site that was audited. */
  url: string;
  name?: string;
  segment?: string;
  /** How the company got on the list, e.g. `web_search`. */
  source?: string;
  /** Present when the site was audited. */
  audit?: SiteAudit;
  /** Present when it could not be. */
  error?: string;
}

export class InvalidIngestError extends Error {}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Checks the shape of one item from an untrusted request body. */
export function parseAuditIngest(raw: unknown): AuditIngest {
  if (typeof raw !== 'object' || raw === null) throw new InvalidIngestError('Each item must be an object.');
  const item = raw as Record<string, unknown>;
  if (!isString(item.url)) throw new InvalidIngestError('Each item needs a url.');
  if (!normalizeDomain(item.url).includes('.')) throw new InvalidIngestError(`Not a site URL: ${item.url}`);

  const audit = item.audit as SiteAudit | undefined;
  if (audit !== undefined) {
    const ok =
      typeof audit === 'object' &&
      audit !== null &&
      isString(audit.auditedAt) &&
      !Number.isNaN(Date.parse(audit.auditedAt)) &&
      typeof audit.detections === 'object' &&
      audit.detections !== null &&
      Array.isArray(audit.findings) &&
      Array.isArray(audit.pages) &&
      Array.isArray(audit.limitations) &&
      audit.findings.every(
        (f) =>
          isString(f?.code) &&
          isString(f?.statement) &&
          (f.confidence === 'observed' || f.confidence === 'likely') &&
          Array.isArray(f.evidence),
      );
    if (!ok) throw new InvalidIngestError(`Malformed audit for ${item.url}.`);
  } else if (!isString(item.error)) {
    throw new InvalidIngestError(`Item for ${item.url} needs either an audit or an error.`);
  }

  return {
    url: item.url,
    name: isString(item.name) ? item.name : undefined,
    segment: isString(item.segment) ? item.segment : undefined,
    source: isString(item.source) ? item.source : undefined,
    audit,
    error: audit ? undefined : (item.error as string),
  };
}

/** Creates or updates the company for this site and records the audit. Returns the company id. */
export async function ingestAudit(db: Db, input: AuditIngest): Promise<string> {
  const domain = normalizeDomain(input.url);

  const existing = (await db.select().from(companies).where(eq(companies.domain, domain)).limit(1))[0];
  let companyId: string;

  if (existing) {
    companyId = existing.id;
    await db
      .update(companies)
      .set({
        name: input.name ?? existing.name,
        segment: input.segment ?? existing.segment,
        websiteUrl: input.url,
        status: input.audit && existing.status === 'new' ? 'researched' : existing.status,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));
  } else {
    const [created] = await db
      .insert(companies)
      .values({
        name: input.name ?? domain,
        domain,
        websiteUrl: input.url,
        segment: input.segment,
        source: input.source ?? 'manual',
        status: input.audit ? 'researched' : 'new',
      })
      .returning({ id: companies.id });
    companyId = created!.id;
  }

  if (input.audit) {
    await db.insert(siteAudits).values({
      companyId,
      url: input.audit.url,
      status: 'ok',
      pageTitle: input.audit.pages[0]?.title ?? null,
      detections: input.audit.detections,
      limitations: input.audit.limitations,
      auditedAt: new Date(input.audit.auditedAt),
    });
    await saveAuditSignals(db, companyId, input.audit);
  } else {
    await db.insert(siteAudits).values({
      companyId,
      url: input.url,
      status: 'not_auditable',
      error: input.error,
      auditedAt: new Date(),
    });
  }

  return companyId;
}

export interface AdCheckIngest {
  domain: string;
  platform: 'google';
  status: 'active' | 'lapsed' | 'none';
  adCount: number;
  advertisers: { id: string; name: string }[];
  formats?: Record<string, number>;
  firstShown: string | null;
  lastShown: string | null;
  sourceUrl: string;
  checkedAt: string;
}

const isDateOrNull = (v: unknown) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));

/** Checks the shape of one ad check from an untrusted request body. */
export function parseAdCheckIngest(raw: unknown): AdCheckIngest {
  if (typeof raw !== 'object' || raw === null) throw new InvalidIngestError('Each item must be an object.');
  const item = raw as Record<string, unknown>;
  const ok =
    isString(item.domain) &&
    normalizeDomain(item.domain).includes('.') &&
    item.platform === 'google' &&
    (item.status === 'active' || item.status === 'lapsed' || item.status === 'none') &&
    typeof item.adCount === 'number' &&
    Number.isInteger(item.adCount) &&
    item.adCount >= 0 &&
    Array.isArray(item.advertisers) &&
    item.advertisers.every((a) => isString(a?.id) && isString(a?.name)) &&
    isDateOrNull(item.firstShown) &&
    isDateOrNull(item.lastShown) &&
    isString(item.sourceUrl) &&
    /^https:\/\//.test(item.sourceUrl) &&
    isString(item.checkedAt) &&
    !Number.isNaN(Date.parse(item.checkedAt));
  if (!ok) throw new InvalidIngestError(`Malformed ad check for ${String(item.domain)}.`);
  return item as unknown as AdCheckIngest;
}

/** Records an ad check against the company with this domain. Returns false if there is no such company. */
export async function ingestAdCheck(db: Db, input: AdCheckIngest): Promise<boolean> {
  const domain = normalizeDomain(input.domain);
  const company = (await db.select({ id: companies.id }).from(companies).where(eq(companies.domain, domain)).limit(1))[0];
  if (!company) return false;

  await db.insert(adChecks).values({
    companyId: company.id,
    platform: input.platform,
    status: input.status,
    adCount: input.adCount,
    advertisers: input.advertisers,
    formats: input.formats,
    firstShown: input.firstShown,
    lastShown: input.lastShown,
    sourceUrl: input.sourceUrl,
    checkedAt: new Date(input.checkedAt),
  });
  return true;
}

export interface CompanyIngest {
  name: string;
  websiteUrl: string;
  segment?: string;
  city?: string;
  region?: string;
  source: string;
  /** Source-specific details, e.g. a Maps listing's category, rating, phone and address. */
  sourceRef?: Record<string, unknown>;
}

/** Checks the shape of one sourced company from an untrusted request body. */
export function parseCompanyIngest(raw: unknown): CompanyIngest {
  if (typeof raw !== 'object' || raw === null) throw new InvalidIngestError('Each item must be an object.');
  const item = raw as Record<string, unknown>;
  if (!isString(item.name) || !isString(item.websiteUrl) || !isString(item.source)) {
    throw new InvalidIngestError('Each company needs a name, a websiteUrl and a source.');
  }
  if (!/^https?:\/\//.test(item.websiteUrl) || !normalizeDomain(item.websiteUrl).includes('.')) {
    throw new InvalidIngestError(`Not a site URL: ${item.websiteUrl}`);
  }
  const ref = item.sourceRef;
  if (ref !== undefined && (typeof ref !== 'object' || ref === null || Array.isArray(ref))) {
    throw new InvalidIngestError(`sourceRef for ${item.name} must be an object.`);
  }
  return {
    name: item.name.slice(0, 200),
    websiteUrl: item.websiteUrl,
    segment: isString(item.segment) ? item.segment : undefined,
    city: isString(item.city) ? item.city : undefined,
    region: isString(item.region) ? item.region : undefined,
    source: item.source,
    sourceRef: ref as Record<string, unknown> | undefined,
  };
}

/**
 * Adds a sourced company, or fills in what was missing on one we already have (a real
 * name in place of the bare domain, a city, the source details). Never overwrites a
 * source or name that was already set. Returns whether the company is new.
 */
export async function ingestCompany(db: Db, input: CompanyIngest): Promise<{ id: string; created: boolean }> {
  const domain = normalizeDomain(input.websiteUrl);
  const existing = (await db.select().from(companies).where(eq(companies.domain, domain)).limit(1))[0];

  if (!existing) {
    const [created] = await db
      .insert(companies)
      .values({
        name: input.name,
        domain,
        websiteUrl: input.websiteUrl,
        segment: input.segment,
        city: input.city,
        region: input.region,
        source: input.source,
        sourceRef: input.sourceRef,
      })
      .returning({ id: companies.id });
    return { id: created!.id, created: true };
  }

  await db
    .update(companies)
    .set({
      name: existing.name === existing.domain ? input.name : existing.name,
      segment: existing.segment ?? input.segment,
      city: existing.city ?? input.city,
      region: existing.region ?? input.region,
      sourceRef: { ...(input.sourceRef ?? {}), ...(existing.sourceRef ?? {}) },
      updatedAt: new Date(),
    })
    .where(eq(companies.id, existing.id));
  return { id: existing.id, created: false };
}
