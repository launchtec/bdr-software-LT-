/**
 * Check whether companies run Google ads, from Google's public Ads Transparency Center.
 *
 *   npm run adcheck -- example.com
 *   npm run adcheck -- --list sites.txt --out audit-output/ads.jsonl
 *   npm run adcheck -- --list sites.txt --push https://your-app.example.com
 *
 * With --push, results are sent to the web app's ingest API, authenticated with the
 * INGEST_TOKEN environment variable. Behind an HTTP proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkGoogleAds, type GoogleAdsCheck } from '../adcheck/google';
import { launchBrowser } from '../audit/collect';
import { normalizeDomain } from '../db/suppression';

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function describe(check: GoogleAdsCheck): string {
  const who = check.advertisers.map((a) => (a.thirdParty ? `${a.name} [third-party programme]` : a.name)).join(', ');
  if (check.status === 'none') return who ? `no ads of its own (only: ${who})` : 'no Google ads listed';
  return `${check.status}: ${check.adCount} ads, last shown ${check.lastShown ?? 'unknown'}, first ${check.firstShown ?? 'unknown'} (${who})`;
}

const args = process.argv.slice(2);
const listPath = option(args, '--list');
const outPath = option(args, '--out');
const pushTo = option(args, '--push');
const single = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

const inputs = listPath
  ? (await readFile(listPath, 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : single
    ? [single]
    : [];
if (inputs.length === 0) {
  console.error('Usage: npm run adcheck -- <domain> | --list <file> [--out file.jsonl] [--push <app url>]');
  process.exit(1);
}
const domains = [...new Set(inputs.map(normalizeDomain))];

if (outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, '');
}

const browser = await launchBrowser();
const checks: GoogleAdsCheck[] = [];
const failures: string[] = [];
try {
  // One at a time, with a pause: this is a public site, not an API.
  for (const [index, domain] of domains.entries()) {
    try {
      const check = await checkGoogleAds(domain, { browser });
      checks.push(check);
      // Saved as each check finishes, so an interrupted run keeps what it has.
      if (outPath) await appendFile(outPath, JSON.stringify(check) + '\n');
      console.log(`[${index + 1}/${domains.length}] ${domain}: ${describe(check)}`);
    } catch (error) {
      failures.push(domain);
      console.log(`[${index + 1}/${domains.length}] ${domain}: NOT CHECKED (${error instanceof Error ? error.message : String(error)})`);
    }
    if (index < domains.length - 1) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
} finally {
  await browser.close();
}

const count = (status: string) => checks.filter((c) => c.status === status).length;
console.log(`\nChecked ${checks.length} of ${domains.length}: ${count('active')} active, ${count('lapsed')} lapsed, ${count('none')} none, ${failures.length} not checked.`);

if (outPath) console.log(`Results: ${outPath}`);

if (pushTo && checks.length > 0) {
  const endpoint = new URL('/api/ingest/ad-checks', pushTo).toString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.INGEST_TOKEN ?? ''}` },
    body: JSON.stringify({ checks }),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`Push failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`Pushed to ${endpoint}: ${text}`);
}
