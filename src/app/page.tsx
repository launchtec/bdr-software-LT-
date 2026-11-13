import Link from 'next/link';
import { findingLabel } from '@/audit/labels';
import { PIPELINE, STATE_LABEL } from '@/lib/pipeline';
import { isConditional, listProspects } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const prospects = await listProspects();
  const audited = prospects.filter((p) => p.audit?.status === 'ok');
  const blocked = prospects.filter((p) => p.audit?.status === 'not_auditable');
  const withUsable = audited.filter((p) => p.signals.some((s) => !isConditional(s)));

  const counts = new Map<string, { sites: number; conditional: boolean }>();
  for (const p of audited) {
    for (const s of p.signals) {
      const entry = counts.get(s.code) ?? { sites: 0, conditional: isConditional(s) };
      entry.sites += 1;
      counts.set(s.code, entry);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1].sites - a[1].sites);
  const max = Math.max(1, ...ranked.map(([, c]) => c.sites));

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
          <div className="note">tracking setup read successfully</div>
        </div>
        <div className="tile">
          <div className="label">With a usable finding</div>
          <div className="value">{withUsable.length}</div>
          <div className="note">true whether or not they advertise</div>
        </div>
        <div className="tile">
          <div className="label">Could not audit</div>
          <div className="value">{blocked.length}</div>
          <div className="note">site blocked the visit</div>
        </div>
      </div>

      <h2>Findings across audited sites</h2>
      <div className="panel">
        {ranked.length === 0 ? (
          <div className="empty">No audits have been loaded yet.</div>
        ) : (
          <div className="barlist">
            {ranked.map(([code, c]) => (
              <FindingRow key={code} code={code} sites={c.sites} conditional={c.conditional} max={max} total={audited.length} />
            ))}
          </div>
        )}
      </div>
      <p className="muted small">
        Findings marked “if advertising” only matter once we confirm the company runs ads. That check is the next piece
        being built.
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

function FindingRow(props: { code: string; sites: number; conditional: boolean; max: number; total: number }) {
  const share = Math.round((props.sites / Math.max(1, props.total)) * 100);
  return (
    <>
      <div>
        <Link href={`/prospects?finding=${encodeURIComponent(props.code)}`}>{findingLabel(props.code)}</Link>
        {props.conditional ? <span className="muted small"> · if advertising</span> : null}
      </div>
      <div className="track" title={`${props.sites} of ${props.total} audited sites (${share}%)`}>
        <div className="fill" style={{ width: `${(props.sites / props.max) * 100}%` }} />
      </div>
      <div className="count">{props.sites}</div>
    </>
  );
}
