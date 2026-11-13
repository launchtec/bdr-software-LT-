/**
 * Stores audit results sent by an audit worker. The worker (which needs a headless
 * browser) and the web app (which does not) only meet here.
 */
import { eq } from 'drizzle-orm';
import { saveAuditSignals } from '../audit/persist';
import type { SiteAudit } from '../audit/types';
import { companies, siteAudits } from './schema';
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
