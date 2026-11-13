/**
 * Checks whether a company runs Google ads, using Google's public Ads Transparency
 * Center. The site lists every ad a verified advertiser has pointed at a domain, with
 * the dates each was first and last shown.
 */
import type { Browser } from 'playwright';
import { launchBrowser } from '../audit/collect';

/** Days since an ad was last shown after which the advertiser counts as lapsed. */
export const ACTIVE_WINDOW_DAYS = 30;

export type AdStatus = 'active' | 'lapsed' | 'none';

export interface GoogleAdsCheck {
  platform: 'google';
  domain: string;
  region: 'US';
  checkedAt: string;
  status: AdStatus;
  /** Ads the library lists for the domain. */
  adCount: number;
  advertisers: { id: string; name: string }[];
  formats: { text: number; image: number; video: number };
  /** ISO dates (YYYY-MM-DD) across the listed ads. */
  firstShown: string | null;
  lastShown: string | null;
  /** The public page a person can open to see the same thing. */
  sourceUrl: string;
}

/** Raised when the library could not be read, so nothing may be concluded. */
export class AdCheckError extends Error {
  constructor(domain: string, reason: string) {
    super(`Could not check Google ads for ${domain}: ${reason}`);
    this.name = 'AdCheckError';
  }
}

export function transparencyUrl(domain: string): string {
  return `https://adstransparency.google.com/?region=US&domain=${encodeURIComponent(domain)}`;
}

const isoDate = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

interface RawCreative {
  '1'?: string; // advertiser id
  '4'?: number; // format: 1 text, 2 image, 3 video
  '6'?: { '1'?: string }; // first shown, epoch seconds
  '7'?: { '1'?: string }; // last shown, epoch seconds
  '12'?: string; // advertiser name
}

/**
 * Parses the library's search response. An empty object is the library's way of saying
 * "no ads"; anything that is not a JSON object means the response cannot be trusted.
 */
export function parseSearchCreatives(domain: string, body: string, now: Date = new Date()): GoogleAdsCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new AdCheckError(domain, 'the response was not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AdCheckError(domain, 'the response had an unexpected shape');
  }

  const data = parsed as { '1'?: unknown; '4'?: string; '5'?: string };
  if (data['1'] !== undefined && !Array.isArray(data['1'])) {
    throw new AdCheckError(domain, 'the ad list had an unexpected shape');
  }
  const creatives = (data['1'] ?? []) as RawCreative[];

  const advertisers = new Map<string, string>();
  const formats = { text: 0, image: 0, video: 0 };
  let first = Infinity;
  let last = -Infinity;

  for (const creative of creatives) {
    if (creative['1']) advertisers.set(creative['1'], creative['12'] ?? 'Unknown advertiser');
    if (creative['4'] === 1) formats.text += 1;
    else if (creative['4'] === 2) formats.image += 1;
    else if (creative['4'] === 3) formats.video += 1;

    const firstShown = Number(creative['6']?.['1']);
    const lastShown = Number(creative['7']?.['1']);
    if (Number.isFinite(firstShown) && firstShown > 0) first = Math.min(first, firstShown);
    if (Number.isFinite(lastShown) && lastShown > 0) last = Math.max(last, lastShown);
  }

  const total = Math.max(creatives.length, Number(data['5'] ?? data['4'] ?? 0) || 0);
  let status: AdStatus = 'none';
  if (total > 0) {
    // Without a last-shown date we cannot call the advertiser active.
    const daysSince = Number.isFinite(last) ? (now.getTime() / 1000 - last) / 86_400 : Infinity;
    status = daysSince <= ACTIVE_WINDOW_DAYS ? 'active' : 'lapsed';
  }

  return {
    platform: 'google',
    domain,
    region: 'US',
    checkedAt: now.toISOString(),
    status,
    adCount: total,
    advertisers: [...advertisers].map(([id, name]) => ({ id, name })),
    formats,
    firstShown: Number.isFinite(first) ? isoDate(first) : null,
    lastShown: Number.isFinite(last) ? isoDate(last) : null,
    sourceUrl: transparencyUrl(domain),
  };
}

export interface AdCheckOptions {
  browser?: Browser;
  timeoutMs?: number;
}

/** Opens the Transparency Center for the domain and reads the search result it loads. */
export async function checkGoogleAds(domain: string, options: AdCheckOptions = {}): Promise<GoogleAdsCheck> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const browser = options.browser ?? (await launchBrowser());
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });

  try {
    const page = await context.newPage();
    const responsePromise = page.waitForResponse((r) => r.url().includes('/SearchService/SearchCreatives'), { timeout: timeoutMs });
    // Attach a handler now so a navigation failure does not leave this rejection unhandled.
    responsePromise.catch(() => undefined);

    await page.goto(transparencyUrl(domain), { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    let response;
    try {
      response = await responsePromise;
    } catch {
      throw new AdCheckError(domain, 'the library did not return a search result');
    }
    if (!response.ok()) throw new AdCheckError(domain, `the library answered HTTP ${response.status()}`);

    return parseSearchCreatives(domain, await response.text());
  } finally {
    await context.close();
    if (!options.browser) await browser.close();
  }
}
