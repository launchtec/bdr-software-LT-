import { identityLink, type OutreachMessage } from '@/lib/outreach-queries';
import { recordReply, updateMessage } from './actions';
import { CopyButton } from './copy-button';

export const CHANNEL_NAMES: Record<string, string> = {
  email: 'Email',
  facebook: 'Facebook message',
  instagram: 'Instagram message',
  linkedin: 'LinkedIn',
  direct_mail: 'Direct mail',
  phone: 'Phone',
};

const STATUS_NAMES: Record<string, string> = {
  drafted: 'Draft, needs your review',
  approved: 'Approved, ready to send',
  sent: 'Sent',
  skipped: 'Skipped',
  rejected: 'Rejected',
  scheduled: 'Scheduled',
  failed: 'Failed',
};

const REPLY_NAMES: Record<string, string> = {
  positive: 'Interested',
  not_now: 'Not now',
  negative: 'Not interested',
  wrong_person: 'Wrong person',
  opt_out: 'Asked not to be contacted',
  auto_reply: 'Auto-reply',
  unclassified: 'Unclassified',
};

/** Tall enough to show the whole message: its line breaks plus an allowance for wrapping. */
function rowsFor(body: string): number {
  const lines = body.split('\n');
  const wrapped = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 110)), 0);
  return Math.min(24, Math.max(3, wrapped + 1));
}

/** One drafted message: edit it, copy it, open where it goes, and record what happened. */
export function MessageCard({ message, dayOffset }: { message: OutreachMessage; dayOffset?: number }) {
  const { touch, identity, reply } = message;
  const link = identityLink(identity);
  const open = touch.status === 'drafted' || touch.status === 'approved';
  const fieldId = `body-${touch.id}`;
  const edited = touch.draftBody !== null && touch.body !== touch.draftBody;

  return (
    <div className={`message ${touch.status}`}>
      <div className="message-head">
        <strong>
          {touch.stepNo}. {CHANNEL_NAMES[touch.channel] ?? touch.channel}
        </strong>
        {dayOffset !== undefined ? <span className="muted small">day {dayOffset}</span> : null}
        <span className={`chip ${touch.status === 'sent' ? 'strong' : ''}`}>{STATUS_NAMES[touch.status] ?? touch.status}</span>
        {touch.sentAt ? <span className="muted small">{touch.sentAt.toISOString().slice(0, 10)}</span> : null}
        {edited ? <span className="muted small">edited by you</span> : null}
        <span className="message-target">
          {identity ? (
            link ? (
              <a href={link} target="_blank" rel="noreferrer noopener">
                {identity.channel === 'email' ? identity.value : 'Open where this goes ↗'}
              </a>
            ) : (
              identity.value
            )
          ) : (
            <span className="muted small">No address found for this channel yet</span>
          )}
        </span>
      </div>

      <form action={updateMessage}>
        <input type="hidden" name="id" value={touch.id} />
        {touch.channel === 'email' ? (
          <input type="text" name="subject" defaultValue={touch.subject ?? ''} placeholder="Subject" aria-label="Subject" readOnly={!open} />
        ) : null}
        <textarea id={fieldId} name="body" defaultValue={touch.body ?? ''} rows={rowsFor(touch.body ?? '')} aria-label="Message" readOnly={!open} />
        <div className="message-actions">
          <CopyButton fieldId={fieldId} />
          {open ? (
            <>
              <button className="btn" name="intent" value="save">
                Save edit
              </button>
              {touch.status === 'drafted' ? (
                <button className="btn primary" name="intent" value="approve">
                  Approve
                </button>
              ) : (
                <button className="btn" name="intent" value="unapprove">
                  Back to draft
                </button>
              )}
              <button className="btn" name="intent" value="sent" title="Press after you have actually sent it">
                Mark as sent
              </button>
              <button className="btn quiet" name="intent" value="skip">
                Skip
              </button>
            </>
          ) : touch.status === 'skipped' ? (
            <button className="btn" name="intent" value="unapprove">
              Bring back
            </button>
          ) : null}
        </div>
      </form>

      {touch.status === 'sent' ? (
        reply ? (
          <p className="reply">
            <strong>Reply: {REPLY_NAMES[reply.classification] ?? reply.classification}.</strong>{' '}
            {reply.body !== '(not recorded)' ? reply.body : null}
          </p>
        ) : (
          <form action={recordReply} className="reply-form">
            <input type="hidden" name="id" value={touch.id} />
            <span className="muted small">They replied?</span>
            <input type="text" name="note" placeholder="What they said (optional)" aria-label="What they said" />
            {(['positive', 'not_now', 'negative', 'wrong_person', 'opt_out'] as const).map((c) => (
              <button key={c} className="btn" name="classification" value={c}>
                {REPLY_NAMES[c]}
              </button>
            ))}
          </form>
        )
      ) : null}
    </div>
  );
}
