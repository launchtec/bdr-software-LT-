/**
 * Audit one site from the command line.
 *
 *   npm run audit -- example.com          human-readable summary
 *   npm run audit -- example.com --json   full audit as JSON
 */
import { auditSite, type SiteAudit, type TagHit, type VendorHit } from '../audit';

function list(label: string, values: string[]): string {
  return `  ${label.padEnd(22)}${values.length ? values.join(', ') : '—'}`;
}

const tagIds = (hits: TagHit[]) => hits.map((h) => h.id);
const vendorNames = (hits: VendorHit[]) => hits.map((h) => h.vendor);

function render(audit: SiteAudit): string {
  const d = audit.detections;
  const lines: string[] = [];

  lines.push(`Audit of ${audit.url}`);
  for (const page of audit.pages) {
    lines.push(`  page: ${page.finalUrl} (HTTP ${page.status ?? '?'}, ${page.requestCount} requests)`);
  }

  lines.push('', 'Installed');
  lines.push(list('Tag Manager', tagIds(d.gtm)));
  lines.push(list('Google tag', tagIds(d.googleTag)));
  lines.push(list('GA4', tagIds(d.ga4)));
  lines.push(list('Universal Analytics', tagIds(d.universalAnalytics)));
  lines.push(list('Google Ads', tagIds(d.googleAds)));
  lines.push(list('Meta pixel', tagIds(d.metaPixel)));
  lines.push(list('Other ad pixels', vendorNames(d.otherAdPixels)));
  lines.push(list('Call tracking', [...vendorNames(d.callTracking), ...(d.googleCallConversion ? ['Google call conversion'] : [])]));
  lines.push(list('Lead tools', vendorNames(d.leadTools)));
  lines.push(list('Consent manager', vendorNames(d.consentManagers)));
  lines.push(list('Platform', d.platform ? [d.platform.vendor] : []));
  lines.push(list('Site credits', d.vendorCredits.map((c) => c.text)));
  lines.push(list('Phone numbers', d.phoneNumbers));
  lines.push(list('Forms', [String(d.formCount)]));

  if (audit.limitations.length) {
    lines.push('', 'Limitations');
    for (const note of audit.limitations) lines.push(`  ${note}`);
  }

  lines.push('', `Findings (${audit.findings.length})`);
  for (const f of audit.findings) {
    const scope = f.appliesWhen ? `, only if ${f.appliesWhen.replace(/_/g, ' ')}` : '';
    lines.push(`  [${f.confidence}${scope}] ${f.code}`);
    lines.push(`    ${f.statement}`);
    if (f.caveat) lines.push(`    Caveat: ${f.caveat}`);
    for (const e of f.evidence) lines.push(`    Evidence: ${e}`);
  }
  return lines.join('\n');
}

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Usage: npm run audit -- <url> [--json]');
  process.exit(1);
}

try {
  const audit = await auditSite(target);
  console.log(args.includes('--json') ? JSON.stringify(audit, null, 2) : render(audit));
} catch (error) {
  console.error(`Audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
