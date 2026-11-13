import Link from 'next/link';
import { findingLabel } from '@/audit/labels';
import { MATURITY_LABELS, stackMaturity } from '@/audit/maturity';
import type { Detections } from '@/audit/types';
import { FIT_LABELS, isFitVerdict } from '@/db/fit';
import { findingState, listProspects, type AdCheckRow, type Prospect } from '@/lib/queries';
import { shortlistReason } from '@/lib/shortlist';
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

const ADS_LABELS: Record<string, string> = { active: 'Active', lapsed: 'Lapsed', none: 'None listed', unchecked: 'Not checked' };

const adsKey = (ads: AdCheckRow | null) => ads?.status ?? 'unchecked';

function href(params: { finding?: string; fit?: string; ads?: string; view?: string }): string {
  const query = new URLSearchParams();
  if (params.view) query.set('view', params.view);
  if (params.finding) query.set('finding', params.finding);
  if (params.fit) query.set('fit', params.fit);
  if (params.ads) query.set('ads', params.ads);
  const text = query.toString();
  return text ? `/prospects?${text}` : '/prospects';
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ finding?: string; fit?: string; ads?: string; view?: string }>;
}) {
  const { finding, fit, ads, view } = await searchParams;
  const loaded = await listProspects();
  const shortlisted = new Set(loaded.filter((p) => shortlistReason(p).shortlisted).map((p) => p.company.id));
  // Shortlisted companies first, then alphabetical (the order they were loaded in).
  const all = [...loaded].sort((a, b) => Number(shortlisted.has(b.company.id)) - Number(shortlisted.has(a.company.id)));

  const codes = [...new Set(all.flatMap((p) => p.signals.map((s) => s.code)))].sort((a, b) =>
    findingLabel(a).localeCompare(findingLabel(b)),
  );

  const matchesFit = (p: Prospect) =>
    !fit || (fit === 'unreviewed' ? p.company.fitVerdict === null : p.company.fitVerdict === fit);
  // A finding that the ad check ruled out does not count as a match.
  const matchesFinding = (p: Prospect) =>
    !finding || p.signals.some((s) => s.code === finding && findingState(s, p.googleAds) !== 'not_applicable');
  const matchesAds = (p: Prospect) => !ads || adsKey(p.googleAds) === ads;
  const matchesView = (p: Prospect) => view !== 'shortlist' || shortlisted.has(p.company.id);
  const shown = all.filter((p) => matchesView(p) && matchesFit(p) && matchesFinding(p) && matchesAds(p));

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
        <span className="filter-label">View</span>
        <div className="chips">
          <Link href={href({ finding, fit, ads, view: 'shortlist' })} className={`chip ${view === 'shortlist' ? 'active' : ''}`}>
            Shortlist ({shortlisted.size})
          </Link>
          <Link href={href({ finding, fit, ads })} className={`chip ${view === 'shortlist' ? '' : 'active'}`}>
            Everything ({all.length})
          </Link>
        </div>
        <span className="filter-label">Your call</span>
        <div className="chips">
          <Link href={href({ view, finding, ads })} className={`chip ${fit ? '' : 'active'}`}>
            All ({all.length})
          </Link>
          {fitOptions.map((option) => (
            <Link
              key={option.key}
              href={href({ view, finding, ads, fit: option.key })}
              className={`chip ${fit === option.key ? 'active' : ''}`}
            >
              {option.label} ({option.count})
            </Link>
          ))}
        </div>
        <span className="filter-label">Google ads</span>
        <div className="chips">
          <Link href={href({ view, finding, fit })} className={`chip ${ads ? '' : 'active'}`}>
            Any
          </Link>
          {Object.entries(ADS_LABELS).map(([key, label]) => (
            <Link key={key} href={href({ view, finding, fit, ads: key })} className={`chip ${ads === key ? 'active' : ''}`}>
              {label} ({all.filter((p) => adsKey(p.googleAds) === key).length})
            </Link>
          ))}
        </div>
        {codes.length > 0 ? (
          <>
            <span className="filter-label">Finding</span>
            <div className="chips">
              <Link href={href({ view, fit, ads })} className={`chip ${finding ? '' : 'active'}`}>
                Any
              </Link>
              {codes.map((code) => (
                <Link key={code} href={href({ view, fit, ads, finding: code })} className={`chip ${finding === code ? 'active' : ''}`}>
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
                <th>Google ads</th>
                <th>Findings</th>
                <th>Your call</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <Row key={p.company.id} prospect={p} shortlisted={shortlisted.has(p.company.id)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted small">
        The shortlist is companies running Google ads now, with a confirmed gap in tracking them, whose setup is not
        already built out and whose ad operation is not large. Setup is a rough read of how built-out the site&apos;s tracking is. “Built out” usually means an agency is
        already in place.
      </p>
    </>
  );
}

function sourceText(ref: Record<string, unknown> | null, key: string): string | null {
  const value = ref?.[key];
  return typeof value === 'string' && value ? value : null;
}

function Row({ prospect, shortlisted }: { prospect: Prospect; shortlisted: boolean }) {
  const { company, audit, signals, googleAds } = prospect;
  const usable = signals.filter((s) => findingState(s, googleAds) === 'usable');
  const unconfirmed = signals.filter((s) => findingState(s, googleAds) === 'unconfirmed').length;
  const detections = audit?.status === 'ok' ? audit.detections : null;
  const maturity = detections ? MATURITY_LABELS[stackMaturity(detections)] : null;

  return (
    <tr>
      <td>
        <Link href={`/prospects/${company.id}`}>
          <strong>{company.name}</strong>
        </Link>
        {shortlisted ? <span className="chip strong" style={{ marginLeft: 8 }}>Shortlist</span> : null}
        <div className="muted small">
          {[company.name === company.domain ? null : company.domain, sourceText(company.sourceRef, 'category'), sourceText(company.sourceRef, 'place')]
            .filter(Boolean)
            .join(' · ') || audit?.pageTitle?.slice(0, 70)}
        </div>
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
      <td style={{ whiteSpace: 'nowrap' }}>
        {googleAds ? (
          <>
            <a href={googleAds.sourceUrl} target="_blank" rel="noreferrer noopener" title="Open Google's Ads Transparency Center">
              {ADS_LABELS[googleAds.status]}
            </a>
            {googleAds.status !== 'none' ? (
              <div className="muted small">
                {googleAds.adCount} ads · last {googleAds.lastShown ?? 'unknown'}
              </div>
            ) : null}
          </>
        ) : (
          <span className="muted small">Not checked</span>
        )}
      </td>
      <td>
        <div className="chips">
          {usable.map((s) => (
            <span key={s.id} className="chip strong">
              {findingLabel(s.code)}
            </span>
          ))}
          {unconfirmed > 0 ? <span className="chip off">+{unconfirmed} unconfirmed</span> : null}
          {usable.length === 0 && unconfirmed === 0 && detections ? <span className="muted small">Nothing usable</span> : null}
        </div>
      </td>
      <td>
        <FitButtons companyId={company.id} current={isFitVerdict(company.fitVerdict) ? company.fitVerdict : null} />
      </td>
    </tr>
  );
}
