import { and, eq } from 'drizzle-orm';
import { signals } from '../db/schema';
import type { Db } from '../db/suppression';
import type { SiteAudit } from './types';

export const SITE_AUDIT_COLLECTOR = 'site_audit';

/**
 * Stores an audit's findings as signals for the company, replacing the previous
 * site-audit signals so a re-audit never leaves stale claims behind.
 */
export async function saveAuditSignals(db: Db, companyId: string, audit: SiteAudit): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.delete(signals).where(and(eq(signals.companyId, companyId), eq(signals.collector, SITE_AUDIT_COLLECTOR)));
    if (audit.findings.length === 0) return 0;

    await tx.insert(signals).values(
      audit.findings.map((f) => ({
        companyId,
        code: f.code,
        collector: SITE_AUDIT_COLLECTOR,
        confidence: f.confidence,
        statement: f.statement,
        caveat: f.caveat,
        evidence: f.evidence,
        data: { appliesWhen: f.appliesWhen ?? null, auditedUrl: audit.url },
        observedAt: new Date(audit.auditedAt),
      })),
    );
    return audit.findings.length;
  });
}
