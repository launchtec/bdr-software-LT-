import Link from 'next/link';
import { findingLabel } from '@/audit/labels';
import type { Detections } from '@/audit/types';
import { isConditional, listProspects, type Prospect } from '@/lib/queries';

export const dynamic = 'force-dynamic';

function installed(d: Detections): { label: string; on: boolean }[] {
  return [
    { label: 'Tag Manager', on: d.gtm.length + d.googleTag.length > 0 },
    { label: 'GA4', on: d.ga4.length > 0 },
    { label: 'Google Ads', on: d.googleAds.length > 0 },
    { label: 'Meta pixel', on: d.metaPixel.length > 0 || d.metaPixelLibrary },
    { label: 'Call tracking', on: d.callTracking.length > 0 || d.googleCallConversion },
  ];
}

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<{ finding?: string }> }) {
  const { finding } = await searchParams;
  const all = await listProspects();

  const codes = [...new Set(all.flatMap((p) => p.signals.map((s) => s.code)))].sort((a, b) =>
    findingLabel(a).localeCompare(findingLabel(b)),
  );
  const shown = finding ? all.filter((p) => p.signals.some((s) => s.code === finding)) : all;

  return (
    <>
      <h1>Prospects</h1>
      <p className="lede">
        Every company researched so far, with what its site runs and what the audit found. Open one to see the evidence
        behind each finding.
      </p>

      {codes.length > 0 ? (
        <div className="chips" style={{ marginBottom: 16 }}>
          <Link href="/prospects" className={`chip ${finding ? '' : 'active'}`}>
            All ({all.length})
          </Link>
          {codes.map((code) => (
            <Link
              key={code}
              href={`/prospects?finding=${encodeURIComponent(code)}`}
              className={`chip ${finding === code ? 'active' : ''}`}
            >
              {findingLabel(code)}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="panel">
        {shown.length === 0 ? (
          <div className="empty">No companies yet. Audit results appear here once a worker pushes them.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Site runs</th>
                <th>Findings</th>
                <th>Audited</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <Row key={p.company.id} prospect={p} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Row({ prospect }: { prospect: Prospect }) {
  const { company, audit, signals } = prospect;
  const usable = signals.filter((s) => !isConditional(s));
  const conditional = signals.length - usable.length;

  return (
    <tr>
      <td>
        <Link href={`/prospects/${company.id}`}>
          <strong>{company.name}</strong>
        </Link>
        {audit?.pageTitle ? <div className="muted small">{audit.pageTitle.slice(0, 70)}</div> : null}
      </td>
      <td>
        {audit?.status === 'ok' && audit.detections ? (
          <div className="chips">
            {installed(audit.detections).map((item) => (
              <span key={item.label} className={`chip ${item.on ? '' : 'off'}`} title={item.on ? 'Detected' : 'Not detected'}>
                {item.on ? '✓' : '–'} {item.label}
              </span>
            ))}
          </div>
        ) : (
          <span className="muted small">{audit ? 'Could not be audited' : 'Not audited yet'}</span>
        )}
      </td>
      <td>
        <div className="chips">
          {usable.map((s) => (
            <span key={s.id} className="chip strong">
              {findingLabel(s.code)}
            </span>
          ))}
          {conditional > 0 ? <span className="chip off">+{conditional} if advertising</span> : null}
          {signals.length === 0 && audit?.status === 'ok' ? <span className="muted small">Nothing found</span> : null}
        </div>
      </td>
      <td className="muted small" style={{ whiteSpace: 'nowrap' }}>
        {audit ? audit.auditedAt.toISOString().slice(0, 10) : '—'}
      </td>
    </tr>
  );
}
