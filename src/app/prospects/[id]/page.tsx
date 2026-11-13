import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conditionLabel, findingLabel } from '@/audit/labels';
import { MATURITY_LABELS, stackMaturity } from '@/audit/maturity';
import type { Detections } from '@/audit/types';
import { isFitVerdict } from '@/db/fit';
import { findingState, getProspect } from '@/lib/queries';
import { FitButtons } from '../fit-buttons';

export const dynamic = 'force-dynamic';

const join = (values: string[]) => (values.length ? values.join(', ') : '—');

function facts(d: Detections): [string, string][] {
  return [
    ['Tag Manager', join([...d.gtm, ...d.googleTag].map((t) => t.id))],
    ['GA4', join(d.ga4.map((t) => t.id))],
    ['Universal Analytics', join(d.universalAnalytics.map((t) => t.id))],
    ['Google Ads', join(d.googleAds.map((t) => t.id))],
    ['Meta pixel', d.metaPixel.length ? join(d.metaPixel.map((t) => t.id)) : d.metaPixelLibrary ? 'Library loaded, id not read' : '—'],
    ['Other ad pixels', join(d.otherAdPixels.map((v) => v.vendor))],
    ['Call tracking', join([...d.callTracking.map((v) => v.vendor), ...(d.googleCallConversion ? ['Google call conversion'] : [])])],
    ['Lead tools', join(d.leadTools.map((v) => v.vendor))],
    ['Platform', join([...(d.platform ? [d.platform.vendor] : []), ...d.marketingVendors.map((v) => v.vendor)])],
    ['Site credit', join(d.vendorCredits.map((c) => c.text))],
    ['Phone numbers', join(d.phoneNumbers)],
    ['Forms', String(d.formCount)],
  ];
}

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) notFound();
  const { company, audit, signals, googleAds } = prospect;
  const applicable = signals.filter((s) => findingState(s, googleAds) !== 'not_applicable');
  const ruledOut = signals.filter((s) => findingState(s, googleAds) === 'not_applicable');

  return (
    <>
      <p className="small">
        <Link href="/prospects">← Prospects</Link>
      </p>
      <h1>{company.name}</h1>
      <p className="lede">
        {company.websiteUrl ? (
          <a href={company.websiteUrl} target="_blank" rel="noreferrer noopener">
            {company.websiteUrl}
          </a>
        ) : null}
        {audit?.pageTitle ? <> · {audit.pageTitle}</> : null}
        {audit ? <> · audited {audit.auditedAt.toISOString().slice(0, 10)}</> : null}
      </p>

      <h2>Your call</h2>
      <div className="panel" style={{ padding: '14px 18px' }}>
        <FitButtons
          companyId={company.id}
          current={isFitVerdict(company.fitVerdict) ? company.fitVerdict : null}
          note={company.fitNote}
          withNote
        />
        {audit?.status === 'ok' && audit.detections ? (
          <p className="muted small" style={{ margin: '10px 0 0' }}>
            Setup: <strong>{MATURITY_LABELS[stackMaturity(audit.detections)].label}</strong>.{' '}
            {MATURITY_LABELS[stackMaturity(audit.detections)].meaning}
          </p>
        ) : null}
      </div>

      <h2>Google ads</h2>
      <div className="panel" style={{ padding: '14px 18px' }}>
        {googleAds ? (
          <>
            <p style={{ margin: 0 }}>
              {googleAds.status === 'active' ? (
                <>
                  <strong>Running ads.</strong> {googleAds.adCount} ads listed, most recently shown {googleAds.lastShown}; the
                  oldest first shown {googleAds.firstShown}.
                </>
              ) : googleAds.status === 'lapsed' ? (
                <>
                  <strong>Lapsed.</strong> {googleAds.adCount} ads listed, but none shown since {googleAds.lastShown}.
                </>
              ) : (
                <>
                  <strong>None listed.</strong> Google&apos;s ad library shows no ads pointing to this domain.
                </>
              )}
            </p>
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              {googleAds.advertisers.length > 0 ? <>Advertiser: {googleAds.advertisers.map((a) => a.name).join(', ')} · </> : null}
              Checked {googleAds.checkedAt.toISOString().slice(0, 10)} ·{' '}
              <a href={googleAds.sourceUrl} target="_blank" rel="noreferrer noopener">
                See it in Google&apos;s Ads Transparency Center
              </a>
              . Ads pointing to a different domain would not appear.
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Not checked yet.
          </p>
        )}
      </div>

      {audit?.status === 'not_auditable' ? (
        <div className="notice">
          <strong>This site could not be audited.</strong> {audit.error} Nothing is claimed about it.
        </div>
      ) : null}
      {audit?.limitations.map((note) => (
        <div className="notice" key={note}>
          {note}
        </div>
      ))}

      {audit?.status === 'ok' ? (
        <>
          <h2>Findings ({applicable.length})</h2>
          <div className="panel">
            {applicable.length === 0 ? (
              <div className="empty">The audit found nothing worth raising.</div>
            ) : (
              applicable.map((s) => {
                const state = findingState(s, googleAds);
                const condition = conditionLabel(s.data?.appliesWhen, state);
                return (
                  <div className="finding" key={s.id}>
                    <h3>
                      {findingLabel(s.code)}
                      <span className="chip">{s.confidence === 'observed' ? 'Observed directly' : 'Likely (inferred)'}</span>
                      {condition ? <span className={`chip ${state === 'usable' ? 'strong' : 'off'}`}>{condition}</span> : null}
                    </h3>
                    <p>{s.statement}</p>
                    {s.caveat ? <p className="muted small">Caveat: {s.caveat}</p> : null}
                    {s.evidence.length > 0 ? (
                      <details>
                        <summary>Evidence ({s.evidence.length})</summary>
                        <ul className="evidence">
                          {s.evidence.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {ruledOut.length > 0 ? (
            <p className="muted small">
              Not shown because the company has no current Google ads: {ruledOut.map((s) => findingLabel(s.code)).join(', ')}.
            </p>
          ) : null}

          {audit.detections ? (
            <>
              <h2>What the site runs</h2>
              <div className="panel">
                <dl className="facts">
                  {facts(audit.detections).flatMap(([label, value]) => [
                    <dt key={`${label}-t`}>{label}</dt>,
                    <dd key={`${label}-d`}>{value}</dd>,
                  ])}
                </dl>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
