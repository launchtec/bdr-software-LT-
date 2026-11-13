import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import type { Db } from './suppression';

let cached: Db | undefined;

/** Shared connection pool for the web app. Throws if DATABASE_URL is missing. */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  cached = drizzle(pool, { schema }) as unknown as Db;
  return cached;
}
