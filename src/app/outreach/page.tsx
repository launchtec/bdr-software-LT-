import Link from 'next/link';
import { listOutreach, type OutreachCase } from '@/lib/outreach-queries';
import { MessageCard } from './message-card';

export const dynamic = 'force-dynamic';

const VIEWS: Record<string, { label: string; keep: (c: OutreachCase) => boolean }> = {
  review: { label: 'Needs your review', keep: (c) => c.enrollment.status === 'active' && c.messages.some((m) => m.touch.status === 'drafted') },
  ready: { label: 'Ready to send', keep: (c) => c.enrollment.status === 'active' && c.messages.some((m) => m.touch.status === 'approved') },
  sent: { label: 'Sent, waiting', keep: (c) => c.enrollment.status === 'active' && c.messages.some((m) => m.touch.status === 'sent') },
  replied: { label: 'Replied', keep: (c) => c.enrollment.status === 'replied' || c.enrollment.status === 'opted_out' },
  all: { label: 'Everything', keep: () => true },
};

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: requested } = await searchParams;
  const view = requested && requested in VIEWS ? requested : 'review';
  const cases = await listOutreach();
  const shown = cases.filter(VIEWS[view]!.keep);

  return (
    <>
      <h1>Outreach</h1>
      <p className="lede">
        Every message is a draft until you approve it. Nothing sends by itself: copy the text, open where it goes, send
        it, then press “Mark as sent” so the result is recorded. When someone replies, log it and the rest of their
        sequence stops on every channel.
      </p>

      <div className="chips" style={{ marginBottom: 20 }}>
        {Object.entries(VIEWS).map(([key, v]) => (
          <Link key={key} href={`/outreach?view=${key}`} className={`chip ${view === key ? 'active' : ''}`}>
            {v.label} ({cases.filter(v.keep).length})
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="panel">
          <div className="empty">{cases.length === 0 ? 'No messages have been drafted yet.' : 'Nothing in this view.'}</div>
        </div>
      ) : (
        shown.map((c) => (
          <section className="case" key={c.enrollment.id}>
            <h2>
              <Link href={`/prospects/${c.company.id}`}>{c.company.name}</Link>
              <span className="muted small">
                {' '}
                · to {c.person.fullName}
                {c.person.title ? `, ${c.person.title}` : ''}
                {c.person.confidence ? ` (name confidence: ${c.person.confidence})` : ''}
              </span>
            </h2>
            {c.messages.map((m) => (
              <MessageCard key={m.touch.id} message={m} />
            ))}
          </section>
        ))
      )}
    </>
  );
}
