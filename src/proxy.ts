import { NextResponse, type NextRequest } from 'next/server';
import { checkBasicAuth } from './lib/auth';

/**
 * Password gate for every page. The app holds prospect research, so it fails closed:
 * in production, a missing APP_PASSWORD locks the app instead of opening it.
 */
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('APP_PASSWORD is not set, so the app is locked.', { status: 503 });
    }
    return NextResponse.next();
  }

  if (checkBasicAuth(request.headers.get('authorization'), password, process.env.APP_USERNAME)) {
    return NextResponse.next();
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="LaunchTec BDR", charset="UTF-8"' },
  });
}

export const config = {
  // The ingest and export APIs have their own token check; the health check and static assets are public.
  matcher: ['/((?!api/ingest|api/export|api/health|_next/static|_next/image|favicon.ico).*)'],
};
