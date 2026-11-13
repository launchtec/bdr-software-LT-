import { createHash, timingSafeEqual } from 'node:crypto';

/** Compares two secrets without leaking where they differ. */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * True when an `Authorization: Basic …` header carries the password. If a username is
 * given it must match too (ignoring case, since phones capitalize the first letter);
 * otherwise any username is accepted.
 */
export function checkBasicAuth(header: string | null, password: string, username?: string): boolean {
  if (!password || !header?.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;
  const passwordOk = sameSecret(decoded.slice(colon + 1), password);
  const usernameOk = !username || sameSecret(decoded.slice(0, colon).trim().toLowerCase(), username.trim().toLowerCase());
  return passwordOk && usernameOk;
}

/** True when an `Authorization: Bearer …` header carries the token. */
export function checkBearer(header: string | null, token: string): boolean {
  if (!token || !header?.startsWith('Bearer ')) return false;
  return sameSecret(header.slice(7).trim(), token);
}
