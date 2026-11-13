import { and, eq, or, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { suppressions } from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type Scope = (typeof schema.suppressionScopeEnum.enumValues)[number];
type Reason = (typeof schema.suppressionReasonEnum.enumValues)[number];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `https://www.Example.com/contact` -> `example.com` */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^/@]*@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

/** `https://www.linkedin.com/in/Jane-Doe/?utm=x` -> `linkedin.com/in/jane-doe` */
export function normalizeLinkedin(url: string): string {
  const cleaned = url
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[?#].*$/, '')
    .replace(/^([a-z]{2,3}\.)?linkedin\.com/, 'linkedin.com')
    .replace(/\/+$/, '');
  return cleaned;
}

/** `@Handle`, `instagram.com/Handle/` -> `handle` */
export function normalizeInstagram(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^(www\.)?instagram\.com\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
}

export interface SuppressionTarget {
  email?: string;
  domain?: string;
  linkedin?: string;
  instagram?: string;
  companyId?: string;
  personId?: string;
}

/**
 * Returns the first suppression that blocks contacting this target, or null.
 * An email address is also blocked by a suppression on its domain.
 */
export async function findSuppression(db: Db, target: SuppressionTarget) {
  const checks: SQL[] = [];
  const add = (scope: Scope, value: string) => {
    const clause = and(eq(suppressions.scope, scope), eq(suppressions.value, value));
    if (clause) checks.push(clause);
  };

  if (target.email) {
    const email = normalizeEmail(target.email);
    add('email', email);
    const at = email.lastIndexOf('@');
    if (at !== -1) add('domain', email.slice(at + 1));
  }
  if (target.domain) add('domain', normalizeDomain(target.domain));
  if (target.linkedin) add('linkedin', normalizeLinkedin(target.linkedin));
  if (target.instagram) add('instagram', normalizeInstagram(target.instagram));
  if (target.companyId) add('company', target.companyId);
  if (target.personId) add('person', target.personId);

  if (checks.length === 0) return null;
  const rows = await db.select().from(suppressions).where(or(...checks)).limit(1);
  return rows[0] ?? null;
}

const normalizers: Record<Scope, (v: string) => string> = {
  email: normalizeEmail,
  domain: normalizeDomain,
  linkedin: normalizeLinkedin,
  instagram: normalizeInstagram,
  company: (v) => v,
  person: (v) => v,
};

/** Adds a suppression. Safe to call repeatedly; the first reason recorded is kept. */
export async function suppress(db: Db, entry: { scope: Scope; value: string; reason: Reason; source?: string }) {
  await db
    .insert(suppressions)
    .values({
      scope: entry.scope,
      value: normalizers[entry.scope](entry.value),
      reason: entry.reason,
      source: entry.source,
    })
    .onConflictDoNothing();
}
