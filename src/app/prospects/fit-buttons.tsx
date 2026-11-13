import { FIT_LABELS, type FitVerdict } from '@/db/fit';
import { markFit } from './actions';

const ORDER: FitVerdict[] = ['good_fit', 'too_big', 'too_small', 'wrong_type'];

/** One-click verdict on a company. With `withNote`, also shows a note field. */
export function FitButtons(props: { companyId: string; current: FitVerdict | null; note?: string | null; withNote?: boolean }) {
  return (
    <form action={markFit} className="fit">
      <input type="hidden" name="id" value={props.companyId} />
      {props.withNote ? (
        <input
          type="text"
          name="note"
          defaultValue={props.note ?? ''}
          maxLength={500}
          placeholder="Why? (optional, saved when you pick a verdict)"
          aria-label="Reason"
        />
      ) : null}
      <div className="fit-row">
        {ORDER.map((verdict) => (
          <button
            key={verdict}
            type="submit"
            name="verdict"
            value={verdict}
            className={`fitbtn ${verdict} ${props.current === verdict ? 'on' : ''}`}
            aria-pressed={props.current === verdict}
          >
            {FIT_LABELS[verdict]}
          </button>
        ))}
        {props.current ? (
          <button type="submit" name="verdict" value="clear" className="fitbtn clear" title="Clear your verdict">
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
