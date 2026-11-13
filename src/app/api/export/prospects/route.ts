import { NextResponse } from 'next/server';
import { stackMaturity } from '@/audit/maturity';
import { checkBearer } from '@/lib/auth';
import { findingState, listProspects } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** Read-only export for workers and analysis: each company with its verdict, setup rating, ads and findings. */
export async function GET(request: Request) {
  const token = process.env.INGEST_TOKEN;
  if (!token) return NextResponse.json({ error: 'INGEST_TOKEN is not set on the server.' }, { status: 503 });
  if (!checkBearer(request.headers.get('authorization'), token)) {
    return NextResponse.json({ error: 'Invalid or missing token.' }, { status: 401 });
  }

  const prospects = await listProspects();
  return NextResponse.json({
    prospects: prospects.map((p) => ({
      domain: p.company.domain,
      name: p.company.name,
      segment: p.company.segment,
      fitVerdict: p.company.fitVerdict,
      fitNote: p.company.fitNote,
      auditStatus: p.audit?.status ?? null,
      setup: p.audit?.status === 'ok' && p.audit.detections ? stackMaturity(p.audit.detections) : null,
      googleAds: p.googleAds
        ? { status: p.googleAds.status, adCount: p.googleAds.adCount, lastShown: p.googleAds.lastShown, firstShown: p.googleAds.firstShown }
        : null,
      findings: p.signals.map((s) => ({ code: s.code, state: findingState(s, p.googleAds) })),
    })),
  });
}
