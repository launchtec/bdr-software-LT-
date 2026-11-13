import Link from 'next/link';
import { findingLabel } from '@/audit/labels';
import { MATURITY_LABELS, stackMaturity } from '@/audit/maturity';
import type { Detections } from '@/audit/types';
import { FIT_LABELS, isFitVerdict } from '@/db/fit';
import { isConditional, listProspects, type Prospect } from '@/lib/queries';
import { FitButtons } from './fit-buttons';

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

function href(params: { finding?: string; fit?: string }): string {
  const query = new URLSearchParams();
  if (params.finding) query.set('finding', params.finding);
  if (params.fit) query.set('fit', params.fit);
  const text = query.toString();
  return text ? `/prospects?${text}` : '/prospects';
}

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<{ finding?: string; fit?: string }> }) {
  const { finding, fit } = await searchParams;
  const all = await listProspects();

  const codes = [...new Set(all.flatMap((p) => p.signals.map((s) => s.code)))].sort((a, b) =>
    findingLabel(a).localeCompare(findingLabel(b)),
  );

  const matchesFit = (p: Prospect) =>
    !fit || (fit === 'unreviewed' ? p.company.fitVerdict === null : p.company.fitVerdict === fit);
  const matchesFinding = (p: Prospect) => !finding || p.signals.some((s) => s.code === finding);
  const shown = all.filter((p) => matchesFit(p) && matchesFinding(p));

  const fitOptions = [
    { key: 'unreviewed', label: 'Not reviewed', count: all.filter((p) => p.company.fitVerdict === null).length },
    ...Object.entries(FIT_LABELS).map(([key, label]) => ({
      key,
      label,
      count: all.filter((p) => p.company.fitVerdict === key).length,
    })),
  ];

  return (
    <>
      <h1>Prospects</h1>
      <p className="lede">
        Every company researched so far. Mark each one as a fit or not: your calls are what the sourcing filter gets
        tuned against. Open a company to see the evidence behind each finding.
      </p>

      <div className="filters">
        <span className="filter-label">Your call</span>
        <div className="chips">
          <Link href={href({ finding })} className={`chip ${fit ? '' : 'active'}`}>
            All ({all.length})
          </Link>
          {fitOptions.map((option) => (
            <Link
              key={option.key}
              href={href({ finding, fit: option.key })}
              className={`chip ${fit === option.key ? 'active' : ''}`}
            >
              {option.label} ({option.count})
            </Link>
          ))}
        </div>
        {codes.length > 0 ? (
          <>
            <span className="filter-label">Finding</span>
            <div className="chips">
              <Link href={href({ fit })} className={`chip ${finding ? '' : 'active'}`}>
                Any
              </Link>
              {codes.map((code) => (
                <Link key={code} href={href({ fit, finding: code })} className={`chip ${finding === code ? 'active' : ''}`}>
                  {findingLabel(code)}
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="panel">
        {shown.length === 0 ? (
          <div className="empty">
            {all.length === 0 ? 'No companies yet. Audit results appear here once a worker pushes them.' : 'No companies match these filters.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Site runs</th>
                <th>Setup</th>
                <th>Findings</th>
                <th>Your call</th>
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
      <p className="muted small">
        Setup is a rough read of how built-out the site&apos;s tracking is. “Built out” usually means an agency is
        already in place.
      </p>
    </>
  );
}

function Row({ prospect }: { prospect: Prospect }) {
  const { company, audit, signals } = prospect;
  const usable = signals.filter((s) => !isConditional(s));
  const conditional = signals.length - usable.length;
  const detections = audit?.status === 'ok' ? audit.detections : null;
  const maturity = detections ? MATURITY_LABELS[stackMaturity(detections)] : null;

  return (
    <tr>
      <td>
        <Link href={`/prospects/${company.id}`}>
          <strong>{company.name}</strong>
        </Link>
        {audit?.pageTitle ? <div className="muted small">{audit.pageTitle.slice(0, 70)}</div> : null}
      </td>
      <td>
        {detections ? (
          <div className="chips">
            {installed(detections).map((item) => (
              <span key={item.label} className={`chip ${item.on ? '' : 'off'}`} title={item.on ? 'Detected' : 'Not detected'}>
                {item.on ? '✓' : '–'} {item.label}
              </span>
            ))}
          </div>
        ) : (
          <span className="muted small">{audit ? 'Could not be audited' : 'Not audited yet'}</span>
        )}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>{maturity ? <span title={maturity.meaning}>{maturity.label}</span> : <span className="muted">—</span>}</td>
      <td>
        <div className="chips">
          {usable.map((s) => (
            <span key={s.id} className="chip strong">
              {findingLabel(s.code)}
            </span>
          ))}
          {conditional > 0 ? <span className="chip off">+{conditional} if advertising</span> : null}
          {signals.length === 0 && detections ? <span className="muted small">Nothing found</span> : null}
        </div>
      </td>
      <td>
        <FitButtons companyId={company.id} current={isFitVerdict(company.fitVerdict) ? company.fitVerdict : null} />
      </td>
    </tr>
  );
}
