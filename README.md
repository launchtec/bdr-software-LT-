# LaunchTec outbound system

Software that finds prospects from observable signals, audits each one before anyone writes to them, runs one coordinated sequence per person across email, LinkedIn and Instagram, and records what works.

The plan, including channels, sourcing signals, costs and open decisions, is in [docs/plan.md](docs/plan.md).

## What exists today

| Part | Where | State |
|---|---|---|
| System of record (companies, people, identities, signals, sequences, touches, replies, outcomes, experiments, suppression) | `src/db/schema.ts`, `drizzle/` | Schema and first migration |
| Do-not-contact checks | `src/db/suppression.ts` | Working |
| Site tracking audit, the first signal collector | `src/audit/` | Working; see limits below |
| Sourcing, contact finding, drafting, review queue, sending, reply handling, dashboard | — | Not built yet |

## Site audit

Visits a site in a headless browser, records what it loads, and reports what is installed (Tag Manager, GA4, Google Ads, Meta pixel, call tracking, lead tools, platform, site credits) plus findings worth raising.

```bash
npm run audit -- example.com
```

```bash
npm run audit -- example.com --json
```

How it stays honest:

- Read-only. It never submits a form, clicks a call button, or accepts a consent banner.
- Every finding carries its evidence and is graded `observed` or `likely`; `likely` findings carry a caveat saying what an outside visit cannot see.
- Findings that only matter if the company advertises are marked with that condition (`appliesWhen`), to be confirmed from the ad libraries.
- A page that fails to load, or a bot-challenge page, raises `SiteNotAuditableError` instead of being reported as empty.
- If a tag loader fails to download during the visit, every "not detected" finding is withheld and the audit says so under `limitations`.

Known limits: it cannot tell whether a conversion actually fires (that would require submitting a form), cannot see conversions imported from GA4 or uploaded offline, and has only been run against fixtures and one live site so far. The vendor fingerprint lists in `src/audit/detect.ts` are a starting set to extend as they are verified.

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
