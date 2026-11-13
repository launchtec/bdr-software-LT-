# LaunchTec outbound system

Software that finds prospects from observable signals, audits each one before anyone writes to them, runs one coordinated sequence per person across email, LinkedIn and Instagram, and records what works.

The plan, including channels, sourcing signals, costs and open decisions, is in [docs/plan.md](docs/plan.md). What the messages say, and why, is in [docs/messaging.md](docs/messaging.md).

## What exists today

| Part | Where | State |
|---|---|---|
| System of record (companies, people, identities, signals, sequences, touches, replies, outcomes, experiments, suppression) | `src/db/schema.ts`, `drizzle/` | Schema and first migration |
| Do-not-contact checks | `src/db/suppression.ts` | Working |
| Site tracking audit, the first signal collector | `src/audit/` | Working; see limits below |
| Web app: overview, prospect list, evidence behind each finding, fit verdicts | `src/app/` | Working |
| Ingest API, where audit workers push results | `src/app/api/ingest/` | Working |
| Google ad check: who is running ads, from Google's public ad library | `src/adcheck/` | Working |
| Meta ad check | — | Not built: Meta's Ad Library blocks automated visits |
| Sourcing from Google Maps searches by trade and area | `src/sourcing/` | Working; no size signal yet |
| Shortlist rule: advertising now, confirmed tracking gap, setup not built out | `src/lib/shortlist.ts` | Working; to be tuned against fit verdicts |
| Outreach queue: research dossier, contact, drafted messages per channel; edit, approve, copy, mark sent, log reply | `src/app/outreach/`, `src/db/outreach.ts` | Working; sending is by hand |
| Contact research and message drafting | — | Done by a researcher (human or AI session) and pushed in through `POST /api/ingest/outreach`; not automated inside the app |
| Automatic email sending and reply reading | — | Not built yet |

## Site audit

Visits a site in a headless browser, records what it loads, and reports what is installed (Tag Manager, GA4, Google Ads, Meta pixel, call tracking, lead tools, platform, site credits) plus findings worth raising.

```bash
npm run audit -- example.com
```

```bash
npm run audit -- example.com --json
```

Audit a list of sites (one URL or domain per line) and summarize how often each finding occurs. Full results are written as JSON Lines under `audit-output/`, which is not committed:

```bash
npm run audit:batch -- sites.txt
```

Send results to the web app (the token comes from the `INGEST_TOKEN` environment variable):

```bash
npm run audit:batch -- sites.txt --push https://your-app.example.com --segment home_services
```

How it stays honest:

- Read-only. It moves the mouse and scrolls, because many sites delay their tags until a visitor does, but it never clicks anything, submits a form, or accepts a consent banner.
- Every finding carries its evidence and is graded `observed` or `likely`; `likely` findings carry a caveat saying what an outside visit cannot see.
- Findings that only matter if the company advertises are marked with that condition (`appliesWhen`), to be confirmed from the ad libraries.
- A page that fails to load, or a bot-challenge page, raises `SiteNotAuditableError` instead of being reported as empty.
- If a tag loader fails to download during the visit, every "not detected" finding is withheld and the audit says so under `limitations`.

Known limits:

- It reads the Tag Manager container, so it sees tags that only fire on a form submit, but it cannot tell whether they fire correctly, and it cannot see conversions imported from GA4 or uploaded offline.
- Findings marked `appliesWhen` only count once the ad check confirms the company advertises. Findings that depend on Meta ads stay unconfirmed.
- Sites behind a Cloudflare bot challenge cannot be audited: 4 of 33 in the first real-site run (Colorado home-services companies, 2026-11-13).
- The vendor fingerprint lists in `src/audit/detect.ts` are a starting set, extended as real sites reveal new ones.

## Sourcing

Runs Google Maps searches for each trade and place, removes duplicates, and keeps businesses that have their own website.

```bash
npm run source:maps -- --trades "fence company,roofing contractor" --places "Arvada CO,Aurora CO" --out audit-output/maps.jsonl --sites audit-output/sites.txt
```

- Maps lists small and mid-sized local companies that web search rankings bury.
- Logged-out Maps hides review counts, so there is no size signal yet. Google's official Places API returns them and is the intended replacement for this scraper, which reads a public page and could be blocked.
- Sourced companies are pushed to `POST /api/ingest/companies`; the site list then goes through `audit:batch` and `adcheck`.

## Ad check

Reads Google's public Ads Transparency Center to see whether ads point at a company's domain, how many, and when they were first and last shown. A company counts as active if an ad was shown in the last 30 days.

```bash
npm run adcheck -- example.com
```

```bash
npm run adcheck -- --list sites.txt --push https://your-app.example.com
```

- The result decides which audit findings can be used: "no Google Ads tag" only matters for a company that is running Google ads.
- If the library cannot be read, the company is reported as not checked, never as "no ads".
- Ads that point to a different domain (a separate landing-page domain, for example) do not appear, and the advertiser name is often the agency running the account.
- It reads a public web page, not an API, one company at a time. Google could change or block it.
- Behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1` so `--push` goes through it.

## Web app

A password-protected dashboard over the database: what has been researched, what each site runs, and the evidence behind every finding. It only reads the database; the audit engine needs a headless browser, so it runs elsewhere and pushes results in through `POST /api/ingest/audits`.

```bash
npm run dev
```

- Pages ask for a login (HTTP Basic): username from `APP_USERNAME`, password from `APP_PASSWORD`. If `APP_USERNAME` is unset, any username is accepted. In production the app locks itself if `APP_PASSWORD` is missing.
- The ingest API requires `Authorization: Bearer <INGEST_TOKEN>`.

### Hosting (free tier)

The app runs on Render's free web service with a free Neon Postgres database. Render's own free database is deleted after 30 days, so it is not used. The free web service sleeps after 15 minutes without traffic; the first page load after that takes up to a minute.

1. Create a project at neon.com and copy its connection string.
2. In Render, choose New → Blueprint, connect this repository, and paste the connection string as `DATABASE_URL`. `render.yaml` defines the rest and generates `APP_PASSWORD` and `INGEST_TOKEN`; read or change them on the service's Environment tab.
3. Every push to `main` redeploys. Migrations run on start.

## Setup

Requires Node 22+.

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
cp .env.example .env
```

Apply the schema to the database in `DATABASE_URL`:

```bash
npm run db:migrate
```

After changing `src/db/schema.ts`, generate a new migration:

```bash
npm run db:generate -- --name describe_the_change
```

## Checks

```bash
npm test
```

```bash
npm run typecheck
```

Tests need no database server or network: the database tests run on an in-process Postgres, and the browser tests run against a local fake site with third-party hosts stubbed.
