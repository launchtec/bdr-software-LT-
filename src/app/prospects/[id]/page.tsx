import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conditionLabel, findingLabel } from '@/audit/labels';
import { MATURITY_LABELS, stackMaturity } from '@/audit/maturity';
import type { Detections } from '@/audit/types';
import { isFitVerdict } from '@/db/fit';
import { getOutreachForCompany, getPeople } from '@/lib/outreach-queries';
import { findingState, getProspect } from '@/lib/queries';
import { MessageCard } from '../../outreach/message-card';
import { FitButtons } from '../fit-buttons';

export const dynamic = 'force-dynamic';

const join = (values: string[]) => (values.length ? values.join(', ') : '—');

interface Research {
  whatTheyDo?: unknown;
  sizeClues?: unknown;
  redFlags?: unknown;
  hooks?: ({ fact?: string } | string)[];
  whoRunsTheirAds?: unknown;
  researchNotes?: unknown;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

function ResearchList({ label, items }: { label: string; items: unknown }) {
  const list = Array.isArray(items) ? items.filter((i): i is string => typeof i === 'string' && i.trim().length > 0) : [];
  if (list.length === 0) return null;
  return (
    <p className="small" style={{ margin: '0 0 6px' }}>
      <strong>{label}:</strong> {list.join(' · ')}
    </p>
  );
}

const NETWORK_NAMES: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  nextdoor: 'Nextdoor',
};

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
  const [contacts, outreach] = await Promise.all([getPeople(company.id), getOutreachForCompany(company.id)]);
  const research = company.research as Research | null;

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
        {typeof company.sourceRef?.category === 'string' ? <> · {company.sourceRef.category}</> : null}
        {typeof company.sourceRef?.place === 'string' ? <> · found near {company.sourceRef.place}</> : null}
        {typeof company.sourceRef?.phone === 'string' ? <> · {company.sourceRef.phone}</> : null}
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

      {research || contacts.length > 0 ? (
        <>
          <h2>Research</h2>
          <div className="panel" style={{ padding: '14px 18px' }}>
            {contacts.map(({ person, identities }) => (
              <p key={person.id} style={{ margin: '0 0 8px' }}>
                <strong>{person.fullName}</strong>
                {person.title ? `, ${person.title}` : ''}
                {person.confidence ? <span className="muted small"> · name confidence: {person.confidence}</span> : null}
                {person.sourceUrl ? (
                  <>
                    {' '}
                    <a className="small" href={person.sourceUrl} target="_blank" rel="noreferrer noopener">
                      source ↗
                    </a>
                  </>
                ) : null}
                {identities.length > 0 ? (
                  <span className="muted small"> · {identities.map((i) => (i.channel === 'email' ? i.value : i.channel)).join(', ')}</span>
                ) : null}
              </p>
            ))}
            {research ? (
              <>
                {text(research.whatTheyDo) ? <p style={{ margin: '0 0 8px' }}>{text(research.whatTheyDo)}</p> : null}
                <ResearchList label="Size clues" items={research.sizeClues} />
                <ResearchList label="Red flags" items={research.redFlags} />
                <ResearchList label="Hooks" items={(research.hooks ?? []).map((h) => (typeof h === 'string' ? h : h?.fact))} />
                {text(research.whoRunsTheirAds) ? <p className="small" style={{ margin: '0 0 6px' }}>Who runs their ads: {text(research.whoRunsTheirAds)}</p> : null}
                {text(research.researchNotes) ? <p className="muted small" style={{ margin: 0 }}>{text(research.researchNotes)}</p> : null}
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {outreach.length > 0 ? (
        <>
          <h2>Messages</h2>
          {outreach.flatMap((c) => c.messages.map((m) => <MessageCard key={m.touch.id} message={m} />))}
        </>
      ) : null}

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
              ) : googleAds.advertisers.some((a) => a.thirdParty) ? (
                <>
                  <strong>No ads of its own.</strong> The only ads pointing to this domain are run by{' '}
                  {googleAds.advertisers.filter((a) => a.thirdParty).map((a) => a.name).join(', ')}, a third-party
                  programme, not by the company.
                </>
              ) : (
                <>
                  <strong>None listed.</strong> Google&apos;s ad library shows no ads pointing to this domain.
                </>
              )}
            </p>
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              {googleAds.advertisers.some((a) => !a.thirdParty) ? (
                <>
                  Ad account: {googleAds.advertisers.filter((a) => !a.thirdParty).map((a) => a.name).join(', ')} (if that is not
                  the company&apos;s own name, it is usually their agency) ·{' '}
                </>
              ) : null}
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
              <h2>Where they can be reached</h2>
              <div className="panel" style={{ padding: '14px 18px' }}>
                {audit.detections.socialProfiles === undefined ? (
                  <span className="muted">Not collected yet for this company.</span>
                ) : audit.detections.socialProfiles.length === 0 ? (
                  <span className="muted">The site links to no social profiles.</span>
                ) : (
                  <div className="chips">
                    {audit.detections.socialProfiles.map((profile) => (
                      <a key={profile.network} className="chip" href={profile.url} target="_blank" rel="noreferrer noopener">
                        {NETWORK_NAMES[profile.network] ?? profile.network} ↗
                      </a>
                    ))}
                  </div>
                )}
                {typeof company.sourceRef?.phone === 'string' ? (
                  <p className="muted small" style={{ margin: '10px 0 0' }}>
                    Phone on its Maps listing: {company.sourceRef.phone}
                    {typeof company.sourceRef?.address === 'string' ? <> · {company.sourceRef.address}</> : null}
                  </p>
                ) : null}
              </div>

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
