/**
 * Audit a list of sites and summarize how often each finding occurs.
 *
 *   npm run audit:batch -- sites.txt
 *   npm run audit:batch -- sites.txt --out audit-output/denver.jsonl --concurrency 4
 *
 * The input file has one URL or domain per line; blank lines and lines starting with #
 * are skipped. Results are written as JSON Lines, one site per line.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { auditSite, launchBrowser, type SiteAudit } from '../audit';

interface SiteResult {
  url: string;
  ok: boolean;
  seconds: number;
  audit?: SiteAudit;
  error?: string;
}

const SITE_TIMEOUT_MS = 150_000;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

function summarize(results: SiteResult[]): string {
  const audited = results.filter((r) => r.audit).map((r) => r.audit!);
  const complete = audited.filter((a) => a.limitations.length === 0);
  const lines: string[] = [];

  lines.push(`Sites: ${results.length}`);
  lines.push(`  audited:               ${audited.length} (${percent(audited.length, results.length)})`);
  lines.push(`  audited with limits:   ${audited.length - complete.length}`);
  lines.push(`  could not be audited:  ${results.length - audited.length}`);

  const installed: [string, (a: SiteAudit) => boolean][] = [
    ['Tag Manager or Google tag', (a) => a.detections.gtm.length + a.detections.googleTag.length > 0],
    ['GA4', (a) => a.detections.ga4.length > 0],
    ['Google Ads tag', (a) => a.detections.googleAds.length > 0],
    ['Meta pixel', (a) => a.detections.metaPixel.length > 0],
    ['Call tracking', (a) => a.detections.callTracking.length > 0 || a.detections.googleCallConversion],
    ['Templated marketing vendor', (a) => a.detections.marketingVendors.length > 0],
    ['Consent manager', (a) => a.detections.consentManagers.length > 0],
  ];
  lines.push('', `Installed (of ${audited.length} audited)`);
  for (const [label, test] of installed) {
    const n = audited.filter(test).length;
    lines.push(`  ${label.padEnd(28)}${String(n).padStart(3)}  ${percent(n, audited.length)}`);
  }

  const counts = new Map<string, number>();
  for (const audit of audited) {
    for (const code of new Set(audit.findings.map((f) => f.code))) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  lines.push('', `Findings (sites with each, of ${audited.length} audited)`);
  for (const [code, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${code.padEnd(28)}${String(n).padStart(3)}  ${percent(n, audited.length)}`);
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    lines.push('', 'Not audited');
    for (const f of failures) lines.push(`  ${f.url}: ${f.error}`);
  }
  return lines.join('\n');
}

const args = process.argv.slice(2);
const listPath = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!listPath) {
  console.error('Usage: npm run audit:batch -- <file-with-one-site-per-line> [--out file.jsonl] [--concurrency n]');
  process.exit(1);
}

const outPath = option(args, '--out') ?? `audit-output/batch-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
const concurrency = Math.max(1, Number(option(args, '--concurrency') ?? 3));

const sites = (await readFile(listPath, 'utf8'))
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

const browser = await launchBrowser();
const results: SiteResult[] = new Array(sites.length);
let next = 0;

async function worker(): Promise<void> {
  while (next < sites.length) {
    const index = next++;
    const url = sites[index]!;
    const started = Date.now();
    try {
      const audit = await withTimeout(auditSite(url, { browser }), SITE_TIMEOUT_MS, url);
      results[index] = { url, ok: true, seconds: (Date.now() - started) / 1000, audit };
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
      results[index] = { url, ok: false, seconds: (Date.now() - started) / 1000, error: message };
    }
    const r = results[index]!;
    console.error(`[${index + 1}/${sites.length}] ${r.ok ? 'ok  ' : 'FAIL'} ${url} (${r.seconds.toFixed(0)}s)`);
  }
}

try {
  await Promise.all(Array.from({ length: Math.min(concurrency, sites.length) }, worker));
} finally {
  await browser.close();
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, results.map((r) => JSON.stringify(r)).join('\n') + '\n');

console.log(summarize(results));
console.log(`\nFull results: ${outPath}`);
