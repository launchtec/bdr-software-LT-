import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { ingestAdCheck, InvalidIngestError, parseAdCheckIngest } from '@/db/ingest';
import { checkBearer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 200;

/** Receives ad-library checks from a worker: `{ "checks": [GoogleAdsCheck, …] }`. */
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

  const items = (body as { checks?: unknown })?.checks;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Send between 1 and ${MAX_ITEMS} items in "checks".` }, { status: 400 });
  }

  try {
    const parsed = items.map(parseAdCheckIngest);
    const db = getDb();
    const unknownDomains: string[] = [];
    for (const item of parsed) if (!(await ingestAdCheck(db, item))) unknownDomains.push(item.domain);
    return NextResponse.json({ stored: parsed.length - unknownDomains.length, unknownDomains });
  } catch (error) {
    if (error instanceof InvalidIngestError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
