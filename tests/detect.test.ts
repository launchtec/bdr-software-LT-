import { describe, expect, it } from 'vitest';
import { detect, socialProfilesIn, visibleText } from '../src/audit/detect';
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
    tagScripts: [],
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

  it('recognises a Meta pixel from its config download or its library, without a page-view hit', () => {
    const withConfig = detect([
      capture({
        requests: [
          'https://connect.facebook.net/en_US/fbevents.js',
          'https://connect.facebook.net/signals/config/914212988268689?v=2.9.439&r=stable',
        ],
      }),
    ]);
    expect(withConfig.metaPixel.map((h) => h.id)).toEqual(['914212988268689']);
    expect(withConfig.metaPixelLibrary).toBe(true);

    const libraryOnly = detect([capture({ requests: ['https://connect.facebook.net/en_US/fbevents.js'] })]);
    expect(libraryOnly.metaPixel).toEqual([]);
    expect(libraryOnly.metaPixelLibrary).toBe(true);
  });

  it('reads tags configured inside a Tag Manager container even if they never fired', () => {
    const body = `var data = {"resource":{"tags":[
      {"function":"__awct","vtp_conversionId":"123456789","vtp_conversionLabel":"abc"},
      {"function":"__html","vtp_html":"\\u003Cscript\\u003Efbq(\\'init\\', \\'777888999000111\\');\\u003C/script\\u003E connect.facebook.net/en_US/fbevents.js"},
      {"function":"__html","vtp_html":"//cdn.callrail.com/companies/1/x/12/swap.js"},
      {"function":"__googtag","vtp_tagId":"AW-987654321"}]}};`;
    const d = detect([
      capture({ tagScripts: [{ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-CONF001', body }] }),
    ]);

    expect(d.googleAds.map((h) => h.id).sort()).toEqual(['AW-123456789', 'AW-987654321']);
    expect(d.googleAds[0]?.evidence).toEqual(['configured in GTM-CONF001']);
    expect(d.metaPixel.map((h) => h.id)).toEqual(['777888999000111']);
    expect(d.metaPixelLibrary).toBe(true);
    expect(d.callTracking.map((h) => h.vendor)).toEqual(['CallRail']);
  });

  it('does not mistake the Google tag library\'s own vocabulary for a configured call conversion', () => {
    const url = 'https://www.googletagmanager.com/gtm.js?id=GTM-LIB0001';
    const library = 'var k={ml:"phone_conversion_css_class",No:"phone_conversion_ids",nl:"phone_conversion_number"};';

    const plain = detect([capture({ tagScripts: [{ url, body: library }] })]);
    expect(plain.googleCallConversion).toBe(false);

    const configured = detect([capture({ tagScripts: [{ url, body: `${library}{"function":"__awcc","vtp_phoneNumber":"7205550100"}` }] })]);
    expect(configured.googleCallConversion).toBe(true);
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

  it('does not let a credit run into the neighbouring element', () => {
    const d = detect([
      capture({ html: '<footer><p>Design by <a href="#">Red Egg Marketing</a></p><h4>Considering A New Fence?</h4></footer>' }),
    ]);
    expect(d.vendorCredits).toEqual([{ text: 'Design by Red Egg Marketing', knownVendor: null }]);
  });

  it('recognises a templated vendor and its platform from the hosts a site loads', () => {
    const d = detect([
      capture({
        html: '<img src="https://lirp.cdn-website.com/abc/logo.png">',
        requests: ['https://go.thryv.com/site/widget.js', 'https://www.clickcease.com/monitor/stat.js'],
      }),
    ]);
    expect(d.marketingVendors.map((v) => v.vendor)).toEqual(['Thryv']);
    expect(d.platform?.vendor).toBe('Duda');
    expect(d.otherAdPixels.map((v) => v.vendor)).toEqual(['ClickCease (click-fraud protection)']);
  });

  it('identifies the site platform', () => {
    const d = detect([capture({ html: '<link href="https://example.com/wp-content/themes/x/style.css">' })]);
    expect(d.platform?.vendor).toBe('WordPress');
  });
});

describe('social profiles', () => {
  it('finds the profile a site links to on each network', () => {
    const html = `<footer>
      <a href="https://www.facebook.com/AcmeRoofingDenver/">Facebook</a>
      <a href="https://www.instagram.com/acme.roofing/?hl=en">Instagram</a>
      <a href="https://www.linkedin.com/company/acme-roofing">LinkedIn</a>
      <a href="https://www.youtube.com/@acmeroofing">YouTube</a>
      <a href="https://www.tiktok.com/@acmeroofing">TikTok</a>
    </footer>`;
    expect(socialProfilesIn(html)).toEqual([
      { network: 'facebook', url: 'https://www.facebook.com/AcmeRoofingDenver' },
      { network: 'instagram', url: 'https://www.instagram.com/acme.roofing' },
      { network: 'linkedin', url: 'https://www.linkedin.com/company/acme-roofing' },
      { network: 'youtube', url: 'https://www.youtube.com/@acmeroofing' },
      { network: 'tiktok', url: 'https://www.tiktok.com/@acmeroofing' },
    ]);
  });

  it('ignores share buttons, embedded posts and tracking pixels', () => {
    const html = `<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
      <img src="https://www.facebook.com/tr?id=123&ev=PageView">
      <a href="https://www.instagram.com/p/Cabc123/">A post</a>
      <a href="https://www.linkedin.com/shareArticle?url=x">Share</a>`;
    expect(socialProfilesIn(html)).toEqual([]);
  });

  it('keeps the first profile per network across pages', () => {
    const d = detect([
      capture({ html: '<a href="https://facebook.com/first.page">fb</a>' }),
      capture({ html: '<a href="https://facebook.com/second.page">fb</a><a href="https://instagram.com/acme">ig</a>' }),
    ]);
    expect(d.socialProfiles).toEqual([
      { network: 'facebook', url: 'https://facebook.com/first.page' },
      { network: 'instagram', url: 'https://instagram.com/acme' },
    ]);
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
