/**
 * Turns raw page captures into a list of what is installed on the site.
 *
 * Network requests are the primary source because Tag Manager injects tags at runtime;
 * the HTML is a fallback for tags that are present but did not fire during the visit.
 */
import type { Detections, PageCapture, TagHit, VendorHit } from './types';

const MAX_EVIDENCE = 3;

/** Vendor fingerprints matched against request hostnames (suffix match). Extend as new ones are verified. */
const HOST_VENDORS: Record<'otherAdPixels' | 'callTracking' | 'leadTools' | 'consentManagers', Record<string, string[]>> = {
  otherAdPixels: {
    'Microsoft Ads (UET)': ['bat.bing.com'],
    'LinkedIn Insight': ['snap.licdn.com', 'px.ads.linkedin.com'],
    TikTok: ['analytics.tiktok.com'],
    Pinterest: ['ct.pinterest.com'],
    Snapchat: ['tr.snapchat.com'],
    'X (Twitter)': ['static.ads-twitter.com'],
    Nextdoor: ['ads.nextdoor.com'],
  },
  callTracking: {
    CallRail: ['callrail.com'],
    CallTrackingMetrics: ['tctm.co'],
    WhatConverts: ['iconnode.com'],
    Invoca: ['invocacdn.com'],
  },
  leadTools: {
    Calendly: ['calendly.com'],
    HubSpot: ['hs-scripts.com', 'hsforms.net', 'hsforms.com', 'hs-analytics.net'],
    GoHighLevel: ['leadconnectorhq.com', 'msgsndr.com'],
    Intercom: ['intercom.io'],
    Drift: ['driftt.com'],
    Podium: ['podium.com'],
    ServiceTitan: ['servicetitan.com'],
    'Housecall Pro': ['housecallpro.com'],
    Jobber: ['getjobber.com'],
  },
  consentManagers: {
    OneTrust: ['cookielaw.org', 'onetrust.com'],
    Cookiebot: ['cookiebot.com'],
    CookieYes: ['cookieyes.com'],
    Osano: ['osano.com'],
    Termly: ['termly.io'],
    Usercentrics: ['usercentrics.eu'],
  },
};

