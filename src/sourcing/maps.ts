/**
 * Finds local businesses from Google Maps search results.
 *
 * Unlike web search rankings, Maps lists the small and mid-sized local companies too.
 * Logged-out Maps hides review counts, so size has to come from elsewhere (the official
 * Places API, or the other research signals).
 */
import type { Browser } from 'playwright';
import { launchBrowser } from '../audit/collect';
import { normalizeDomain } from '../db/suppression';

export interface MapsListing {
  name: string;
  category: string | null;
  rating: number | null;
  address: string | null;
  phone: string | null;
  /** The business's own site, or null when the listing has none or links to a directory or social page. */
  website: string | null;
  domain: string | null;
  placeUrl: string | null;
  /** The search that surfaced it. */
  query: string;
}

export interface RawCard {
  name: string;
  ratingLabel: string | null;
  text: string;
  website: string | null;
  placeUrl: string | null;
}

/** Hosts that are not a business's own website. */
const NOT_OWN_SITE = [
  'facebook.com', 'instagram.com', 'yelp.com', 'google.com', 'linktr.ee', 'business.site', 'angi.com',
  'homeadvisor.com', 'thumbtack.com', 'nextdoor.com', 'bbb.org', 'linkedin.com', 'youtube.com', 'x.com', 'twitter.com',
];

const STATUS_WORDS = /\s+(?:Open|Closed|Closes|Opens|Temporarily|Permanently)\b.*$/;

function ownSite(url: string | null): { website: string | null; domain: string | null } {
  if (!url) return { website: null, domain: null };
  const domain = normalizeDomain(url);
  if (!domain.includes('.') || NOT_OWN_SITE.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { website: null, domain: null };
  }
  // Keep the address the listing points at, minus tracking parameters.
  let website = url;
  try {
    const parsed = new URL(url);
    website = `${parsed.origin}${parsed.pathname}`;
  } catch {
    website = `https://${domain}/`;
  }
  return { website, domain };
}

/** Turns one result card into a listing. Pure, so it is tested against real card text. */
export function parseCard(card: RawCard, query: string): MapsListing | null {
  const name = card.name.trim();
  if (!name) return null;

  const ratingMatch = /([\d.]+)\s+stars?/.exec(card.ratingLabel ?? '');
  const rating = ratingMatch ? Number(ratingMatch[1]) : null;

  // Card text reads: "<name> <name> <rating> <category> · <address> <hours> · <phone> Website Directions"
  let rest = card.text.replace(/\s+/g, ' ').trim();
  while (rest.startsWith(name)) rest = rest.slice(name.length).trim();
  rest = rest.replace(/^[\d.]+\s+/, '').replace(/\s+(?:Website|Directions)\b/g, '');

  const phoneMatch = /\+1[\s-]\(?\d{3}\)?[\s-]\d{3}-\d{4}/.exec(rest);
  const parts = rest.split('·').map((p) => p.trim()).filter(Boolean);

  const category = parts[0]?.replace(STATUS_WORDS, '').trim() || null;
  const addressPart = parts.slice(1).find((p) => /^\d+\s/.test(p) && !p.startsWith('+'));
  const address = addressPart?.replace(STATUS_WORDS, '').trim() || null;

  return {
    name,
    category: category && !/^\+?\d/.test(category) ? category : null,
    rating: rating !== null && Number.isFinite(rating) ? rating : null,
    address,
    phone: phoneMatch ? phoneMatch[0] : null,
    ...ownSite(card.website),
    placeUrl: card.placeUrl,
    query,
  };
}

export interface MapsSearchOptions {
  browser?: Browser;
  /** How many times to scroll the result list for more listings. */
  scrolls?: number;
}

/** Runs one Maps search and returns its listings. Throws if the result list never appears. */
export async function searchMaps(query: string, options: MapsSearchOptions = {}): Promise<MapsListing[]> {
  const browser = options.browser ?? (await launchBrowser());
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });

  try {
    const page = await context.newPage();
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });

    const feed = page.locator('div[role="feed"]');
    try {
      await feed.waitFor({ state: 'visible', timeout: 20_000 });
    } catch {
      throw new Error(`Google Maps showed no result list for "${query}" (it may be blocking this visit).`);
    }

    for (let i = 0; i < (options.scrolls ?? 6); i++) {
      await feed.evaluate((el) => el.scrollBy(0, 4000));
      await page.waitForTimeout(1200);
    }

    const cards: RawCard[] = await page.locator('div[role="feed"] div[role="article"]').evaluateAll((elements) =>
      elements.map((el) => {
        const link = el.querySelector('a.hfpxzc') as HTMLAnchorElement | null;
        return {
          name: link?.getAttribute('aria-label') ?? '',
          ratingLabel: el.querySelector('span[role="img"]')?.getAttribute('aria-label') ?? null,
          text: (el as HTMLElement).innerText,
          website: (el.querySelector('a[data-value="Website"]') as HTMLAnchorElement | null)?.href ?? null,
          placeUrl: link?.href ?? null,
        };
      }),
    );

    return cards.map((card) => parseCard(card, query)).filter((l): l is MapsListing => l !== null);
  } finally {
    await context.close();
    if (!options.browser) await browser.close();
  }
}
