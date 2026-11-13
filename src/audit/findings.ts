/**
 * Turns detections into findings we could put in front of a prospect.
 *
 * Rules of the house:
 *  - A finding states only what the visit showed. Anything inferred is marked `likely`
 *    and carries a caveat saying what an outside visit cannot see.
 *  - We never submit forms or place calls on a prospect's site, so nothing here claims
 *    that a conversion "does not fire" — only that a tag was or was not present.
 *  - "Not detected" is weaker when a consent banner is present, because tags may be
 *    waiting for consent; those findings are downgraded to `likely`.
 *  - If a tag loader failed to download during the visit, the tags it injects were
 *    invisible to us, so every "not detected" finding is withheld.
 */
import type { Detections, Finding } from './types';

const CONSENT_CAVEAT =
  'A cookie-consent tool is installed, so tags may load only after a visitor accepts; this visit did not interact with the banner.';

function ids(hits: { id: string }[]): string {
  return hits.map((h) => h.id).join(', ');
}

function evidenceOf(hits: { evidence: string[] }[]): string[] {
  return hits.flatMap((h) => h.evidence).slice(0, 6);
}

function joinCaveats(...parts: (string | null | false)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(' ') : null;
}

export function deriveFindings(d: Detections): Finding[] {
  const findings: Finding[] = [];
  const hasConsent = d.consentManagers.length > 0;
  const consentCaveat = hasConsent && CONSENT_CAVEAT;
  const hasAnalytics = d.ga4.length > 0 || d.universalAnalytics.length > 0;
  const loaders = [...d.gtm, ...d.googleTag];
  /** Whether the absence of a tag means anything. */
  const canJudgeAbsence = !d.tagLoaderFailed;

  if (!canJudgeAbsence) {
    // Fall through to the findings that rest on what was seen, not on what was missing.
  } else if (!hasAnalytics && loaders.length === 0) {
    findings.push({
      code: 'analytics.none',
      confidence: hasConsent ? 'likely' : 'observed',
      statement: 'No Google Analytics or Google Tag Manager was detected on the site.',
      caveat: joinCaveats(consentCaveat, 'Another analytics product may be in use.'),
      evidence: [],
    });
  } else if (d.ga4.length === 0 && d.universalAnalytics.length > 0) {
    findings.push({
      code: 'analytics.ua_only',
      confidence: hasConsent ? 'likely' : 'observed',
      statement: `The site still carries a Universal Analytics tag (${ids(d.universalAnalytics)}), which stopped processing data on July 1, 2023, and no GA4 tag was detected.`,
      caveat: joinCaveats(consentCaveat),
      evidence: evidenceOf(d.universalAnalytics),
    });
  } else if (d.ga4.length === 0 && loaders.length > 0) {
    findings.push({
      code: 'analytics.loader_without_ga4',
      confidence: 'likely',
      statement: `${d.gtm.length > 0 ? 'Google Tag Manager' : 'A Google tag'} is installed (${ids(loaders)}) but no GA4 hit was seen during the visit.`,
      caveat: joinCaveats(consentCaveat, 'Tags may be set to fire only on specific pages or events.'),
      evidence: evidenceOf(loaders),
    });
  }

  if (d.ga4.length > 0 && d.universalAnalytics.length > 0) {
    findings.push({
      code: 'analytics.ua_leftover',
      confidence: 'observed',
      statement: `A retired Universal Analytics tag (${ids(d.universalAnalytics)}) is still on the site alongside GA4.`,
      caveat: null,
      evidence: evidenceOf(d.universalAnalytics),
    });
  }

  if (d.ga4.length > 1) {
    findings.push({
      code: 'analytics.multiple_ga4',
      confidence: 'observed',
      statement: `${d.ga4.length} separate GA4 properties are collecting data from the site (${ids(d.ga4)}).`,
      caveat: 'A second property can be intentional, for example an agency roll-up; several often means leftovers from previous vendors.',
      evidence: evidenceOf(d.ga4),
    });
  }

  for (const [id, count] of Object.entries(d.ga4MaxPageViews)) {
    if (count < 2) continue;
    findings.push({
      code: 'analytics.double_pageview',
      confidence: 'likely',
      statement: `GA4 property ${id} received ${count} page_view hits on a single page load, which usually means the tag is installed twice and traffic is being double counted.`,
      caveat: 'Single-page apps can legitimately send more than one page_view; this was one visit.',
      evidence: d.ga4.find((h) => h.id === id)?.evidence ?? [],
    });
  }

  for (const [id, count] of Object.entries(d.metaMaxPageViews)) {
    if (count < 2) continue;
    findings.push({
      code: 'meta.double_pageview',
      confidence: 'likely',
      statement: `Meta pixel ${id} fired PageView ${count} times on a single page load, which usually means the pixel is installed twice.`,
      caveat: 'This was one visit; some setups fire a second PageView on purpose.',
      evidence: d.metaPixel.find((h) => h.id === id)?.evidence ?? [],
    });
  }

  if (d.metaPixel.length > 1) {
    findings.push({
      code: 'meta.multiple_pixels',
      confidence: 'observed',
      statement: `${d.metaPixel.length} different Meta pixels are on the site (${ids(d.metaPixel)}).`,
      caveat: 'More than one pixel can be intentional, for example when an agency runs its own.',
      evidence: evidenceOf(d.metaPixel),
    });
  }

  if (d.gtm.length > 1) {
    findings.push({
      code: 'gtm.multiple_containers',
      confidence: 'observed',
      statement: `${d.gtm.length} Google tag containers are loading on the site (${ids(d.gtm)}).`,
      caveat: 'Multiple containers can be intentional, but they often mean leftover setups from previous vendors.',
      evidence: evidenceOf(d.gtm),
    });
  }

  if (canJudgeAbsence && d.googleAds.length === 0) {
    findings.push({
      code: 'ads.no_google_ads_tag',
      confidence: 'likely',
      appliesWhen: 'runs_google_ads',
      statement: 'No Google Ads tag was detected on the site or configured in its tag containers.',
      caveat: joinCaveats(
        consentCaveat,
        'Conversions can also reach Google Ads through a GA4 import or offline uploads, which a site visit cannot see.',
      ),
      evidence: [],
    });
  }

  if (canJudgeAbsence && d.metaPixel.length === 0 && !d.metaPixelLibrary) {
    findings.push({
      code: 'ads.no_meta_pixel',
      confidence: 'likely',
      appliesWhen: 'runs_meta_ads',
      statement: 'No Meta pixel was detected on the site or configured in its tag containers.',
      caveat: joinCaveats(consentCaveat, 'Events can also be sent server-side through the Conversions API, which a site visit cannot see.'),
      evidence: [],
    });
  }

  if (canJudgeAbsence && d.phoneNumbers.length > 0 && d.callTracking.length === 0 && !d.googleCallConversion) {
    findings.push({
      code: 'calls.no_call_tracking',
      confidence: 'likely',
      appliesWhen: 'runs_any_ads',
      statement:
        'The site shows a click-to-call phone number but no call-tracking script was detected, so phone leads likely cannot be tied back to the campaign that produced them.',
      caveat: joinCaveats(
        consentCaveat,
        'Call extensions inside the ads themselves, or a tracking vendor we do not recognize, would not show up here.',
      ),
      evidence: d.phoneNumbers.slice(0, 3).map((n) => `tel:${n}`),
    });
  }

  const vendorCredit = d.vendorCredits.find((c) => c.knownVendor);
  const hostVendor = d.marketingVendors[0];
  if (hostVendor) {
    findings.push({
      code: 'vendor.templated_provider',
      confidence: 'observed',
      statement: `The site runs on ${hostVendor.vendor}'s platform.`,
      caveat: null,
      evidence: hostVendor.evidence,
    });
  } else if (vendorCredit) {
    findings.push({
      code: 'vendor.templated_provider',
      confidence: 'observed',
      statement: `The site credits ${vendorCredit.knownVendor} ("${vendorCredit.text}").`,
      caveat: null,
      evidence: [vendorCredit.text],
    });
  }

  return findings;
}
