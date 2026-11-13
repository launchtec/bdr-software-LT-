import { NextResponse } from 'next/server';

/** Liveness check for the host. Reveals nothing about the data. */
export function GET() {
  return NextResponse.json({ ok: true });
}
