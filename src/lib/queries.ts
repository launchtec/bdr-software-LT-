import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { adChecks, companies, signals, siteAudits } from '@/db/schema';

export type Company = typeof companies.$inferSelect;
export type SiteAuditRow = typeof siteAudits.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type AdCheckRow = typeof adChecks.$inferSelect;

export interface Prospect {
  company: Company;
  /** Most recent audit attempt, if any. */
  audit: SiteAuditRow | null;
  /** Most recent Google ad-library check, if any. */
  googleAds: AdCheckRow | null;
  signals: Signal[];
}

/** A finding is conditional when it only matters if the company advertises. */
export function isConditional(signal: Signal): boolean {
  return typeof signal.data?.appliesWhen === 'string';
}

/**
 * Whether a finding can be used:
 *  - `usable`: true regardless of advertising, or its condition is confirmed by an ad check
 *  - `unconfirmed`: depends on advertising we have not been able to check
 *  - `not_applicable`: its condition was checked and is not met
 */
export type FindingState = 'usable' | 'unconfirmed' | 'not_applicable';

export function findingState(signal: Signal, googleAds: AdCheckRow | null): FindingState {
  const condition = signal.data?.appliesWhen;
  if (typeof condition !== 'string') return 'usable';

  const google = googleAds?.status ?? null;
  if (condition === 'runs_google_ads') {
    if (google === null) return 'unconfirmed';
    return google === 'active' ? 'usable' : 'not_applicable';
  }
  if (condition === 'runs_any_ads') {
    // Running Google ads settles it; not running them does not, because Meta is unchecked.
    return google === 'active' ? 'usable' : 'unconfirmed';
  }
  // runs_meta_ads: there is no reliable Meta check yet.
  return 'unconfirmed';
}

const STATE_ORDER: Record<FindingState, number> = { usable: 0, unconfirmed: 1, not_applicable: 2 };

function assemble(companyRows: Company[], auditRows: SiteAuditRow[], signalRows: Signal[], adRows: AdCheckRow[]): Prospect[] {
  // Audit and ad rows arrive newest first, so the first one seen per company is the latest.
  const latestAudit = new Map<string, SiteAuditRow>();
  for (const row of auditRows) if (!latestAudit.has(row.companyId)) latestAudit.set(row.companyId, row);

  const latestGoogle = new Map<string, AdCheckRow>();
  for (const row of adRows) {
    if (row.platform === 'google' && !latestGoogle.has(row.companyId)) latestGoogle.set(row.companyId, row);
  }

  const byCompany = new Map<string, Signal[]>();
  for (const row of signalRows) {
    const list = byCompany.get(row.companyId) ?? [];
    list.push(row);
    byCompany.set(row.companyId, list);
  }

  return companyRows.map((company) => {
    const googleAds = latestGoogle.get(company.id) ?? null;
    return {
      company,
      audit: latestAudit.get(company.id) ?? null,
      googleAds,
      signals: (byCompany.get(company.id) ?? []).sort(
        (a, b) => STATE_ORDER[findingState(a, googleAds)] - STATE_ORDER[findingState(b, googleAds)],
      ),
    };
  });
}

export async function listProspects(): Promise<Prospect[]> {
  const db = getDb();
  const [companyRows, auditRows, signalRows, adRows] = await Promise.all([
    db.select().from(companies).orderBy(companies.name),
    db.select().from(siteAudits).orderBy(desc(siteAudits.auditedAt)),
    db.select().from(signals),
    db.select().from(adChecks).orderBy(desc(adChecks.checkedAt)),
  ]);
  return assemble(companyRows, auditRows, signalRows, adRows);
}

export async function getProspect(id: string): Promise<Prospect | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [companyRows, auditRows, signalRows, adRows] = await Promise.all([
    db.select().from(companies).where(eq(companies.id, id)),
    db.select().from(siteAudits).where(eq(siteAudits.companyId, id)).orderBy(desc(siteAudits.auditedAt)),
    db.select().from(signals).where(eq(signals.companyId, id)),
    db.select().from(adChecks).where(eq(adChecks.companyId, id)).orderBy(desc(adChecks.checkedAt)),
  ]);
  return assemble(companyRows, auditRows, signalRows, adRows)[0] ?? null;
}
