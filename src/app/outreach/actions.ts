'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { actOnTouch, editTouch, logReply, type ReplyClass, type TouchAction } from '@/db/outreach';
import { replyClassEnum } from '@/db/schema';

const REVIEWER = process.env.APP_USERNAME ?? 'reviewer';
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

function refresh() {
  revalidatePath('/');
  revalidatePath('/outreach');
  revalidatePath('/prospects', 'layout');
}

/** One form handles a message: save the edit, then apply whichever button was pressed. */
export async function updateMessage(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const intent = String(formData.get('intent') ?? 'save');
  if (!isId(id)) return;

  const db = getDb();
  const body = formData.get('body');
  const subject = formData.get('subject');
  if (typeof body === 'string' && body.trim()) {
    await editTouch(db, id, { body: body.trim(), subject: typeof subject === 'string' ? subject.trim() || null : undefined });
  }
  if (intent === 'approve' || intent === 'unapprove' || intent === 'sent' || intent === 'skip') {
    await actOnTouch(db, id, intent as TouchAction, REVIEWER);
  }
  refresh();
}

export async function recordReply(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const classification = String(formData.get('classification') ?? '');
  if (!isId(id) || !(replyClassEnum.enumValues as readonly string[]).includes(classification)) return;
  const note = formData.get('note');
  await logReply(getDb(), id, {
    classification: classification as ReplyClass,
    body: typeof note === 'string' ? note : undefined,
    by: REVIEWER,
  });
  refresh();
}
