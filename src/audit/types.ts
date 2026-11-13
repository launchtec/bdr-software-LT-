/** What the browser saw on one page. Detection works from this alone, so it can be tested without a browser. */
export interface PageCapture {
  /** URL we asked for. */
  url: string;
  /** URL after redirects. */
  finalUrl: string;
  status: number | null;
  title: string;
  /** Serialized DOM after scripts ran. */
  html: string;
  /** Every URL the page tried to request, in order, including ones that failed. */
  requests: string[];
  /** Requests that failed at the network level (cancelled requests excluded). */
  failedRequests: string[];
  capturedAt: string;
}

/** A tag identified by its account or container id. */
export interface TagHit {
  id: string;
  /** Request URLs or HTML snippets that prove it, capped to a few entries. */
  evidence: string[];
}

/** A third-party tool identified by vendor name. */
export interface VendorHit {
  vendor: string;
  evidence: string[];
}

export interface Detections {
  gtm: TagHit[];
  /** Google tag ids (GT-…): the gtag library is installed; its destinations show up as GA4 or Ads hits. */
  googleTag: TagHit[];
  /**
   * True when a tag loader (Tag Manager, gtag, Meta pixel library) failed to download
   * during the visit. Tags it would have injected are then invisible, so nothing can be
   * concluded from their absence.
   */
  tagLoaderFailed: boolean;
  ga4: TagHit[];
  /** Legacy Universal Analytics properties (UA-…), which stopped processing data on July 1, 2023. */
  universalAnalytics: TagHit[];
  googleAds: TagHit[];
  metaPixel: TagHit[];
  /** Most GA4 page_view hits seen for one property on a single page load. */
  ga4MaxPageViews: Record<string, number>;
  /** Most Meta PageView hits seen for one pixel on a single page load. */
  metaMaxPageViews: Record<string, number>;
  otherAdPixels: VendorHit[];
  callTracking: VendorHit[];
  /** Google's own website call conversion (a forwarding number set through gtag). */
  googleCallConversion: boolean;
  /** Schedulers, chat, CRM forms and field-service booking widgets. */
  leadTools: VendorHit[];
  consentManagers: VendorHit[];
  platform: VendorHit | null;
  /** Large templated marketing vendors recognised from the hosts the site loads. */
  marketingVendors: VendorHit[];
  /** "Website by …" style credits found in the page text. */
  vendorCredits: { text: string; knownVendor: string | null }[];
  phoneNumbers: string[];
  formCount: number;
}

export type Confidence = 'observed' | 'likely';

/** Condition, known only from other sources, under which a finding matters. */
export type AppliesWhen = 'runs_google_ads' | 'runs_meta_ads' | 'runs_any_ads';

export interface Finding {
  /** Stable machine code, e.g. `analytics.ua_only`. */
  code: string;
  confidence: Confidence;
  /** Set when the finding is only relevant if the company advertises on that platform. */
  appliesWhen?: AppliesWhen;
  /** Plain-language sentence that is safe to say to the prospect. */
  statement: string;
  /** What this check cannot see. */
  caveat: string | null;
  evidence: string[];
}

export interface SiteAudit {
  url: string;
  auditedAt: string;
  pages: { url: string; finalUrl: string; status: number | null; title: string; requestCount: number }[];
  detections: Detections;
  findings: Finding[];
  /** Reasons this audit is less complete than usual. */
  limitations: string[];
}
