# LaunchTec outbound system

Software that finds prospects from observable signals, audits each one before anyone writes to them, runs one coordinated sequence per person across email, LinkedIn and Instagram, and records what works.

The plan, including channels, sourcing signals, costs and open decisions, is in [docs/plan.md](docs/plan.md).

## What exists today

| Part | Where | State |
|---|---|---|
| System of record (companies, people, identities, signals, sequences, touches, replies, outcomes, experiments, suppression) | `src/db/schema.ts`, `drizzle/` | Schema and first migration |
| Do-not-contact checks | `src/db/suppression.ts` | Working |
| Site tracking audit, the first signal collector | `src/audit/` | Working; see limits below |
| Web app: overview, prospect list, evidence behind each finding | `src/app/` | Working; read-only so far |
| Ingest API, where audit workers push results | `src/app/api/ingest/` | Working |
| Ad-library check, sourcing, contact finding, drafting, review queue, sending, reply handling | — | Not built yet |

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
- Findings marked `appliesWhen` mean nothing until an ad-library check confirms the company advertises; that check is not built yet.
- Sites behind a Cloudflare bot challenge cannot be audited: 4 of 33 in the first real-site run (Colorado home-services companies, 2026-11-13).
- The vendor fingerprint lists in `src/audit/detect.ts` are a starting set, extended as real sites reveal new ones.

## Web app

A password-protected dashboard over the database: what has been researched, what each site runs, and the evidence behind every finding. It only reads the database; the audit engine needs a headless browser, so it runs elsewhere and pushes results in through `POST /api/ingest/audits`.

```bash
npm run dev
```

- Pages ask for a password (HTTP Basic, any username, password from `APP_PASSWORD`). In production the app locks itself if `APP_PASSWORD` is missing.
- The ingest API requires `Authorization: Bearer <INGEST_TOKEN>`.

### Hosting (free tier)

The app runs on Render's free web service with a free Neon Postgres database. Render's own free database is deleted after 30 days, so it is not used. The free web service sleeps after 15 minutes without traffic; the first page load after that takes up to a minute.

1. Create a project at neon.com and copy its connection string.
2. In Render, choose New → Blueprint, connect this repository, and paste the connection string as `DATABASE_URL`. `render.yaml` defines the rest and generates `APP_PASSWORD` and `INGEST_TOKEN`; read them on the service's Environment tab.
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
