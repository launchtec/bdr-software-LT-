import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness check for the host. Reports the deployed commit, nothing about the data. */
export function GET() {
  return NextResponse.json({ ok: true, version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null });
}