const PLATFORM_PATTERNS: [string, RegExp][] = [
  ['Shopify', /cdn\.shopify\.com/i],
  ['Wix', /static\.wixstatic\.com|static\.parastorage\.com/i],
  ['Squarespace', /static1\.squarespace\.com|squarespace-cdn\.com/i],
  ['Webflow', /data-wf-site=|website-files\.com/i],
  ['WordPress', /\/wp-content\/|\/wp-includes\//i],
];

/** Large templated marketing vendors whose clients are worth a closer look. Matched only inside a site credit. */
const KNOWN_VENDORS = ['Scorpion', 'Hibu', 'Thryv', 'Townsquare Interactive', 'RevLocal', 'LocaliQ', 'Web.com'];

/** Matches "Website by Some Agency"; the name is trimmed to its leading capitalized words afterwards. */
const CREDIT_PATTERN =
  /\b(?:web\s?site|site|web design|design(?:ed)?|built|developed|powered|marketing|seo)\s+(?:(?:&|and)\s+\w+\s+)?by:?\s+((?:[\w&.'-]+\s*){1,4})/gi;

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

class HitMap {
  private readonly hits = new Map<string, string[]>();

  add(key: string, evidence: string): void {
    const list = this.hits.get(key) ?? [];
    const item = clip(evidence);
    if (list.length < MAX_EVIDENCE && !list.includes(item)) list.push(item);
    this.hits.set(key, list);
  }

  tags(): TagHit[] {
    return [...this.hits].map(([id, evidence]) => ({ id, evidence }));
  }

  vendors(): VendorHit[] {
    return [...this.hits].map(([vendor, evidence]) => ({ vendor, evidence }));
  }
}

/** Visible text of the page: scripts, styles and tags removed, whitespace collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAll(text: string, pattern: RegExp, onMatch: (m: RegExpExecArray) => void): void {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    onMatch(m);
    if (m[0].length === 0) re.lastIndex++;
  }
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function keepMax(target: Record<string, number>, counts: Map<string, number>): void {
  for (const [key, n] of counts) target[key] = Math.max(target[key] ?? 0, n);
}

export function detect(captures: PageCapture[]): Detections {
  const gtm = new HitMap();
  const googleTag = new HitMap();
  const ga4 = new HitMap();
  const ua = new HitMap();
  const googleAds = new HitMap();
  const metaPixel = new HitMap();
  const vendorMaps = {
    otherAdPixels: new HitMap(),
    callTracking: new HitMap(),
    leadTools: new HitMap(),
    consentManagers: new HitMap(),
  };
  const ga4MaxPageViews: Record<string, number> = {};
  const metaMaxPageViews: Record<string, number> = {};
  const phoneNumbers = new Set<string>();
  const credits = new Map<string, { text: string; knownVendor: string | null }>();
  let platform: VendorHit | null = null;
  let googleCallConversion = false;
  let tagLoaderFailed = false;
  let formCount = 0;

  for (const capture of captures) {
    const ga4Views = new Map<string, number>();
    const metaViews = new Map<string, number>();

    for (const raw of capture.requests) {
      const url = parseUrl(raw);
      if (!url) continue;
      const host = url.hostname.toLowerCase();
      const path = url.pathname;
      const idParam = url.searchParams.get('id') ?? '';
      const tid = url.searchParams.get('tid') ?? '';

      // Tag Manager and gtag loaders. Server-side setups serve these from the site's own
      // domain, so match on path and id rather than on Google's hostname.
      if (path.endsWith('/gtm.js') && /^GTM-[A-Z0-9]+$/.test(idParam)) gtm.add(idParam, raw);
      if (path.endsWith('/gtag/js')) {
        if (/^G-[A-Z0-9]+$/.test(idParam)) ga4.add(idParam, raw);
        else if (/^AW-\d+$/.test(idParam)) googleAds.add(idParam, raw);
        else if (/^UA-\d+-\d+$/.test(idParam)) ua.add(idParam, raw);
        else if (/^GT-[A-Z0-9]+$/.test(idParam)) googleTag.add(idParam, raw);
      }

      // Analytics hits.
      if (path.endsWith('/g/collect') && /^G-[A-Z0-9]+$/.test(tid)) {
        ga4.add(tid, raw);
        if (url.searchParams.get('en') === 'page_view') bump(ga4Views, tid);
      }
      if (hostMatches(host, 'google-analytics.com') && /^UA-\d+-\d+$/.test(tid)) ua.add(tid, raw);

      // Google Ads conversion and remarketing hits carry the numeric account id in the path.
      const adsHit =
        (hostMatches(host, 'googleadservices.com') || hostMatches(host, 'doubleclick.net') || hostMatches(host, 'google.com')) &&
        /\/pagead\/(?:conversion|viewthroughconversion|1p-conversion|1p-user-list)\/(\d+)/.exec(path);
      if (adsHit) googleAds.add(`AW-${adsHit[1]}`, raw);

      // Meta pixel.
      if (hostMatches(host, 'facebook.com') && /^\/tr\/?$/.test(path) && /^\d+$/.test(idParam)) {
        metaPixel.add(idParam, raw);
        if (url.searchParams.get('ev') === 'PageView') bump(metaViews, idParam);
      }

      for (const [bucket, vendors] of Object.entries(HOST_VENDORS) as [keyof typeof HOST_VENDORS, Record<string, string[]>][]) {
        for (const [vendor, suffixes] of Object.entries(vendors)) {
          if (suffixes.some((s) => hostMatches(host, s))) vendorMaps[bucket].add(vendor, raw);
        }
      }
    }

    for (const raw of capture.failedRequests) {
      const path = parseUrl(raw)?.pathname ?? '';
      if (/\/(?:gtm\.js|gtag\/js|fbevents\.js)$/.test(path)) tagLoaderFailed = true;
    }

    keepMax(ga4MaxPageViews, ga4Views);
    keepMax(metaMaxPageViews, metaViews);

    const html = capture.html;

    // Tags present in the markup, in case they did not fire while we watched.
    matchAll(html, /googletagmanager\.com\/(?:gtm\.js|ns\.html)\?id=(GTM-[A-Z0-9]+)/, (m) => gtm.add(m[1]!, m[0]));
    matchAll(html, /gtag\/js\?id=(G-[A-Z0-9]+)/, (m) => ga4.add(m[1]!, m[0]));
    matchAll(html, /gtag\/js\?id=(GT-[A-Z0-9]+)/, (m) => googleTag.add(m[1]!, m[0]));
    matchAll(html, /gtag\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"]/, (m) => ga4.add(m[1]!, m[0]));
    matchAll(html, /gtag\(\s*['"]config['"]\s*,\s*['"](AW-\d+)['"]/, (m) => googleAds.add(m[1]!, m[0]));
    matchAll(html, /gtag\/js\?id=(AW-\d+)/, (m) => googleAds.add(m[1]!, m[0]));
    matchAll(html, /['"](UA-\d{4,10}-\d{1,4})['"]/, (m) => ua.add(m[1]!, m[0]));
    matchAll(html, /fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{8,20})/, (m) => metaPixel.add(m[1]!, m[0]));

    if (/phone_conversion_number/.test(html)) googleCallConversion = true;

    matchAll(html, /href\s*=\s*["']tel:([^"']+)["']/i, (m) => {
      // Keep the national number so "(720) 555-0100" and "+17205550100" count once.
      const digits = m[1]!.replace(/%20/g, '').replace(/\D/g, '');
      if (digits.length >= 7) phoneNumbers.add(digits.slice(-10));
    });

    formCount += (html.match(/<form\b/gi) ?? []).length;

    if (!platform) {
      for (const [name, pattern] of PLATFORM_PATTERNS) {
        const hit = pattern.exec(html);
        if (hit) {
          platform = { vendor: name, evidence: [hit[0]] };
          break;
        }
      }
    }

    matchAll(visibleText(html), CREDIT_PATTERN, (m) => {
      const words = m[1]!.trim().split(/\s+/);
      const nameWords: string[] = [];
      for (const word of words) {
        if (!/^[A-Z]/.test(word)) break;
        nameWords.push(word);
      }
      if (nameWords.length === 0) return;

      const name = nameWords.join(' ').replace(/[.'-]+$/, '');
      const lead = m[0].slice(0, m[0].length - m[1]!.length);
      const text = clip(`${lead}${name}`.replace(/\s+/g, ' ').trim(), 120);
      const knownVendor = KNOWN_VENDORS.find((v) => name.toLowerCase().startsWith(v.toLowerCase())) ?? null;
      if (!credits.has(text.toLowerCase())) credits.set(text.toLowerCase(), { text, knownVendor });
    });
  }

  return {
    gtm: gtm.tags(),
    googleTag: googleTag.tags(),
    tagLoaderFailed,
    ga4: ga4.tags(),
    universalAnalytics: ua.tags(),
    googleAds: googleAds.tags(),
    metaPixel: metaPixel.tags(),
    ga4MaxPageViews,
    metaMaxPageViews,
    otherAdPixels: vendorMaps.otherAdPixels.vendors(),
    callTracking: vendorMaps.callTracking.vendors(),
    googleCallConversion,
    leadTools: vendorMaps.leadTools.vendors(),
    consentManagers: vendorMaps.consentManagers.vendors(),
    platform,
    vendorCredits: [...credits.values()],
    phoneNumbers: [...phoneNumbers],
    formCount,
  };
}
