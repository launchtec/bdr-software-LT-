import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { companies, signals, siteAudits } from '@/db/schema';

export type Company = typeof companies.$inferSelect;
export type SiteAuditRow = typeof siteAudits.$inferSelect;
export type Signal = typeof signals.$inferSelect;

export interface Prospect {
  company: Company;
  /** Most recent audit attempt, if any. */
  audit: SiteAuditRow | null;
  signals: Signal[];
}

/** A finding is conditional when it only matters if the company advertises. */
export function isConditional(signal: Signal): boolean {
  return typeof signal.data?.appliesWhen === 'string';
}

function assemble(companyRows: Company[], auditRows: SiteAuditRow[], signalRows: Signal[]): Prospect[] {
  // auditRows arrive newest first, so the first one seen per company is the latest.
  const latestAudit = new Map<string, SiteAuditRow>();
  for (const row of auditRows) if (!latestAudit.has(row.companyId)) latestAudit.set(row.companyId, row);

  const byCompany = new Map<string, Signal[]>();
  for (const row of signalRows) {
    const list = byCompany.get(row.companyId) ?? [];
    list.push(row);
    byCompany.set(row.companyId, list);
  }

  return companyRows.map((company) => ({
    company,
    audit: latestAudit.get(company.id) ?? null,
    // Unconditional findings first: they can be used as they stand.
    signals: (byCompany.get(company.id) ?? []).sort((a, b) => Number(isConditional(a)) - Number(isConditional(b))),
  }));
}

export async function listProspects(): Promise<Prospect[]> {
  const db = getDb();
  const [companyRows, auditRows, signalRows] = await Promise.all([
    db.select().from(companies).orderBy(companies.name),
    db.select().from(siteAudits).orderBy(desc(siteAudits.auditedAt)),
    db.select().from(signals),
  ]);
  return assemble(companyRows, auditRows, signalRows);
}

export async function getProspect(id: string): Promise<Prospect | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [companyRows, auditRows, signalRows] = await Promise.all([
    db.select().from(companies).where(eq(companies.id, id)),
    db.select().from(siteAudits).where(eq(siteAudits.companyId, id)).orderBy(desc(siteAudits.auditedAt)),
    db.select().from(signals).where(eq(signals.companyId, id)),
  ]);
  return assemble(companyRows, auditRows, signalRows)[0] ?? null;
}
