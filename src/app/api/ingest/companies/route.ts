import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { ingestCompany, InvalidIngestError, parseCompanyIngest } from '@/db/ingest';
import { checkBearer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 500;

/** Receives sourced companies from a worker: `{ "companies": [{ name, websiteUrl, source, … }] }`. */
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

  const items = (body as { companies?: unknown })?.companies;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Send between 1 and ${MAX_ITEMS} items in "companies".` }, { status: 400 });
  }

  try {
    const parsed = items.map(parseCompanyIngest);
    const db = getDb();
    let created = 0;
    for (const item of parsed) if ((await ingestCompany(db, item)).created) created += 1;
    return NextResponse.json({ received: parsed.length, created, alreadyKnown: parsed.length - created });
  } catch (error) {
    if (error instanceof InvalidIngestError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
