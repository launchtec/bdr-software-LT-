import Link from 'next/link';
import { notFound } from 'next/navigation';
import { appliesWhenLabel, findingLabel } from '@/audit/labels';
import type { Detections } from '@/audit/types';
import { getProspect } from '@/lib/queries';

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
  const { company, audit, signals } = prospect;

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
          <h2>Findings ({signals.length})</h2>
          <div className="panel">
            {signals.length === 0 ? (
              <div className="empty">The audit found nothing worth raising.</div>
            ) : (
              signals.map((s) => {
                const condition = appliesWhenLabel(s.data?.appliesWhen);
                return (
                  <div className="finding" key={s.id}>
                    <h3>
                      {findingLabel(s.code)}
                      <span className="chip">{s.confidence === 'observed' ? 'Observed directly' : 'Likely (inferred)'}</span>
                      {condition ? <span className="chip off">{condition}</span> : null}
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
