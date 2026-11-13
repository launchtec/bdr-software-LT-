import { collectSite, pageLoaded, type CollectOptions } from './collect';
import { detect } from './detect';
import { deriveFindings } from './findings';
import type { PageCapture, SiteAudit } from './types';

export * from './types';
export { collectSite, launchBrowser, pageLoaded, pickLeadPage } from './collect';
export { detect } from './detect';
export { deriveFindings } from './findings';

/** Accepts `example.com` as well as a full URL. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Raised when the site could not be loaded, so nothing may be claimed about it. */
export class SiteNotAuditableError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    readonly title: string,
  ) {
    super(`${url} did not load (HTTP ${status ?? 'no response'}${title ? `, "${title}"` : ''}); nothing was audited.`);
    this.name = 'SiteNotAuditableError';
  }
}

/**
 * Builds the audit from captures already taken.
 * Throws SiteNotAuditableError if the first page is an error or a bot challenge: an
 * unloaded page looks exactly like a site with nothing installed.
 */
export function auditFromCaptures(url: string, captures: PageCapture[]): SiteAudit {
  const first = captures[0];
  if (!first || !pageLoaded(first)) {
    throw new SiteNotAuditableError(url, first?.status ?? null, first?.title ?? '');
  }

  const detections = detect(captures);
  const limitations: string[] = [];
  if (detections.tagLoaderFailed) {
    limitations.push(
      'A tag loader failed to download during the visit, so tags it injects could not be seen and "not detected" findings were withheld.',
    );
  }

  return {
    url,
    auditedAt: new Date().toISOString(),
    pages: captures.map((c) => ({
      url: c.url,
      finalUrl: c.finalUrl,
      status: c.status,
      title: c.title,
      requestCount: c.requests.length,
    })),
    detections,
    findings: deriveFindings(detections),
    limitations,
  };
}

/** Visits the site and returns what is installed plus the findings worth raising. */
export async function auditSite(input: string, options: CollectOptions = {}): Promise<SiteAudit> {
  const url = normalizeUrl(input);
  const captures = await collectSite(url, options);
  return auditFromCaptures(url, captures);
}
