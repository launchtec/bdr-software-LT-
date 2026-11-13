import type { Detections } from './types';

/**
 * How built-out a site's marketing setup is. A rough proxy for whether someone is
 * already managing it: a built-out setup usually means an agency is in place (and the
 * company is pitched constantly); a bare one often means it does not advertise at all.
 */
export type StackMaturity = 'built_out' | 'partial' | 'bare';

export function stackMaturity(d: Detections): StackMaturity {
  const analytics = d.ga4.length > 0;
  const adTools = [
    d.googleAds.length > 0,
    d.metaPixel.length > 0 || d.metaPixelLibrary,
    d.callTracking.length > 0 || d.googleCallConversion,
  ].filter(Boolean).length;

  if (analytics && adTools >= 2) return 'built_out';
  if (!analytics && adTools === 0 && d.gtm.length + d.googleTag.length === 0) return 'bare';
  return 'partial';
}

export const MATURITY_LABELS: Record<StackMaturity, { label: string; meaning: string }> = {
  built_out: { label: 'Built out', meaning: 'Analytics plus at least two of Google Ads, Meta pixel and call tracking. Probably has an agency already.' },
  partial: { label: 'Partial', meaning: 'Some tracking in place, with gaps.' },
  bare: { label: 'Bare', meaning: 'No analytics or ad tracking on the site.' },
};
