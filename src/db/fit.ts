import { eq } from 'drizzle-orm';
import { companies, fitVerdictEnum } from './schema';
import type { Db } from './suppression';

export type FitVerdict = (typeof fitVerdictEnum.enumValues)[number];

export const FIT_LABELS: Record<FitVerdict, string> = {
  good_fit: 'Good fit',
  too_big: 'Too big',
  too_small: 'Too small',
  wrong_type: 'Wrong type',
};

export function isFitVerdict(value: unknown): value is FitVerdict {
  return typeof value === 'string' && (fitVerdictEnum.enumValues as readonly string[]).includes(value);
}

/**
 * Records (or with `null`, clears) a person's verdict on a company. A note, when given,
 * replaces the previous one. Returns false if the company does not exist.
 */
export async function setFitVerdict(db: Db, companyId: string, verdict: FitVerdict | null, note?: string): Promise<boolean> {
  const cleanedNote = note === undefined ? undefined : note.trim().slice(0, 500) || null;
  const updated = await db
    .update(companies)
    .set({
      fitVerdict: verdict,
      fitMarkedAt: verdict ? new Date() : null,
      ...(cleanedNote === undefined ? {} : { fitNote: cleanedNote }),
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId))
    .returning({ id: companies.id });
  return updated.length > 0;
}
