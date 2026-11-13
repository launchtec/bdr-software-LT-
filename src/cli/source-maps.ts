/**
 * Source local businesses from Google Maps searches.
 *
 *   npm run source:maps -- --trades "fence company,roofing contractor" --places "Arvada CO,Aurora CO"
 *   npm run source:maps -- --trades "hvac" --places "Parker CO" --out audit-output/maps.jsonl --sites audit-output/sites.txt
 *
 * Runs one search per trade and place, removes duplicates, and keeps only businesses
 * with their own website. --sites writes the site list for `audit:batch` and `adcheck`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { launchBrowser } from '../audit/collect';
import { searchMaps, type MapsListing } from '../sourcing/maps';

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
const list = (value: string | undefined) => (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

const args = process.argv.slice(2);
const trades = list(option(args, '--trades'));
const places = list(option(args, '--places'));
const outPath = option(args, '--out');
const sitesPath = option(args, '--sites');
if (trades.length === 0 || places.length === 0) {
  console.error('Usage: npm run source:maps -- --trades "a,b" --places "City ST,City ST" [--out file.jsonl] [--sites sites.txt]');
  process.exit(1);
}

const browser = await launchBrowser();
const byDomain = new Map<string, MapsListing & { place: string; trade: string }>();
let total = 0;
let withoutSite = 0;
try {
  for (const place of places) {
    for (const trade of trades) {
      const query = `${trade} ${place}`;
      try {
        const listings = await searchMaps(query, { browser });
        total += listings.length;
        let added = 0;
        for (const listing of listings) {
          if (!listing.domain) {
            withoutSite += 1;
            continue;
          }
          if (!byDomain.has(listing.domain)) {
            byDomain.set(listing.domain, { ...listing, place, trade });
            added += 1;
          }
        }
        console.log(`${query}: ${listings.length} listings, ${added} new`);
      } catch (error) {
        console.log(`${query}: FAILED (${error instanceof Error ? error.message : String(error)})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
} finally {
  await browser.close();
}

const companies = [...byDomain.values()];
console.log(`\n${total} listings seen, ${withoutSite} without their own site, ${companies.length} unique companies kept.`);

if (outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, companies.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`Listings: ${outPath}`);
}
if (sitesPath) {
  await mkdir(dirname(sitesPath), { recursive: true });
  await writeFile(sitesPath, companies.map((c) => c.website).join('\n') + '\n');
  console.log(`Site list: ${sitesPath}`);
}
