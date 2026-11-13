'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { isFitVerdict, setFitVerdict } from '@/db/fit';

/** Form action behind the fit buttons. Pages are already password-gated by the proxy. */
export async function markFit(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const verdict = formData.get('verdict');
  const note = formData.get('note');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  if (verdict !== 'clear' && !isFitVerdict(verdict)) return;

  await setFitVerdict(getDb(), id, verdict === 'clear' ? null : verdict, typeof note === 'string' ? note : undefined);
  revalidatePath('/');
  revalidatePath('/prospects');
  revalidatePath(`/prospects/${id}`);
}
