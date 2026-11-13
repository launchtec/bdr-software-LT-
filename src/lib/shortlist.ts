import { stackMaturity } from '@/audit/maturity';
import { findingState, isConditional, type Prospect } from './queries';

/** Above this many listed ads a company is treated as a large or multi-location advertiser. */
export const LARGE_ADVERTISER_ADS = 100;

/**
 * The shortlist is the set worth a person's research time: companies that are paying
 * for Google ads right now, have a measurable gap in tracking them, and do not look
 * like they already have an agency-grade setup or a large ad operation.
 *
 * It is a starting rule, meant to be tuned against the fit verdicts people record.
 */
export function shortlistReason(prospect: Prospect): { shortlisted: boolean; reason: string } {
  const { company, audit, googleAds, signals } = prospect;

  if (company.fitVerdict && company.fitVerdict !== 'good_fit') return { shortlisted: false, reason: 'Marked as not a fit' };
  if (!googleAds) return { shortlisted: false, reason: 'Ads not checked' };
  if (googleAds.status !== 'active') return { shortlisted: false, reason: 'Not running Google ads now' };
  if (audit?.status !== 'ok' || !audit.detections) return { shortlisted: false, reason: 'Site could not be audited' };
  if (googleAds.adCount >= LARGE_ADVERTISER_ADS) return { shortlisted: false, reason: 'Large ad operation' };
  if (stackMaturity(audit.detections) === 'built_out') return { shortlisted: false, reason: 'Setup already built out' };

  const gaps = signals.filter((s) => isConditional(s) && findingState(s, googleAds) === 'usable');
  if (gaps.length === 0) return { shortlisted: false, reason: 'No confirmed gap in ad tracking' };
  return { shortlisted: true, reason: 'Running Google ads with a tracking gap' };
}
