import { describe, expect, it } from 'vitest';
import { detect, visibleText } from '../src/audit/detect';
import { pickLeadPage } from '../src/audit/collect';
import type { PageCapture } from '../src/audit/types';

function capture(partial: Partial<PageCapture>): PageCapture {
  return {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    title: 'Example',
    html: '<html><body></body></html>',
    requests: [],
    failedRequests: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('detect', () => {
  it('reads tag ids from network requests', () => {
    const d = detect([
      capture({
        requests: [
          'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234',
          'https://www.googletagmanager.com/gtag/js?id=G-TESTID0001&l=dataLayer',
          'https://www.google-analytics.com/g/collect?v=2&tid=G-TESTID0001&en=page_view',
          'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/987654321/?random=1',
          'https://www.facebook.com/tr/?id=123456789012345&ev=PageView',
          'https://bat.bing.com/bat.js',
          'https://cdn.callrail.com/companies/1/abc/12/swap.js',
          'https://assets.calendly.com/assets/external/widget.js',
          'not a url',
        ],
      }),
    ]);

    expect(d.gtm.map((h) => h.id)).toEqual(['GTM-ABC1234']);
    expect(d.ga4.map((h) => h.id)).toEqual(['G-TESTID0001']);
    expect(d.googleAds.map((h) => h.id)).toEqual(['AW-987654321']);
    expect(d.metaPixel.map((h) => h.id)).toEqual(['123456789012345']);
    expect(d.otherAdPixels.map((h) => h.vendor)).toEqual(['Microsoft Ads (UET)']);
    expect(d.callTracking.map((h) => h.vendor)).toEqual(['CallRail']);
    expect(d.leadTools.map((h) => h.vendor)).toEqual(['Calendly']);
    expect(d.ga4[0]?.evidence[0]).toContain('gtag/js?id=G-TESTID0001');
  });

  it('recognises a server-side Tag Manager loader on the site\'s own domain', () => {
    const d = detect([capture({ requests: ['https://metrics.example.com/gtm.js?id=GTM-SELF001'] })]);
    expect(d.gtm.map((h) => h.id)).toEqual(['GTM-SELF001']);
  });

  it('treats a Google tag (GT-) as a loader, not as Tag Manager or GA4', () => {
    const d = detect([capture({ requests: ['https://www.googletagmanager.com/gtag/js?id=GT-ABCD1234'] })]);
    expect(d.googleTag.map((h) => h.id)).toEqual(['GT-ABCD1234']);
    expect(d.gtm).toEqual([]);
    expect(d.ga4).toEqual([]);
  });

  it('falls back to tags written in the HTML', () => {
    const d = detect([
      capture({
        html: `<html><head>
          <script async src="https://www.googletagmanager.com/gtag/js?id=G-HTMLONLY01"></script>
          <script>gtag('config', 'G-HTMLONLY01'); gtag('config', 'AW-111222333');
            ga('create', 'UA-1234567-1', 'auto'); fbq('init', '555666777888999');
            gtag('config', 'AW-111222333/abc', { phone_conversion_number: '720-555-0100' });</script>
          </head><body><form></form><form></form></body></html>`,
      }),
    ]);

    expect(d.ga4.map((h) => h.id)).toEqual(['G-HTMLONLY01']);
    expect(d.googleAds.map((h) => h.id)).toEqual(['AW-111222333']);
    expect(d.universalAnalytics.map((h) => h.id)).toEqual(['UA-1234567-1']);
    expect(d.metaPixel.map((h) => h.id)).toEqual(['555666777888999']);
    expect(d.googleCallConversion).toBe(true);
    expect(d.formCount).toBe(2);
  });

  it('does not treat stray G- or UA- strings as tags', () => {
    const d = detect([capture({ html: '<p>Model G-SERIES9000 ships with UA-900 firmware. AW-2024 award.</p>' })]);
    expect(d.ga4).toEqual([]);
    expect(d.universalAnalytics).toEqual([]);
    expect(d.googleAds).toEqual([]);
  });

  it('counts page views per page load, not across pages', () => {
    const hit = 'https://www.google-analytics.com/g/collect?tid=G-DOUBLE0001&en=page_view';
    const pixel = 'https://www.facebook.com/tr/?id=111111111111&ev=PageView';
    const twoPages = detect([capture({ requests: [hit, pixel] }), capture({ requests: [hit, pixel] })]);
    expect(twoPages.ga4MaxPageViews).toEqual({ 'G-DOUBLE0001': 1 });
    expect(twoPages.metaMaxPageViews).toEqual({ '111111111111': 1 });

    const doubled = detect([capture({ requests: [hit, `${hit}&_s=2`, pixel, `${pixel}&x=1`] })]);
    expect(doubled.ga4MaxPageViews).toEqual({ 'G-DOUBLE0001': 2 });
    expect(doubled.metaMaxPageViews).toEqual({ '111111111111': 2 });
  });

  it('dedupes phone numbers written in different formats', () => {
    const d = detect([
      capture({ html: '<a href="tel:(720) 555-0100">Call</a><a href="tel:+17205550100">Call</a><a href="tel:123">x</a>' }),
    ]);
    expect(d.phoneNumbers).toEqual(['7205550100']);
  });

  it('finds site credits and flags known templated vendors', () => {
    const d = detect([
      capture({ html: '<footer><p>© 2026 Acme Roofing. Website by Scorpion</p><script>var x = "designed by Nobody";</script></footer>' }),
      capture({ html: '<footer>Web Design by Tiny Local Studio | Privacy</footer>' }),
    ]);
    expect(d.vendorCredits).toEqual([
      { text: 'Website by Scorpion', knownVendor: 'Scorpion' },
      { text: 'Web Design by Tiny Local Studio', knownVendor: null },
    ]);
  });

  it('identifies the site platform', () => {
    const d = detect([capture({ html: '<link href="https://example.com/wp-content/themes/x/style.css">' })]);
    expect(d.platform?.vendor).toBe('WordPress');
  });
});

describe('visibleText', () => {
  it('drops scripts, styles and tags', () => {
    expect(visibleText('<style>a{}</style><p>Hello&nbsp;<b>there</b></p><script>var hidden = 1;</script>')).toBe('Hello there');
  });
});

describe('pickLeadPage', () => {
  const links = [
    { href: 'https://example.com/', text: 'Home' },
    { href: 'https://other.com/contact', text: 'Partner contact' },
    { href: 'https://example.com/brochure-contact.pdf', text: 'Brochure' },
    { href: 'https://example.com/about', text: 'About' },
    { href: 'https://example.com/get-started#form', text: 'Free Estimate' },
    { href: 'https://example.com/contact', text: 'Contact' },
  ];

  it('picks the first same-site lead page by path or link text', () => {
    expect(pickLeadPage('https://example.com/', links)).toBe('https://example.com/get-started');
  });

  it('skips the page we are already on and returns null when nothing fits', () => {
    expect(pickLeadPage('https://example.com/contact/', [{ href: 'https://example.com/contact', text: 'Contact' }])).toBeNull();
    expect(pickLeadPage('not a url', links)).toBeNull();
  });
});
