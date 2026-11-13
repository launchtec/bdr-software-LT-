/**
 * Visits a site in a headless browser and records what each page loads.
 *
 * The visit is read-only: it loads pages and watches the network. It never submits a
 * form, clicks a call button, or accepts a consent banner.
 */
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright';
import type { PageCapture } from './types';

const LEAD_PAGE_PATTERN = /contact|quote|estimate|schedul|book|consult|appointment/i;

export interface CollectOptions {
  /** Pages to visit, including the first. The second is the best contact or quote page linked from the first. */
  maxPages?: number;
  /** Per-page navigation timeout. */
  navigationTimeoutMs?: number;
  /** How long to keep watching after load for tags that fire late. */
  settleMs?: number;
  /** Reuse an existing browser instead of launching one. */
  browser?: Browser;
  /** Hook to adjust the context before navigation (used by tests to stub third-party hosts). */
  onContext?: (context: BrowserContext) => Promise<unknown>;
}

function proxyFromEnv(): LaunchOptions['proxy'] {
  const raw = process.env.AUDIT_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return {
      server: `${url.protocol}//${url.host}`,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      bypass: 'localhost,127.0.0.1',
    };
  } catch {
    return undefined;
  }
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    proxy: proxyFromEnv(),
  });
}

async function capturePage(context: BrowserContext, url: string, opts: Required<Pick<CollectOptions, 'navigationTimeoutMs' | 'settleMs'>>) {
  const page = await context.newPage();
  const requests: string[] = [];
  const failedRequests: string[] = [];
  page.on('request', (request) => {
    const requestUrl = request.url();
    if (requestUrl.startsWith('http')) requests.push(requestUrl);
  });
  page.on('requestfailed', (request) => {
    // Cancelled requests (navigation, beacons cut short) are normal; real failures are not.
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') failedRequests.push(request.url());
  });

  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: opts.navigationTimeoutMs });
    // Tag Manager fires most tags after load; wait for the network to go quiet, bounded.
    await page.waitForLoadState('networkidle', { timeout: opts.settleMs * 3 }).catch(() => undefined);
    await page.waitForTimeout(opts.settleMs);

    const capture: PageCapture = {
      url,
      finalUrl: page.url(),
      status: response?.status() ?? null,
      title: await page.title(),
      html: await page.content(),
      requests,
      failedRequests,
      capturedAt: new Date().toISOString(),
    };

    const links = await page.$$eval('a[href]', (anchors) =>
      anchors.map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? '').trim().slice(0, 80) })),
    );
    return { capture, links };
  } finally {
    await page.close();
  }
}

const CHALLENGE_TITLE = /just a moment|attention required|access denied|are you (?:a )?(?:human|robot)|captcha|security check/i;

/** True when the capture is the real page rather than an error or a bot challenge. */
export function pageLoaded(capture: PageCapture): boolean {
  const ok = capture.status !== null && capture.status >= 200 && capture.status < 400;
  return ok && !CHALLENGE_TITLE.test(capture.title);
}

/** Picks the same-site link most likely to be the lead-capture page. */
export function pickLeadPage(pageUrl: string, links: { href: string; text: string }[]): string | null {
  let origin: string;
  let currentPath: string;
  try {
    const current = new URL(pageUrl);
    origin = current.origin;
    currentPath = current.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }

  for (const link of links) {
    let target: URL;
    try {
      target = new URL(link.href);
    } catch {
      continue;
    }
    if (target.origin !== origin) continue;
    const path = target.pathname.replace(/\/+$/, '');
    if (path === currentPath) continue;
    if (/\.(pdf|jpe?g|png|webp|zip)$/i.test(path)) continue;
    if (LEAD_PAGE_PATTERN.test(path) || LEAD_PAGE_PATTERN.test(link.text)) {
      target.hash = '';
      return target.toString();
    }
  }
  return null;
}

/** Captures the given URL and, if one is linked, its contact or quote page. */
export async function collectSite(url: string, options: CollectOptions = {}): Promise<PageCapture[]> {
  const maxPages = options.maxPages ?? 2;
  const pageOpts = {
    navigationTimeoutMs: options.navigationTimeoutMs ?? 45_000,
    settleMs: options.settleMs ?? 3_000,
  };

  const browser = options.browser ?? (await launchBrowser());
  // The browser keeps its own user agent: a spoofed one that disagrees with the rest of
  // the browser's fingerprint gets rejected by common bot protection.
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });

  try {
    if (options.onContext) await options.onContext(context);

    const first = await capturePage(context, url, pageOpts);
    const captures = [first.capture];

    if (maxPages > 1) {
      const leadPage = pickLeadPage(first.capture.finalUrl, first.links);
      if (leadPage) {
        try {
          const second = (await capturePage(context, leadPage, pageOpts)).capture;
          if (pageLoaded(second)) captures.push(second);
        } catch {
          // The first page is enough to audit; a broken second page is not fatal.
        }
      }
    }
    return captures;
  } finally {
    await context.close();
    if (!options.browser) await browser.close();
  }
}
