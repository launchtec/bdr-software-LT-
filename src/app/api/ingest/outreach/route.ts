import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { InvalidIngestError } from '@/db/ingest';
import { ingestOutreach, parseOutreachIngest } from '@/db/outreach';
import { checkBearer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 100;

/** Receives research and drafted messages from a worker: `{ "items": [OutreachIngest, …] }`. */
export async function POST(request: Request) {
  const token = process.env.INGEST_TOKEN;
  if (!token) return NextResponse.json({ error: 'INGEST_TOKEN is not set on the server.' }, { status: 503 });
  if (!checkBearer(request.headers.get('authorization'), token)) {
    return NextResponse.json({ error: 'Invalid or missing token.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Send between 1 and ${MAX_ITEMS} items in "items".` }, { status: 400 });
  }

  try {
    const parsed = items.map(parseOutreachIngest);
    const db = getDb();
    const unknownDomains: string[] = [];
    let draftsWritten = 0;
    let draftsKept = 0;
    for (const item of parsed) {
      const result = await ingestOutreach(db, item);
      if (!result) unknownDomains.push(item.domain);
      else {
        draftsWritten += result.draftsWritten;
        draftsKept += result.draftsKept;
      }
    }
    return NextResponse.json({ stored: parsed.length - unknownDomains.length, draftsWritten, draftsKept, unknownDomains });
  } catch (error) {
    if (error instanceof InvalidIngestError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
