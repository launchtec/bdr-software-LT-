import type { AppliesWhen } from './types';

/** Short names for finding codes, for people. Unknown codes fall back to the code itself. */
const FINDING_LABELS: Record<string, string> = {
  'analytics.none': 'No analytics',
  'analytics.ua_only': 'Still on Universal Analytics',
  'analytics.ua_leftover': 'Leftover Universal Analytics tag',
  'analytics.loader_without_ga4': 'Tag loader but no GA4',
  'analytics.multiple_ga4': 'Several GA4 properties',
  'analytics.double_pageview': 'GA4 double counting',
  'meta.double_pageview': 'Meta pixel double firing',
  'meta.multiple_pixels': 'Several Meta pixels',
  'gtm.multiple_containers': 'Several tag containers',
  'ads.no_google_ads_tag': 'No Google Ads tag',
  'ads.no_meta_pixel': 'No Meta pixel',
  'calls.no_call_tracking': 'No call tracking',
  'vendor.templated_provider': 'Templated vendor site',
};

export function findingLabel(code: string): string {
  return FINDING_LABELS[code] ?? code;
}

const APPLIES_WHEN: Record<AppliesWhen, string> = {
  runs_google_ads: 'Only matters if they run Google Ads (not yet confirmed)',
  runs_meta_ads: 'Only matters if they run Meta ads (not yet confirmed)',
  runs_any_ads: 'Only matters if they run paid ads (not yet confirmed)',
};

/** Says where a conditional finding stands now that ads may have been checked. */
export function conditionLabel(appliesWhen: unknown, state: 'usable' | 'unconfirmed' | 'not_applicable'): string | null {
  if (typeof appliesWhen !== 'string' || !(appliesWhen in APPLIES_WHEN)) return null;
  if (state === 'usable') return 'Confirmed: they are running Google ads';
  if (state === 'not_applicable') return 'Does not apply: no current Google ads found';
  return APPLIES_WHEN[appliesWhen as AppliesWhen];
}

export function appliesWhenLabel(value: unknown): string | null {
  return typeof value === 'string' && value in APPLIES_WHEN ? APPLIES_WHEN[value as AppliesWhen] : null;
}
