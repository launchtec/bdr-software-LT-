import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext } from 'playwright';
import { auditFromCaptures, auditSite, launchBrowser, SiteNotAuditableError } from '../src/audit';

/**
 * A fake business site served locally. Third-party hosts are stubbed in the browser, so
 * the test exercises the real collector (runtime-injected tags included) with no network.
 */
const HOME = `<!doctype html><html><head><title>Acme Roofing</title>
  <script async src="https://www.googletagmanager.com/gtm.js?id=GTM-FAKE001"></script>
  </head><body>
  <a href="tel:(720) 555-0100">Call us</a>
  <a href="/about">About</a>
  <a href="/free-estimate">Free Estimate</a>
  <footer>© Acme Roofing. Website by Hibu</footer>
  </body></html>`;

const ESTIMATE = `<!doctype html><html><head><title>Free Estimate</title>
  <script async src="https://www.googletagmanager.com/gtm.js?id=GTM-FAKE001"></script>
  </head><body><form><input name="email"><button>Send</button></form></body></html>`;

/** A site whose speed plugin holds Tag Manager back until the visitor first moves the mouse. */
const DELAYED = `<!doctype html><html><head><title>Lazy Fence Co</title><script>
  window.addEventListener('mousemove', function () {
    var s = document.createElement('script');
    s.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-LAZY001';
    document.head.appendChild(s);
  }, { once: true });
  </script></head><body style="height:3000px">Fences</body></html>`;

/** Stands in for a Tag Manager container that fires GA4 twice and one Meta pixel. */
const FAKE_GTM = `
  fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-FAKEGA4001&en=page_view', { mode: 'no-cors' });
  fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-FAKEGA4001&en=page_view&_s=2', { mode: 'no-cors' });
  fetch('https://www.facebook.com/tr/?id=444444444444&ev=PageView', { mode: 'no-cors' });
`;

async function stubThirdParties(context: BrowserContext) {
  await context.route(/^https:\/\//, (route) => {
    const url = route.request().url();
    if (url.includes('/gtm.js')) return route.fulfill({ contentType: 'application/javascript', body: FAKE_GTM });
    return route.fulfill({ status: 204, body: '' });
  });
}

let server: Server;
let browser: Browser;
let base: string;
const submissions: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method !== 'GET') submissions.push(`${req.method} ${req.url}`);
    if (req.url === '/down/') {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html><head><title>502 Bad Gateway</title></head><body></body></html>');
      return;
    }
    const body = req.url === '/' ? HOME : req.url === '/free-estimate' ? ESTIMATE : req.url === '/delayed/' ? DELAYED : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body ?? 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

describe('auditSite (real browser, local site)', () => {
  it('captures runtime-injected tags, follows the lead page, and derives findings', async () => {
    const audit = await auditSite(`${base}/`, { browser, settleMs: 500, onContext: stubThirdParties });
    const d = audit.detections;

    expect(audit.pages.map((p) => new URL(p.finalUrl).pathname)).toEqual(['/', '/free-estimate']);
    expect(audit.pages.every((p) => p.status === 200)).toBe(true);

    expect(d.gtm.map((h) => h.id)).toEqual(['GTM-FAKE001']);
    expect(d.ga4.map((h) => h.id)).toEqual(['G-FAKEGA4001']);
    expect(d.metaPixel.map((h) => h.id)).toEqual(['444444444444']);
    expect(d.ga4MaxPageViews).toEqual({ 'G-FAKEGA4001': 2 });
    expect(d.phoneNumbers).toEqual(['7205550100']);
    expect(d.formCount).toBe(1);

    expect(audit.findings.map((f) => f.code).sort()).toEqual(
      ['ads.no_google_ads_tag', 'analytics.double_pageview', 'calls.no_call_tracking', 'vendor.templated_provider'].sort(),
    );
  });

  it('sees tags that a speed plugin delays until the visitor moves the mouse', async () => {
    const audit = await auditSite(`${base}/delayed/`, { browser, settleMs: 300, onContext: stubThirdParties });
    expect(audit.detections.gtm.map((h) => h.id)).toEqual(['GTM-LAZY001']);
    expect(audit.detections.ga4.map((h) => h.id)).toEqual(['G-FAKEGA4001']);
    expect(audit.findings.map((f) => f.code)).not.toContain('analytics.none');
  });

  it('refuses to audit a page that did not load instead of reporting it as empty', async () => {
    await expect(auditSite(`${base}/down/`, { browser, settleMs: 100 })).rejects.toBeInstanceOf(SiteNotAuditableError);
  });

  it('refuses a bot-challenge page even when it answers 200', () => {
    const challenge = {
      url: 'https://example.com/',
      finalUrl: 'https://example.com/',
      status: 200,
      title: 'Just a moment...',
      html: '<html></html>',
      requests: [],
      failedRequests: [],
      capturedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(() => auditFromCaptures('https://example.com/', [challenge])).toThrow(SiteNotAuditableError);
  });

  it('withholds absence findings when the tag loader cannot be downloaded', async () => {
    const audit = await auditSite(`${base}/`, {
      browser,
      settleMs: 300,
      maxPages: 1,
      onContext: (context) => context.route(/^https:\/\//, (route) => route.abort('connectionrefused')),
    });
    expect(audit.detections.tagLoaderFailed).toBe(true);
    expect(audit.limitations).toHaveLength(1);
    expect(audit.findings.map((f) => f.code)).toEqual(['vendor.templated_provider']);
  });

  it('never submits anything to the site', () => {
    expect(submissions).toEqual([]);
  });
});
