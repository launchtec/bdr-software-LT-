import { describe, expect, it } from 'vitest';
import { detect } from '../src/audit/detect';
import { deriveFindings } from '../src/audit/findings';
import type { Detections, PageCapture } from '../src/audit/types';

function detections(html: string, requests: string[] = [], failedRequests: string[] = []): Detections {
  const capture: PageCapture = {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    title: 'Example',
    html,
    requests,
    failedRequests,
    tagScripts: [],
    capturedAt: '2026-01-01T00:00:00.000Z',
  };
  return detect([capture]);
}

const codes = (d: Detections) => deriveFindings(d).map((f) => f.code);
const find = (d: Detections, code: string) => deriveFindings(d).find((f) => f.code === code);

const GA4 = 'https://www.google-analytics.com/g/collect?tid=G-GOOD000001&en=page_view';
const ADS = 'https://www.googletagmanager.com/gtag/js?id=AW-123456789';
const PIXEL = 'https://www.facebook.com/tr/?id=222222222222&ev=PageView';

describe('deriveFindings', () => {
  it('raises nothing structural for a healthy setup', () => {
    const d = detections('<a href="tel:7205550100">Call</a>', [
      'https://www.googletagmanager.com/gtm.js?id=GTM-GOOD001',
      GA4,
      ADS,
      PIXEL,
      'https://cdn.callrail.com/companies/1/a/12/swap.js',
    ]);
    expect(codes(d)).toEqual([]);
  });

  it('reports a site with no analytics as observed, with the ad-platform checks scoped', () => {
    const findings = deriveFindings(detections('<p>Hello</p>'));
    expect(findings.map((f) => f.code)).toEqual(['analytics.none', 'ads.no_google_ads_tag', 'ads.no_meta_pixel']);
    expect(findings[0]?.confidence).toBe('observed');
    expect(findings[1]).toMatchObject({ confidence: 'likely', appliesWhen: 'runs_google_ads' });
    expect(findings[2]).toMatchObject({ confidence: 'likely', appliesWhen: 'runs_meta_ads' });
    expect(findings.every((f) => f.caveat)).toBe(true);
  });

  it('downgrades "not detected" findings when a consent banner is present', () => {
    const d = detections('<p>Hello</p>', ['https://cdn.cookielaw.org/scripttemplates/otSDKStub.js']);
    const none = find(d, 'analytics.none');
    expect(none?.confidence).toBe('likely');
    expect(none?.caveat).toContain('cookie-consent');
  });

  it('flags a site still on Universal Analytics with its evidence', () => {
    const d = detections(`<script>ga('create', 'UA-7654321-2', 'auto');</script>`, [ADS, PIXEL]);
    const f = find(d, 'analytics.ua_only');
    expect(f?.confidence).toBe('observed');
    expect(f?.statement).toContain('UA-7654321-2');
    expect(f?.evidence.length).toBeGreaterThan(0);
    expect(codes(d)).not.toContain('analytics.none');
  });

  it('flags a leftover Universal Analytics tag next to GA4', () => {
    const d = detections(`<script>ga('create', 'UA-7654321-2', 'auto');</script>`, [GA4, ADS, PIXEL]);
    expect(codes(d)).toEqual(['analytics.ua_leftover']);
  });

  it('flags a loader with no GA4 hit as likely, not observed', () => {
    const gtm = detections('', ['https://www.googletagmanager.com/gtm.js?id=GTM-EMPTY01', ADS, PIXEL]);
    expect(find(gtm, 'analytics.loader_without_ga4')).toMatchObject({ confidence: 'likely' });
    expect(find(gtm, 'analytics.loader_without_ga4')?.statement).toContain('Google Tag Manager is installed (GTM-EMPTY01)');

    const googleTag = detections('', ['https://www.googletagmanager.com/gtag/js?id=GT-ONLY0001', ADS, PIXEL]);
    expect(find(googleTag, 'analytics.loader_without_ga4')?.statement).toContain('A Google tag is installed (GT-ONLY0001)');
    expect(codes(googleTag)).not.toContain('analytics.none');
  });

  it('withholds every "not detected" finding when a tag loader failed to download', () => {
    const loader = 'https://www.googletagmanager.com/gtm.js?id=GTM-BLOCKED1';
    const d = detections(
      `<a href="tel:7205550100">Call</a><script>ga('create', 'UA-7654321-2', 'auto');</script><footer>Website by Thryv</footer>`,
      [loader],
      [loader],
    );
    expect(d.tagLoaderFailed).toBe(true);
    // Only the finding that rests on something seen survives.
    expect(codes(d)).toEqual(['vendor.templated_provider']);
  });

  it('ignores failed requests that are not tag loaders', () => {
    const d = detections('<p>Hello</p>', [], ['https://fonts.example.com/font.woff2']);
    expect(d.tagLoaderFailed).toBe(false);
    expect(codes(d)).toContain('analytics.none');
  });

  it('flags double counting in GA4 and Meta', () => {
    const d = detections('', [GA4, `${GA4}&dup=1`, ADS, PIXEL, `${PIXEL}&dup=1`]);
    expect(codes(d)).toEqual(['analytics.double_pageview', 'meta.double_pageview']);
    expect(find(d, 'analytics.double_pageview')?.statement).toContain('2 page_view hits');
  });

  it('flags multiple pixels and containers', () => {
    const d = detections('', [
      'https://www.googletagmanager.com/gtm.js?id=GTM-ONE0001',
      'https://www.googletagmanager.com/gtm.js?id=GTM-TWO0002',
      GA4,
      ADS,
      PIXEL,
      'https://www.facebook.com/tr/?id=333333333333&ev=PageView',
    ]);
    expect(codes(d)).toEqual(['meta.multiple_pixels', 'gtm.multiple_containers']);
  });

  it('flags a click-to-call number with no call tracking, unless Google call conversion is set', () => {
    const untracked = detections('<a href="tel:7205550100">Call</a>', [GA4, ADS, PIXEL]);
    expect(find(untracked, 'calls.no_call_tracking')).toMatchObject({
      confidence: 'likely',
      appliesWhen: 'runs_any_ads',
      evidence: ['tel:7205550100'],
    });

    const tracked = detections(
      `<a href="tel:7205550100">Call</a><script>gtag('config', 'AW-1/x', { phone_conversion_number: '720-555-0100' });</script>`,
      [GA4, ADS, PIXEL],
    );
    expect(codes(tracked)).not.toContain('calls.no_call_tracking');
  });

  it('does not report a missing Meta pixel when the pixel library loaded', () => {
    const d = detections('', [GA4, ADS, 'https://connect.facebook.net/en_US/fbevents.js']);
    expect(codes(d)).not.toContain('ads.no_meta_pixel');
  });

  it('reports several GA4 properties as an observed fact with a caveat', () => {
    const d = detections('', [GA4, 'https://www.google-analytics.com/g/collect?tid=G-OTHER00002&en=page_view', ADS, PIXEL]);
    const f = find(d, 'analytics.multiple_ga4');
    expect(f).toMatchObject({ confidence: 'observed' });
    expect(f?.statement).toContain('2 separate GA4 properties');
    expect(f?.caveat).toBeTruthy();
  });

  it('reports a templated vendor recognised from the hosts the site loads', () => {
    const d = detections('', [GA4, ADS, PIXEL, 'https://cdn.website.thryv.com/x.js']);
    const f = find(d, 'vendor.templated_provider');
    expect(f?.statement).toBe("The site runs on Thryv's platform.");
    expect(f?.evidence).toEqual(['https://cdn.website.thryv.com/x.js']);
  });

  it('reports a known templated vendor credit', () => {
    const d = detections('<footer>Website by Hibu</footer>', [GA4, ADS, PIXEL]);
    expect(find(d, 'vendor.templated_provider')?.statement).toContain('Hibu');
  });
});
