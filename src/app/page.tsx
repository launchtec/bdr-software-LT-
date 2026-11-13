import Link from 'next/link';
import { findingLabel } from '@/audit/labels';
import { PIPELINE, STATE_LABEL } from '@/lib/pipeline';
import { findingState, isConditional, listProspects } from '@/lib/queries';
import { shortlistReason } from '@/lib/shortlist';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const prospects = await listProspects();
  const audited = prospects.filter((p) => p.audit?.status === 'ok');
  const adChecked = prospects.filter((p) => p.googleAds);
  const advertising = prospects.filter((p) => p.googleAds?.status === 'active');
  // The strongest openers: confirmed to be paying for ads, with a gap that only matters because they are.
  const advertisingWithGap = advertising.filter((p) =>
    p.signals.some((s) => isConditional(s) && findingState(s, p.googleAds) === 'usable'),
  );

  const shortlist = prospects.filter((p) => shortlistReason(p).shortlisted);

  const counts = new Map<string, { usable: number; unconfirmed: number }>();
  for (const p of audited) {
    for (const s of p.signals) {
      const state = findingState(s, p.googleAds);
      if (state === 'not_applicable') continue;
      const entry = counts.get(s.code) ?? { usable: 0, unconfirmed: 0 };
      entry[state] += 1;
      counts.set(s.code, entry);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1].usable - a[1].usable || b[1].unconfirmed - a[1].unconfirmed);
  const max = Math.max(1, ...ranked.map(([, c]) => c.usable));

  return (
    <>
      <h1>Overview</h1>
      <p className="lede">
        What the system has researched so far, and which parts of the plan are built. Nothing is being sent to anyone
        yet.
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="label">Companies</div>
          <div className="value">{prospects.length}</div>
          <div className="note">in the research list</div>
        </div>
        <div className="tile">
          <div className="label">Sites audited</div>
          <div className="value">{audited.length}</div>
          <div className="note">{prospects.length - audited.length} could not be read</div>
        </div>
        <div className="tile">
          <div className="label">Running Google ads</div>
          <div className="value">{advertising.length}</div>
          <div className="note">of {adChecked.length} checked, shown in the last 30 days</div>
        </div>
        <div className="tile">
          <div className="label">
            <Link href="/prospects?view=shortlist">Shortlist</Link>
          </div>
          <div className="value">{shortlist.length}</div>
          <div className="note">
            of {advertisingWithGap.length} advertising with a tracking gap, minus built-out setups and large advertisers
          </div>
        </div>
      </div>

      <h2>Usable findings</h2>
      <div className="panel">
        {ranked.length === 0 ? (
          <div className="empty">No audits have been loaded yet.</div>
        ) : (
          <div className="barlist">
            {ranked.map(([code, c]) => (
              <FindingRow key={code} code={code} usable={c.usable} unconfirmed={c.unconfirmed} max={max} total={audited.length} />
            ))}
          </div>
        )}
      </div>
      <p className="muted small">
        A finding counts as usable when it is true regardless of advertising, or when the ad check confirmed the company
        runs the ads it depends on. Findings about Meta ads stay unconfirmed: there is no reliable Meta check yet.
      </p>

      <h2>Pipeline</h2>
      <div className="panel">
        <ol className="stages">
          {PIPELINE.map((stage, i) => (
            <li key={stage.name}>
              <span className="muted">{i + 1}</span>
              <strong>{stage.name}</strong>
              <span className="what muted">{stage.what}</span>
              <span className={`state ${stage.state}`}>{STATE_LABEL[stage.state]}</span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

function FindingRow(props: { code: string; usable: number; unconfirmed: number; max: number; total: number }) {
  const share = Math.round((props.usable / Math.max(1, props.total)) * 100);
  return (
    <>
      <div>
        <Link href={`/prospects?finding=${encodeURIComponent(props.code)}`}>{findingLabel(props.code)}</Link>
        {props.unconfirmed > 0 ? <span className="muted small"> · +{props.unconfirmed} unconfirmed</span> : null}
      </div>
      <div className="track" title={`Usable for ${props.usable} of ${props.total} audited sites (${share}%)`}>
        <div className="fill" style={{ width: `${(props.usable / props.max) * 100}%` }} />
      </div>
      <div className="count">{props.usable}</div>
    </>
  );
}
